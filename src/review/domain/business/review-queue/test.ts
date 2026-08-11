/** Tests for review queue FIFO ordering and selection logic +
 *  audit-done-idx sync contract on admin flips. */

import { assertEquals, assert, assertExists } from "#assert";
import { selectOldestFinding, adminFlipQuestion, recordDecision, jumpToQuestion, finalizeReviewedAudit, questionTimingFromGap, getReviewedFindingIds, REVIEW_BREAK_MS, REVIEW_IDLE_DISCARD_MS } from "./mod.ts";
import type { ReviewDecision, ReviewItem } from "@core/dto/types.ts";
import { getStored, resetFirestoreCredentials, setStored } from "@core/data/firestore/mod.ts";
import { saveFinding, getFinding } from "@audit/domain/data/audit-repository/mod.ts";
import {
  writeAuditDoneIndex,
  queryAuditDoneIndex,
  saveChargebackEntry,
  getChargebackEntries,
  getWireDeductionEntries,
  _resetHiddenCacheForTesting,
} from "@audit/domain/data/stats-repository/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

// Regression: getReviewedFindingIds must NOT truncate at 1000 (listStoredWithKeys'
// default cap). Once >1000 findings had ever been reviewed, the capped read froze
// reviewedIds, so chargebacks/omissions/wire reports treated most reviewed
// findings as unreviewed and dropped them — the report cliff.
Deno.test("getReviewedFindingIds — returns ALL reviewed findings, not just the first 1000", async () => {
  resetFirestoreCredentials();
  const orgId = ("test-reviewed-cap-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  const N = 1001;
  for (let i = 0; i < N; i++) {
    await setStored("review-done", orgId, ["fid-" + i], { reviewedAt: new Date(1_700_000_000_000).toISOString(), reviewScore: 90, reviewedBy: "r@x.com" });
  }
  const ids = await getReviewedFindingIds(orgId);
  assertEquals(ids.size, N, "must not silently truncate at 1000");
});

function makeItem(findingId: string, questionIndex: number, completedAt?: number, recordingIdField?: string): { value: ReviewItem } {
  return {
    value: {
      findingId, questionIndex, reviewIndex: questionIndex + 1, totalForFinding: 1,
      header: `Q${questionIndex}`, populated: `Question ${questionIndex}`,
      thinking: "thinking", defense: "defense", answer: "No",
      ...(completedAt != null ? { completedAt } : {}),
      ...(recordingIdField ? { recordingIdField } : {}),
    },
  };
}

Deno.test("FIFO — oldest finding picked first", () => {
  const fri = new Date("2026-04-10T12:00:00Z").getTime();
  const sat = new Date("2026-04-11T12:00:00Z").getTime();
  const sun = new Date("2026-04-12T12:00:00Z").getTime();
  const items = [makeItem("sat", 0, sat), makeItem("sun", 0, sun), makeItem("fri", 0, fri)];
  assertEquals(selectOldestFinding(items).targetFindingId, "fri");
});

Deno.test("FIFO — no completedAt treated as oldest", () => {
  const items = [makeItem("new", 0, Date.now()), makeItem("old-no-ts", 0)];
  assertEquals(selectOldestFinding(items).targetFindingId, "old-no-ts");
});

Deno.test("FIFO — type filtering before selection", () => {
  const items = [makeItem("pkg", 0, 1000, "GenieNumber"), makeItem("dl", 0, 2000)];
  assertEquals(selectOldestFinding(items, ["date-leg"]).targetFindingId, "dl");
});

Deno.test("FIFO — all items for selected finding returned", () => {
  const items = [makeItem("A", 0, 1000), makeItem("A", 1, 1000), makeItem("A", 2, 1000), makeItem("B", 0, 2000)];
  const { targetFindingId, indices } = selectOldestFinding(items);
  assertEquals(targetFindingId, "A");
  assertEquals(indices.length, 3);
});

Deno.test("FIFO — empty returns null", () => {
  assertEquals(selectOldestFinding([]).targetFindingId, null);
});

Deno.test("FIFO — type filter removes all returns null", () => {
  const items = [makeItem("pkg", 0, 1000, "GenieNumber")];
  assertEquals(selectOldestFinding(items, ["date-leg"]).targetFindingId, null);
});

// ── adminFlipQuestion — audit-done-idx sync contract ──────────────────────────
// These tests lock the invariant that EVERY mutation to finding.answeredQuestions
// must also write a fresh audit-done-idx entry, so the unreviewed-audits +
// audit-history queries never serve stale scores. User-visible symptom that
// motivated this contract: Bulk Flip showed 18 audits at 80-90% but their
// reports rendered as 100% — admins had pencil-flipped questions without the
// index being updated. If a future change removes the writeAuditDoneIndex call
// from adminFlipQuestion, these tests fail — fix the code, not the tests.

function resetForTest() {
  resetFirestoreCredentials();
  _resetHiddenCacheForTesting();
}

async function makeFindingFixture(
  orgId: OrgId,
  findingId: string,
  answers: string[],
  opts: { isPackage?: boolean } = {},
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
    // buildIndexMeta keys isPackage off recordingIdField === "GenieNumber".
    recordingIdField: opts.isPackage ? "GenieNumber" : "VoGenie",
    owner: "test@x.com",
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

Deno.test("adminFlipQuestion — partial flip writes audit-done-idx with recomputed score (60→80)", async () => {
  resetForTest();
  const ORG = ("test-flip-q-partial-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
  const fid = "fid-partial-" + crypto.randomUUID().slice(0, 8);
  // 5 questions: 3 Yes, 2 No → score 60%
  const completedAt = await makeFindingFixture(ORG, fid, ["Yes", "Yes", "Yes", "No", "No"]);
  // Seed the index with the stale pre-flip score (60%) — simulates the
  // index entry written by stepFinalize at audit-completion time.
  await writeAuditDoneIndex(ORG, {
    findingId: fid,
    completedAt,
    score: 60,
    completed: false,
    isPackage: false,
    recordId: "r-" + fid,
  });

  const r = await adminFlipQuestion(ORG, fid, 3); // flip question[3] No→Yes
  assertEquals(r.success, true);
  assertEquals(r.score, 80);

  // Finding's answeredQuestions reflects the flip.
  const refreshed = await getFinding(ORG, fid);
  assertExists(refreshed);
  const qs = (refreshed!.answeredQuestions ?? []) as Array<{ answer: string }>;
  assertEquals(qs[3].answer, "Yes");

  // Index entry rewritten with new score AND completed:false (still 80%).
  const idx = await queryAuditDoneIndex(ORG, completedAt - 1000, completedAt + 1000);
  const entry = idx.find((e) => e.findingId === fid);
  assertExists(entry, "index entry must exist after adminFlipQuestion");
  assertEquals(entry!.score, 80, "index score must be the post-flip 80, not stale 60");
  assertEquals(entry!.completed, false, "score < 100 must NOT mark completed");
});

Deno.test("adminFlipQuestion — flip-to-100 marks completed:true, reason:reviewed", async () => {
  resetForTest();
  const ORG = ("test-flip-q-full-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
  const fid = "fid-full-" + crypto.randomUUID().slice(0, 8);
  // 4 questions: 3 Yes, 1 No → 75%. Flipping the last No → 100%.
  const completedAt = await makeFindingFixture(ORG, fid, ["Yes", "Yes", "Yes", "No"]);
  await writeAuditDoneIndex(ORG, {
    findingId: fid, completedAt, score: 75, completed: false, isPackage: false,
  });

  const r = await adminFlipQuestion(ORG, fid, 3);
  assertEquals(r.success, true);
  assertEquals(r.score, 100);

  const idx = await queryAuditDoneIndex(ORG, completedAt - 1000, completedAt + 1000);
  const entry = idx.find((e) => e.findingId === fid);
  assertExists(entry);
  assertEquals(entry!.score, 100);
  assertEquals(entry!.completed, true, "score === 100 must mark completed");
  assertEquals(entry!.reason, "reviewed", "score === 100 must set reason=reviewed");
});

Deno.test("adminFlipQuestion — reverse flip (Yes→No) drops index score appropriately", async () => {
  resetForTest();
  const ORG = ("test-flip-q-reverse-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
  const fid = "fid-rev-" + crypto.randomUUID().slice(0, 8);
  // 4 questions all Yes → 100%. Flipping one to No → 75%.
  const completedAt = await makeFindingFixture(ORG, fid, ["Yes", "Yes", "Yes", "Yes"]);
  await writeAuditDoneIndex(ORG, {
    findingId: fid, completedAt, score: 100, completed: true, reason: "reviewed",
    isPackage: false,
  });

  const r = await adminFlipQuestion(ORG, fid, 0);
  assertEquals(r.score, 75);

  const idx = await queryAuditDoneIndex(ORG, completedAt - 1000, completedAt + 1000);
  const entry = idx.find((e) => e.findingId === fid);
  assertExists(entry);
  assertEquals(entry!.score, 75, "Yes→No flip must drop index score from 100 to 75");
  // A finalized audit STAYS completed: the flip changes its score, not whether
  // a human finished it. Clearing the flag here dropped the audit out of every
  // weekly report (email-report-engine filters on `e.completed && e.doneAt`)
  // while audit history still showed it REVIEWED.
  assertEquals(entry!.completed, true, "Yes→No flip must not un-complete a finalized audit");
});

Deno.test("adminFlipQuestion — reverse flip leaves an UNFINALIZED audit not-completed", async () => {
  resetForTest();
  const ORG = ("test-flip-q-unfinal-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
  const fid = "fid-unfinal-" + crypto.randomUUID().slice(0, 8);
  const completedAt = await makeFindingFixture(ORG, fid, ["Yes", "Yes", "Yes", "Yes"]);
  // Bot-completed at 100 was never the state here: the row is a plain unfinalized
  // one, so the flip must leave it unfinalized (still surfaceable as unreviewed).
  await writeAuditDoneIndex(ORG, {
    findingId: fid, completedAt, score: 100, completed: false, isPackage: false,
  });

  await adminFlipQuestion(ORG, fid, 0);

  const idx = await queryAuditDoneIndex(ORG, completedAt - 1000, completedAt + 1000);
  const entry = idx.find((e) => e.findingId === fid);
  assertExists(entry);
  assertEquals(entry!.completed, false, "an unfinalized audit must stay not-completed");
});

// ── Per-question timing capture (handleMs / idle discard) ───────────────────

function tOrg(tag: string): OrgId {
  return (`test-rq-${tag}-${crypto.randomUUID().slice(0, 8)}`) as unknown as OrgId;
}

Deno.test("recordDecision — stores active handleMs + idleMs (not discarded)", async () => {
  resetFirestoreCredentials();
  const orgId = tOrg("handle");
  const fid = "rt-fid-a", reviewer = "rev@example.com";
  await setStored("review-pending", orgId, [fid, 0], {
    findingId: fid, questionIndex: 0, reviewIndex: 1, totalForFinding: 1,
    header: "Taxes Due", populated: "p", thinking: "t", defense: "d", answer: "No",
  });
  await setStored("review-audit-pending", orgId, [fid], 1);
  await recordDecision(orgId, fid, 0, "confirm", reviewer, 45_000, 3_000);
  const d = await getStored<ReviewDecision>("review-decided", orgId, fid, 0);
  assertExists(d);
  assertEquals(d!.handleMs, 45_000);
  assertEquals(d!.idleMs, 3_000);
  assertEquals(d!.discarded, false);
  assertEquals(d!.header, "Taxes Due", "carries the question header from review-pending");
});

Deno.test("recordDecision — idle >= 60s marks the question discarded", async () => {
  resetFirestoreCredentials();
  const orgId = tOrg("discard");
  const fid = "rt-fid-b", reviewer = "rev@example.com";
  await setStored("review-audit-pending", orgId, [fid], 1);
  await recordDecision(orgId, fid, 0, "confirm", reviewer, 8_000, REVIEW_IDLE_DISCARD_MS);
  const d = await getStored<ReviewDecision>("review-decided", orgId, fid, 0);
  assertExists(d);
  assertEquals(d!.discarded, true, "idleMs >= 60s ⇒ discarded");
});

// ── questionTimingFromGap — server-measured per-question handle ──────────────

Deno.test("questionTimingFromGap — normal gap counts as handle time", () => {
  const t = questionTimingFromGap(42_000, 0);
  assertEquals(t.discarded, false);
  assertEquals(t.handleMs, 42_000);
});

Deno.test("questionTimingFromGap — no prior gap (first question) is discarded", () => {
  assertEquals(questionTimingFromGap(undefined, 0).discarded, true);
});

Deno.test("questionTimingFromGap — gap over the 15-min break is discarded", () => {
  assertEquals(questionTimingFromGap(REVIEW_BREAK_MS + 1, 0).discarded, true);
  assertEquals(questionTimingFromGap(REVIEW_BREAK_MS, 0).discarded, false);
});

Deno.test("questionTimingFromGap — client idle >= 60s discards even a short gap", () => {
  assertEquals(questionTimingFromGap(5_000, REVIEW_IDLE_DISCARD_MS).discarded, true);
  assertEquals(questionTimingFromGap(5_000, REVIEW_IDLE_DISCARD_MS - 1).discarded, false);
});

// ── Re-decision must NOT double-decrement the audit-pending counter ──────────
// Regression for the "submits as 96%" bug: clicking a Failed-Questions pill to
// go BACK to an already-decided question re-creates a review-active row for it
// (jumpToQuestion), and recordDecision used to decrement review-audit-pending
// again on the re-grade. That made the counter under-count the still-undecided
// questions, so the audit's NEXT question falsely looked like the last one,
// finalized early, and a flip was dropped → wrong score. The Undo path is
// unaffected (it increments the counter), which is why this only reproduced on
// pill-click navigation.

async function seedClaimedAudit(
  orgId: OrgId,
  fid: string,
  reviewer: string,
  answers: string[],
): Promise<void> {
  await makeFindingFixture(orgId, fid, answers);
  const noIdx = answers.map((a, i) => ({ a, i })).filter((x) => x.a === "No").map((x) => x.i);
  const now = Date.now();
  for (const [reviewIdx, qi] of noIdx.entries()) {
    await setStored("review-active", orgId, [reviewer, fid, qi], {
      findingId: fid, questionIndex: qi, reviewIndex: reviewIdx + 1, totalForFinding: noIdx.length,
      header: `Q${qi}`, populated: `populated ${qi}`, thinking: `thinking ${qi}`, defense: `defense ${qi}`,
      answer: "No", claimedAt: now,
    });
  }
  await setStored("review-audit-pending", orgId, [fid], noIdx.length);
}

Deno.test("recordDecision — re-deciding via jump does NOT decrement the counter again", async () => {
  resetForTest();
  const orgId = ("test-redecide-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
  const fid = "fid-redecide", reviewer = "rev@example.com";
  // 5 questions, q0/q1/q2 = No.
  await seedClaimedAudit(orgId, fid, reviewer, ["No", "No", "No", "Yes", "Yes"]);

  const first = await recordDecision(orgId, fid, 0, "flip", reviewer);
  assertEquals(first.remaining, 2, "first decision on q0 decrements 3 → 2");

  // Go back to q0 via the pill (recreates the active row) and re-grade it.
  await jumpToQuestion(orgId, reviewer, fid, 0);
  const second = await recordDecision(orgId, fid, 0, "confirm", reviewer);

  assertEquals(second.remaining, 2, "re-deciding q0 must keep the counter at 2 (q1, q2 still undecided)");
  assertEquals(second.auditComplete, false, "audit is NOT complete — two questions remain");
  const counter = await getStored<number>("review-audit-pending", orgId, fid);
  assertEquals(counter, 2, "stored counter is unchanged by the re-decision");
});

Deno.test("review flow — click back to an early question, re-grade, finish all → finalize 100% (no dropped flip)", async () => {
  // Faithful end-to-end of the reported scenario. Without the fix the audit
  // finalizes after the SECOND graded question and the third flip is lost
  // (score 80% here / 96% on a 25-question finding).
  const orgId = ("test-reflow-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
  const fid = "fid-reflow", reviewer = "rev@example.com";
  resetForTest();
  await seedClaimedAudit(orgId, fid, reviewer, ["No", "No", "No", "Yes", "Yes"]); // q0,q1,q2 fail

  // Grade q0 and q1, then click BACK to q0 and re-grade it (the trigger).
  await recordDecision(orgId, fid, 0, "flip", reviewer); // 3 → 2
  await recordDecision(orgId, fid, 1, "flip", reviewer); // 2 → 1
  await jumpToQuestion(orgId, reviewer, fid, 0);
  const reQ0 = await recordDecision(orgId, fid, 0, "flip", reviewer); // re-grade: stays 1
  assertEquals(reQ0.remaining, 1, "after re-grading q0, one question (q2) still remains");
  assertEquals(reQ0.auditComplete, false, "must not finalize before q2 is graded");

  // Now grade the third question — THIS should complete the audit.
  const q2 = await recordDecision(orgId, fid, 2, "flip", reviewer);
  assertEquals(q2.remaining, 0);
  assertEquals(q2.auditComplete, true, "audit completes only after all three are graded");

  const result = await finalizeReviewedAudit(orgId, fid, reviewer);
  assertEquals(result.score, 100, "all three No→Yes flips applied → 100% (third flip not dropped)");

  const refreshed = await getFinding(orgId, fid);
  assertExists(refreshed);
  const qs = (refreshed!.answeredQuestions ?? []) as Array<{ answer: string }>;
  assertEquals(qs.filter((q) => q.answer === "Yes").length, 5, "every question is Yes after finalize");
});

Deno.test("recordDecision — normal forward grading still decrements to 0 + completes on the last", async () => {
  resetForTest();
  const orgId = ("test-forward-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
  const fid = "fid-forward", reviewer = "rev@example.com";
  await seedClaimedAudit(orgId, fid, reviewer, ["No", "No", "No"]); // 3 fail

  const r0 = await recordDecision(orgId, fid, 0, "flip", reviewer);
  assertEquals([r0.remaining, r0.auditComplete], [2, false]);
  const r1 = await recordDecision(orgId, fid, 1, "confirm", reviewer);
  assertEquals([r1.remaining, r1.auditComplete], [1, false]);
  const r2 = await recordDecision(orgId, fid, 2, "flip", reviewer);
  assertEquals([r2.remaining, r2.auditComplete], [0, true]);
});

// ── Chargeback ("payroll") sync on review-finalize ──────────────────────────
// Production bug (record 483830 / ACT MB): the bot finalized at 88% and saved a
// chargeback entry; a reviewer flipped all 3 fails to Yes → 100%, but the
// chargeback entry was NEVER updated, so the audit stayed on the chargeback /
// "failed VOs" payroll sheet as an 88% fail despite passing on review. The
// reviewedIds-filtered chargeback report includes reviewed findings, so the
// stale entry surfaced. finalizeReviewedAudit must now resync the entry.

Deno.test("review-finalize — flip ALL fails to pass deletes the stale chargeback entry (the 483830 bug)", async () => {
  resetForTest();
  const orgId = ("test-cb-del-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
  const fid = "fid-cb-del", reviewer = "rev@example.com";
  // 5 questions, 3 fail → 40%. Bot saved a chargeback entry at that score.
  await seedClaimedAudit(orgId, fid, reviewer, ["No", "No", "No", "Yes", "Yes"]);
  await saveChargebackEntry(orgId, {
    findingId: fid, ts: Date.now(), voName: "Test Person", destination: "HI - Las Vegas, NV",
    revenue: "354.09", recordId: "r-" + fid, score: 40,
    failedQHeaders: ["Q0", "Q1", "Q2"], egregiousHeaders: [], omissionHeaders: ["Q0", "Q1", "Q2"],
  });

  // Reviewer flips all three fails to pass → 100%.
  await recordDecision(orgId, fid, 0, "flip", reviewer);
  await recordDecision(orgId, fid, 1, "flip", reviewer);
  await recordDecision(orgId, fid, 2, "flip", reviewer);
  const result = await finalizeReviewedAudit(orgId, fid, reviewer);
  assertEquals(result.score, 100);

  const entries = await getChargebackEntries(orgId, 0, Date.now() + 10_000);
  assertEquals(entries.find((e) => e.findingId === fid), undefined, "passing review must drop the chargeback entry");
});

Deno.test("review-finalize — partial flip rewrites the chargeback entry to the reviewed score + remaining fails", async () => {
  resetForTest();
  const orgId = ("test-cb-partial-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
  const fid = "fid-cb-partial", reviewer = "rev@example.com";
  // 5 questions, q0/q1 fail → 60%. Bot chargeback entry lists both.
  await seedClaimedAudit(orgId, fid, reviewer, ["No", "No", "Yes", "Yes", "Yes"]);
  await saveChargebackEntry(orgId, {
    findingId: fid, ts: Date.now(), voName: "Test Person", destination: "HI - Las Vegas, NV",
    revenue: "100", recordId: "r-" + fid, score: 60,
    failedQHeaders: ["Q0", "Q1"], egregiousHeaders: [], omissionHeaders: ["Q0", "Q1"],
  });

  // Reviewer flips q0 to pass, CONFIRMS q1 as a real fail → 80%, one fail remains.
  await recordDecision(orgId, fid, 0, "flip", reviewer);
  await recordDecision(orgId, fid, 1, "confirm", reviewer);
  const result = await finalizeReviewedAudit(orgId, fid, reviewer);
  assertEquals(result.score, 80);

  const entries = await getChargebackEntries(orgId, 0, Date.now() + 10_000);
  const entry = entries.find((e) => e.findingId === fid);
  assertExists(entry, "a still-failing audit keeps a chargeback entry");
  assertEquals(entry!.score, 80, "entry score is rewritten to the reviewed 80, not the stale 60");
  assertEquals(entry!.failedQHeaders, ["Q1"], "only the confirmed-fail question remains; the flipped one is dropped");
});

Deno.test("adminFlipQuestion — Yes→No creates a chargeback entry; flipping back to 100% removes it", async () => {
  resetForTest();
  const orgId = ("test-cb-adminflip-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
  const fid = "fid-cb-adminflip-" + crypto.randomUUID().slice(0, 8);
  // 4 questions all Yes → 100%, clean (no chargeback entry).
  const completedAt = await makeFindingFixture(orgId, fid, ["Yes", "Yes", "Yes", "Yes"]);
  await writeAuditDoneIndex(orgId, {
    findingId: fid, completedAt, score: 100, completed: true, reason: "reviewed", isPackage: false,
  });

  // Admin pencil-flips q0 Yes→No → 75% → a chargeback entry must now exist.
  await adminFlipQuestion(orgId, fid, 0, "admin@x.com");
  let entries = await getChargebackEntries(orgId, 0, Date.now() + 10_000);
  const entry = entries.find((e) => e.findingId === fid);
  assertExists(entry, "a Yes→No admin flip on a clean audit creates a chargeback entry");
  assertEquals(entry!.score, 75);
  assertEquals(entry!.failedQHeaders, ["Q0"]);

  // Flip it back No→Yes → 100% → the chargeback entry is dropped.
  await adminFlipQuestion(orgId, fid, 0, "admin@x.com");
  entries = await getChargebackEntries(orgId, 0, Date.now() + 10_000);
  assertEquals(entries.find((e) => e.findingId === fid), undefined, "flipping back to 100% removes the chargeback entry");
});

Deno.test("adminFlipQuestion (package) — wire entry written on fail, DELETED on flip-back-to-100 (symmetric)", async () => {
  resetForTest();
  const orgId = ("test-wire-adminflip-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
  const fid = "fid-wire-" + crypto.randomUUID().slice(0, 8);
  // 4 questions all Yes → 100%, PARTNER (package) finding, clean (no wire entry).
  const completedAt = await makeFindingFixture(orgId, fid, ["Yes", "Yes", "Yes", "Yes"], { isPackage: true });
  await writeAuditDoneIndex(orgId, {
    findingId: fid, completedAt, score: 100, completed: true, reason: "reviewed", isPackage: true,
  });

  // Flip q0 Yes→No → 75% → a wire entry must appear with the post-flip score.
  await adminFlipQuestion(orgId, fid, 0, "admin@x.com");
  let wire = await getWireDeductionEntries(orgId, 0, Date.now() + 10_000);
  const entry = wire.find((e) => e.findingId === fid);
  assertExists(entry, "a Yes→No flip on a package finding writes a wire deduction entry");
  assertEquals(entry!.score, 75);
  assertEquals(entry!.totalSuccess, 3, "totalSuccess counts the 3 remaining Yes (=== \"Yes\")");
  assertEquals(entry!.questionsAudited, 4);

  // Flip back No→Yes → 100% → the wire entry is DELETED, not left as a hidden
  // 100% row (the symmetric-delete fix; otherwise a read-filter change resurfaces it).
  await adminFlipQuestion(orgId, fid, 0, "admin@x.com");
  wire = await getWireDeductionEntries(orgId, 0, Date.now() + 10_000);
  assertEquals(wire.find((e) => e.findingId === fid), undefined, "flipping back to 100% deletes the wire entry");
});
