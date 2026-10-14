/** REQ-011: backfill the appeals REQ-010's bug left stuck — every question
 *  judged, appeal still "pending" — for appeals filed in the last 7 days.
 *  Closing them must NOT send the appeal-result email. */
import { assertEquals } from "#assert";
import { backfillStuckAppeals } from "./mod.ts";
import { getAppeal, saveAppeal } from "@judge/domain/data/judge-repository/mod.ts";
import { setStored } from "@core/data/firestore/mod.ts";
import { saveFinding, getFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { registerWebhookEmailHandler } from "@admin/domain/data/admin-repository/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

const kvOpts = { sanitizeResources: false, sanitizeOps: false };
const DAY = 86_400_000;
const NOW = Date.now();

async function seedAppeal(
  org: OrgId, fid: string, appealedAt: number, decided: number[], status = "pending",
): Promise<void> {
  await saveFinding(org, {
    id: fid,
    findingStatus: "finished",
    owner: "vo@x.com",
    answeredQuestions: [{ header: "Q0", answer: "No" }, { header: "Q1", answer: "No" }],
    completedAt: appealedAt - 1000,
  } as unknown as Parameters<typeof saveFinding>[1]);
  await saveAppeal(org, {
    findingId: fid, appealedAt, status: status as "pending",
    auditor: "vo@x.com", appealedQuestions: ["0", "1"],
  });
  for (const i of decided) {
    await setStored("judge-decided", org, [fid, i], {
      findingId: fid, questionIndex: i, header: `Q${i}`, answer: "No",
      decision: "overturn", judge: "judge@x.com", decidedAt: appealedAt + 1000 + i,
    });
  }
}

async function seedAll() {
  const org = ("test-req011-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
  await seedAppeal(org, "stuck-recent", NOW - 2 * DAY, [0, 1]);
  await seedAppeal(org, "stuck-old", NOW - 8 * DAY, [0, 1]);
  await seedAppeal(org, "still-judging", NOW - 1 * DAY, [0]);
  await seedAppeal(org, "already-closed", NOW - 1 * DAY, [0, 1], "complete");
  return org;
}

Deno.test({ name: "REQ-011: dry run lists only the last 7 days' stuck appeals and writes nothing", ...kvOpts, fn: async () => {
  const org = await seedAll();
  const r = await backfillStuckAppeals(org, { sinceMs: NOW - 7 * DAY, apply: false });
  assertEquals(r.map((x) => x.findingId), ["stuck-recent"]);
  assertEquals((await getAppeal(org, "stuck-recent"))?.status, "pending", "a dry run must not close anything");
}});

Deno.test({ name: "REQ-011: apply closes the stuck appeal and fixes its answers, without sending an email", ...kvOpts, fn: async () => {
  const org = await seedAll();
  const emailed: unknown[] = [];
  registerWebhookEmailHandler("judge", (_org, payload) => { emailed.push(payload); return Promise.resolve(); });

  const r = await backfillStuckAppeals(org, { sinceMs: NOW - 7 * DAY, apply: true });

  assertEquals(r.map((x) => x.findingId), ["stuck-recent"]);
  assertEquals(r[0].judge, "judge@x.com");
  assertEquals((await getAppeal(org, "stuck-recent"))?.status, "complete");
  const qs = (await getFinding(org, "stuck-recent"))?.answeredQuestions as Array<Record<string, unknown>>;
  assertEquals(qs.map((q) => q.answer), ["Yes", "Yes"], "overturned answers flip to Yes");
  assertEquals((await getAppeal(org, "stuck-old"))?.status, "pending", "older than 7 days is left alone");
  assertEquals((await getAppeal(org, "still-judging"))?.status, "pending", "an appeal a judge is still on is left alone");
  assertEquals(emailed.length, 0, "the backfill must not send the appeal-result email");
}});
