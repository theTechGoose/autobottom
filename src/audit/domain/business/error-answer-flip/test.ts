/** Tests for the retroactive Error-Answer Cleanup sweep.
 *
 *  The load-bearing guarantees, in order of how much damage getting them wrong
 *  would do:
 *    1. Flipping actually REMOVES the word "Error" from the answers. The report
 *       renders its verdict off the answer string, not the score — a flip that
 *       set score=100 and left "Error" in place would look fixed on the
 *       dashboard and still show "Bot Error — Could Not Grade" on the report,
 *       which is the whole thing this tool exists to stop.
 *    2. An Error flip must NOT touch the per-question failure counters.
 *       step-finalize only counts `answer === "No"` as a failure, so an Error
 *       never incremented them; incrFlipToPass DECREMENTS, so counting an Error
 *       flip would silently delete a DIFFERENT audit's genuine failure from the
 *       month's bucket and under-report the Question Failures report.
 *    3. `scan` mode NEVER writes — it is the "how many are impacted?" button and
 *       the operator must be able to press it without changing anything.
 *    4. The scan reports realFailCount, because forcing the whole audit to 100
 *       also erases genuine failures and the operator is entitled to see that
 *       number before pressing the button.
 *    5. It is idempotent — a flipped audit is no longer a candidate.
 *
 *  Firestore falls back to in-memory via resetFirestoreCredentials(). */

import { assert, assertEquals } from "#assert";
import { processErrorFlipBatch } from "./mod.ts";
import { resetFirestoreCredentials } from "@core/data/firestore/mod.ts";
import { getFinding, saveFinding } from "@audit/domain/data/audit-repository/mod.ts";
import {
  incrFailed,
  readQuestionFailRange,
  yyyymm,
} from "@audit/domain/data/question-stats-repository/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

const kvOpts = { sanitizeResources: false, sanitizeOps: false };

function uniqueOrg(): OrgId {
  return ("test-errflip-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
}

/** Mirrors review-queue's makeFindingFixture — same shape the real pipeline
 *  writes, so the flip path under test is the production one. */
async function makeFinding(
  orgId: OrgId,
  findingId: string,
  answers: string[],
): Promise<number> {
  const completedAt = Date.now();
  const answeredQuestions = answers.map((answer, i) => ({
    header: `Q${i}`,
    populated: `populated ${i}`,
    thinking: `thinking ${i}`,
    defense: `defense ${i}`,
    answer,
  }));
  await saveFinding(orgId, {
    id: findingId,
    auditJobId: "job-" + findingId,
    findingStatus: "finished",
    recordingId: "rec-" + findingId,
    recordingIdField: "VoGenie",
    owner: "test@x.com",
    qlabConfig: "X",
    record: {
      RecordId: "r-" + findingId,
      VoName: "VO 01 - Test Person",
      GuestName: "Guest Person",
      ActivatingOffice: "ECG",
      OfficeName: "ECG Office",
      Shift: "Day",
    },
    answeredQuestions,
    completedAt,
  } as unknown as Parameters<typeof saveFinding>[1]);
  return completedAt;
}

async function answersOf(orgId: OrgId, fid: string): Promise<string[]> {
  const f = await getFinding(orgId, fid);
  return ((f?.answeredQuestions ?? []) as Array<{ answer: string }>).map((a) => a.answer);
}

Deno.test({
  name: "error-flip — scan counts impacted vs clean and writes NOTHING",
  ...kvOpts,
  fn: async () => {
    resetFirestoreCredentials();
    const orgId = uniqueOrg();
    await makeFinding(orgId, "bad-1", ["Yes", "Error", "Yes"]);
    await makeFinding(orgId, "good-1", ["Yes", "Yes", "No"]);

    const r = await processErrorFlipBatch(orgId, ["bad-1", "good-1"], "scan");
    assertEquals(r.scanned, 2);
    assertEquals(r.impacted, 1);
    assertEquals(r.clean, 1);
    assertEquals(r.errorQuestions, 1);
    assertEquals(r.flipped, 0, "scan mode must never write");
    assertEquals(r.impactedFids, ["bad-1"]);

    // The Error answer is still on disk, untouched, so a scan is re-runnable.
    assertEquals(await answersOf(orgId, "bad-1"), ["Yes", "Error", "Yes"]);
    assertEquals(await answersOf(orgId, "good-1"), ["Yes", "Yes", "No"]);
  },
});

Deno.test({
  name: "error-flip — scan reports the genuine fails a force-to-100 would erase",
  ...kvOpts,
  fn: async () => {
    resetFirestoreCredentials();
    const orgId = uniqueOrg();
    // 1 ungraded question, 2 genuine failures the operator is about to pass.
    await makeFinding(orgId, "bad-1", ["Yes", "Error", "No", "No"]);

    const r = await processErrorFlipBatch(orgId, ["bad-1"], "scan");
    assertEquals(r.impacted, 1);
    assertEquals(r.errorQuestions, 1);
    assertEquals(r.realFails, 2, "the blast radius must be visible before the button");
    assertEquals(r.samples.length, 1);
    const s = r.samples[0];
    assertEquals(s.findingId, "bad-1");
    assertEquals(s.errorCount, 1);
    assertEquals(s.realFailCount, 2);
    assertEquals(s.totalQuestions, 4);
    assertEquals(s.errorHeaders, ["Q1"], "the operator sees WHICH question was ungraded");
  },
});

Deno.test({
  name: "error-flip — flip removes the Error answer, not just the score",
  ...kvOpts,
  fn: async () => {
    resetFirestoreCredentials();
    const orgId = uniqueOrg();
    await makeFinding(orgId, "bad-1", ["Yes", "Error", "Yes"]);

    const r = await processErrorFlipBatch(orgId, ["bad-1"], "flip");
    assertEquals(r.impacted, 1);
    assertEquals(r.flipped, 1);

    // THE point of the tool: the report renders its verdict off this string.
    const after = await answersOf(orgId, "bad-1");
    assertEquals(after, ["Yes", "Yes", "Yes"]);
    assert(!after.includes("Error"), "no answer may still read Error after a flip");

    const f = await getFinding(orgId, "bad-1");
    assertEquals((f as Record<string, unknown>).reviewScore, 100);
  },
});

Deno.test({
  name: "error-flip — flip also passes genuine fails (the chosen force-to-100 semantics)",
  ...kvOpts,
  fn: async () => {
    resetFirestoreCredentials();
    const orgId = uniqueOrg();
    await makeFinding(orgId, "bad-1", ["Yes", "Error", "No", "No"]);

    await processErrorFlipBatch(orgId, ["bad-1"], "flip");
    assertEquals(
      await answersOf(orgId, "bad-1"),
      ["Yes", "Yes", "Yes", "Yes"],
      "force-to-100 clears real failures too — deliberate, and surfaced by the scan card",
    );
  },
});

Deno.test({
  name: "error-flip — case-insensitive: 'error' and 'ERROR' are the same sentinel",
  ...kvOpts,
  fn: async () => {
    resetFirestoreCredentials();
    const orgId = uniqueOrg();
    await makeFinding(orgId, "lower", ["Yes", "error"]);
    await makeFinding(orgId, "upper", ["Yes", "ERROR"]);

    const r = await processErrorFlipBatch(orgId, ["lower", "upper"], "scan");
    assertEquals(r.impacted, 2, "the report's isErrorAnswer lowercases too — must not disagree");
  },
});

Deno.test({
  name: "error-flip — an Error flip must NOT decrement the question-fail counters",
  ...kvOpts,
  fn: async () => {
    resetFirestoreCredentials();
    const orgId = uniqueOrg();
    const now = Date.now();
    const month = yyyymm(now);

    // Another audit genuinely failed Q1 — step-finalize counted it.
    await incrFailed(orgId, "ql:X", "Q1", "other-fid", now);
    let rows = await readQuestionFailRange(orgId, month, month);
    assertEquals(rows.length, 1);
    assertEquals(rows[0].failed, 1);

    // Our audit's Q1 was never graded, so it was never counted as a failure.
    await makeFinding(orgId, "bad-1", ["Yes", "Error"]);
    await processErrorFlipBatch(orgId, ["bad-1"], "flip");

    rows = await readQuestionFailRange(orgId, month, month);
    assertEquals(
      rows[0].failed,
      1,
      "flipping an ungraded question must not consume another audit's real failure",
    );
    assertEquals(rows[0].flippedToPass, 0, "an Error was never a fail, so it is not a flip-to-pass");
  },
});

Deno.test({
  name: "error-flip — idempotent: a flipped audit is no longer a candidate",
  ...kvOpts,
  fn: async () => {
    resetFirestoreCredentials();
    const orgId = uniqueOrg();
    await makeFinding(orgId, "bad-1", ["Yes", "Error", "Yes"]);

    const first = await processErrorFlipBatch(orgId, ["bad-1"], "flip");
    assertEquals(first.flipped, 1);

    const second = await processErrorFlipBatch(orgId, ["bad-1"], "scan");
    assertEquals(second.impacted, 0, "re-running must find nothing left to do");
    assertEquals(second.clean, 1);
  },
});

Deno.test({
  name: "error-flip — a missing finding is tallied, not thrown",
  ...kvOpts,
  fn: async () => {
    resetFirestoreCredentials();
    const orgId = uniqueOrg();
    await makeFinding(orgId, "bad-1", ["Yes", "Error"]);

    const r = await processErrorFlipBatch(orgId, ["bad-1", "gone-fid"], "scan");
    assertEquals(r.scanned, 2);
    assertEquals(r.impacted, 1);
    assertEquals(r.missing, 1);
    assertEquals(r.errors, 0, "a purged finding is expected, not an error");
  },
});
