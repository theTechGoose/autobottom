/** Overturn Review (REQ-047..051): an appeal the judge finished with any
 *  overturn waits for the team; the team confirms or reverses (a reversal needs
 *  a note); the last call closes the appeal and sends the one email. */
import { assert, assertEquals, assertRejects } from "#assert";
import {
  decideOverturnReview, getOverturnReviewItem, isOverturnReviewEnabled, listOverturnReviewRows,
  OverturnReviewError, setOverturnReviewEnabled,
} from "./mod.ts";
import { getAppeal, recordJudgeDecision, saveAppeal } from "@judge/domain/data/judge-repository/mod.ts";
import { backfillStuckAppeals } from "@judge/domain/business/appeal-close-backfill/mod.ts";
import { getStored, setStored } from "@core/data/firestore/mod.ts";
import { getFinding, saveFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { registerWebhookEmailHandler } from "@admin/domain/data/admin-repository/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

const kvOpts = { sanitizeResources: false, sanitizeOps: false };
const JUDGE = "judge@x.com";

type Payload = { findingId: string; decisions?: Array<{ questionIndex: number; decision: string; reason?: string }>; finalScore?: number };

/** Emails the judge webhook sends for `org`'s findings. Registered per test,
 *  filtered by finding id, so other files' handlers can't confuse it. */
function captureEmails(): Payload[] {
  const sent: Payload[] = [];
  registerWebhookEmailHandler("judge", (_org, payload) => { sent.push(payload as Payload); return Promise.resolve(); });
  return sent;
}

const newOrg = () => ("test-overturn-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;

/** A finished audit with three failed questions, reviewed (the reviewer
 *  confirmed each fail), appealed on all three. */
async function seedAppeal(org: OrgId, fid: string): Promise<void> {
  await saveFinding(org, {
    id: fid,
    findingStatus: "finished",
    owner: "vo@x.com",
    appealComment: "The guest said yes at 2:10",
    answeredQuestions: [
      { header: "Q0", answer: "No" }, { header: "Q1", answer: "No" }, { header: "Q2", answer: "No" }, { header: "Q3", answer: "Yes" },
    ],
    completedAt: Date.now() - 5000,
    record: { RecordId: "900200" },
  } as unknown as Parameters<typeof saveFinding>[1]);
  await saveAppeal(org, {
    findingId: fid, appealedAt: Date.now() - 4000, status: "pending",
    auditor: "vo@x.com", appealedQuestions: ["0", "1", "2"],
  });
  for (const i of [0, 1, 2]) {
    await setStored("review-decided", org, [fid, i], {
      findingId: fid, questionIndex: i, header: `Q${i}`, answer: "No", thinking: "", defense: "",
      decision: "confirm", reviewer: `reviewer${i}@x.com`, decidedAt: Date.now() - 4500,
    });
    await setStored("judge-pending", org, [fid, i], {
      findingId: fid, questionIndex: i, header: `Q${i}`, populated: "", thinking: "", defense: "", answer: "No",
    });
  }
  await setStored("judge-audit-pending", org, [fid], 3);
}

/** The judge decides every appealed question; the last one finishes the appeal
 *  (fire-and-forget, as in production), so wait for its effect. */
async function judge(org: OrgId, fid: string, calls: Array<"overturn" | "uphold">): Promise<void> {
  for (let i = 0; i < calls.length; i++) {
    await recordJudgeDecision(org, fid, i, calls[i], JUDGE, calls[i] === "overturn" ? "error" : "It was a No");
  }
  await waitFor(async () =>
    (await getStored("overturn-review", org, fid)) !== null || (await getAppeal(org, fid))?.status === "complete"
  );
}

async function waitFor(cond: () => Promise<boolean>, ms = 15_000): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("timed out waiting");
}

const answers = async (org: OrgId, fid: string) =>
  ((await getFinding(org, fid))?.answeredQuestions as Array<Record<string, unknown>>).map((q) => q.answer);

Deno.test({ name: "REQ-047: a judge's overturn holds the appeal — no email, no score change, still pending", ...kvOpts, fn: async () => {
  const org = newOrg();
  await seedAppeal(org, "all-over");
  const emails = captureEmails();
  await judge(org, "all-over", ["overturn", "overturn", "overturn"]);

  assert(await getStored("overturn-review", org, "all-over"), "the appeal is in the Overturn Review queue");
  const appeal = await getAppeal(org, "all-over");
  assertEquals(appeal?.status, "pending", "not final until the team decides");
  assert(appeal?.overturnReviewHeldAt, "the appeal says it is held");
  assertEquals(await answers(org, "all-over"), ["No", "No", "No", "Yes"], "the score is not changed yet");
  await new Promise((r) => setTimeout(r, 500));
  assertEquals(emails.filter((e) => e.findingId === "all-over").length, 0, "no appeal-result email");
}});

Deno.test({ name: "REQ-047: a mixed appeal (any overturn) holds the whole appeal", ...kvOpts, fn: async () => {
  const org = newOrg();
  await seedAppeal(org, "mixed");
  const emails = captureEmails();
  await judge(org, "mixed", ["uphold", "overturn", "uphold"]);

  assert(await getStored("overturn-review", org, "mixed"), "held");
  assertEquals((await getAppeal(org, "mixed"))?.status, "pending");
  assertEquals(await answers(org, "mixed"), ["No", "No", "No", "Yes"]);
  assertEquals(emails.filter((e) => e.findingId === "mixed").length, 0);
}});

Deno.test({ name: "REQ-047: an all-uphold appeal closes and emails as before", ...kvOpts, fn: async () => {
  const org = newOrg();
  await seedAppeal(org, "upheld");
  const emails = captureEmails();
  await judge(org, "upheld", ["uphold", "uphold", "uphold"]);

  assertEquals(await getStored("overturn-review", org, "upheld"), null, "not held");
  assertEquals((await getAppeal(org, "upheld"))?.status, "complete");
  await waitFor(() => Promise.resolve(emails.some((e) => e.findingId === "upheld")));
}});

Deno.test({ name: "REQ-047: the stuck-appeal backfill never closes a held appeal", ...kvOpts, fn: async () => {
  const org = newOrg();
  await seedAppeal(org, "held");
  await judge(org, "held", ["overturn", "uphold", "uphold"]);

  const r = await backfillStuckAppeals(org, { sinceMs: 0, apply: true });
  assertEquals(r.map((x) => x.findingId), [], "a held appeal is not stuck");
  assertEquals((await getAppeal(org, "held"))?.status, "pending");
}});

Deno.test({ name: "REQ-048: the queue shows each question with the reviewer who failed it, the judge's call, and the appeal comment", ...kvOpts, fn: async () => {
  const org = newOrg();
  await seedAppeal(org, "shown");
  await judge(org, "shown", ["overturn", "uphold", "overturn"]);

  const { item, remaining } = await getOverturnReviewItem(org);
  assertEquals(remaining, 1);
  assertEquals(item?.findingId, "shown");
  assertEquals(item?.judge, JUDGE);
  assertEquals(item?.auditor, "vo@x.com");
  assertEquals(item?.appealComment, "The guest said yes at 2:10");
  assertEquals(item?.recordId, "900200");
  assertEquals(item?.questions.map((q) => [q.questionIndex, q.header, q.decision, q.reviewer, q.botAnswer]), [
    [0, "Q0", "overturn", "reviewer0@x.com", "No"],
    [1, "Q1", "uphold", "reviewer1@x.com", "No"],
    [2, "Q2", "overturn", "reviewer2@x.com", "No"],
  ]);
  assertEquals(item?.questions[0].judgeReason, "error");
}});

Deno.test({ name: "REQ-048: held appeals list oldest first", ...kvOpts, fn: async () => {
  const org = newOrg();
  await seedAppeal(org, "first");
  await judge(org, "first", ["overturn", "overturn", "overturn"]);
  await seedAppeal(org, "second");
  await judge(org, "second", ["overturn", "overturn", "overturn"]);

  assertEquals((await listOverturnReviewRows(org)).map((r) => r.findingId), ["first", "second"]);
  assertEquals((await getOverturnReviewItem(org, "second")).item?.findingId, "second", "a named appeal can be opened");
}});

Deno.test({ name: "REQ-049: reversing an overturn needs a note, and only overturned questions take a call", ...kvOpts, fn: async () => {
  const org = newOrg();
  await seedAppeal(org, "note");
  await judge(org, "note", ["overturn", "uphold", "uphold"]);

  await assertRejects(() => decideOverturnReview(org, "note", 0, "reverse", "team@x.com", "  "), OverturnReviewError, "note is required");
  await assertRejects(() => decideOverturnReview(org, "note", 1, "confirm", "team@x.com"), OverturnReviewError);
  assert(await getStored("overturn-review", org, "note"), "still held");
}});

Deno.test({ name: "REQ-049: the last call closes the appeal on the final decisions and sends one email", ...kvOpts, fn: async () => {
  const org = newOrg();
  await seedAppeal(org, "final");
  await judge(org, "final", ["overturn", "uphold", "overturn"]);
  const emails = captureEmails();

  const first = await decideOverturnReview(org, "final", 0, "confirm", "team@x.com");
  assertEquals(first.finalized, false, "one overturn still needs a call");
  assertEquals((await getAppeal(org, "final"))?.status, "pending");
  assertEquals(emails.filter((e) => e.findingId === "final").length, 0, "no email before the last call");

  const last = await decideOverturnReview(org, "final", 2, "reverse", "team@x.com", "Guest never confirmed the dates");
  assertEquals(last.finalized, true);

  assertEquals(await getStored("overturn-review", org, "final"), null, "out of the queue");
  const appeal = await getAppeal(org, "final");
  assertEquals(appeal?.status, "complete");
  assertEquals(appeal?.overturnReviewHeldAt, undefined);
  assertEquals(appeal?.overturnedCount, 1);
  assertEquals(appeal?.upheldCount, 2);
  assertEquals(await answers(org, "final"), ["Yes", "No", "No", "Yes"], "confirmed flips, reversed stays failed");

  const reversed = await getStored<Record<string, unknown>>("judge-decided", org, "final", 2);
  assertEquals(reversed?.decision, "uphold");
  assertEquals(reversed?.reason, "Guest never confirmed the dates");
  assertEquals((reversed?.teamReversal as Record<string, unknown>)?.overturnedBy, JUDGE);

  await waitFor(() => Promise.resolve(emails.some((e) => e.findingId === "final")));
  const mine = emails.filter((e) => e.findingId === "final");
  assertEquals(mine.length, 1, "exactly one email");
  const q2 = mine[0].decisions?.find((d) => d.questionIndex === 2);
  assertEquals([q2?.decision, q2?.reason], ["uphold", "Guest never confirmed the dates"], "the note reads as the uphold reason");
}});

Deno.test({ name: "REQ-050: appeals closed before the queue existed are never pulled in", ...kvOpts, fn: async () => {
  const org = newOrg();
  await seedAppeal(org, "old");
  await saveAppeal(org, { findingId: "old", appealedAt: Date.now() - 4000, status: "complete", auditor: "vo@x.com", appealedQuestions: ["0"] });
  await setStored("judge-decided", org, ["old", 0], {
    findingId: "old", questionIndex: 0, header: "Q0", answer: "No", decision: "overturn", judge: JUDGE, decidedAt: Date.now() - 3000,
  });
  await backfillStuckAppeals(org, { sinceMs: 0, apply: true });

  assertEquals(await listOverturnReviewRows(org), []);
  assertEquals((await getOverturnReviewItem(org)).item, null);
}});

Deno.test({ name: "REQ-051: the queue is on by default; switched off, an overturn closes and emails right away", ...kvOpts, fn: async () => {
  const org = newOrg();
  assertEquals(await isOverturnReviewEnabled(org), true, "on by default");
  await setOverturnReviewEnabled(org, false);
  assertEquals(await isOverturnReviewEnabled(org), false);

  await seedAppeal(org, "bypass");
  const emails = captureEmails();
  await judge(org, "bypass", ["overturn", "uphold", "uphold"]);

  assertEquals(await getStored("overturn-review", org, "bypass"), null, "not held");
  assertEquals((await getAppeal(org, "bypass"))?.status, "complete");
  assertEquals(await answers(org, "bypass"), ["Yes", "No", "No", "Yes"]);
  await waitFor(() => Promise.resolve(emails.some((e) => e.findingId === "bypass")));
}});

Deno.test({ name: "REQ-051: switching the queue off leaves already-held appeals held", ...kvOpts, fn: async () => {
  const org = newOrg();
  await seedAppeal(org, "kept");
  await judge(org, "kept", ["overturn", "overturn", "overturn"]);
  await setOverturnReviewEnabled(org, false);

  assertEquals((await listOverturnReviewRows(org)).map((r) => r.findingId), ["kept"]);
  assertEquals((await getAppeal(org, "kept"))?.status, "pending");
}});
