/** Tests for review queue FIFO ordering and selection logic +
 *  audit-done-idx sync contract on admin flips. */

import { assertEquals, assert, assertExists } from "#assert";
import { selectOldestFinding, adminFlipQuestion, recordDecision, questionTimingFromGap, REVIEW_BREAK_MS, REVIEW_IDLE_DISCARD_MS } from "./mod.ts";
import type { ReviewDecision, ReviewItem } from "@core/dto/types.ts";
import { getStored, resetFirestoreCredentials, setStored } from "@core/data/firestore/mod.ts";
import { saveFinding, getFinding } from "@audit/domain/data/audit-repository/mod.ts";
import {
  writeAuditDoneIndex,
  queryAuditDoneIndex,
  _resetHiddenCacheForTesting,
} from "@audit/domain/data/stats-repository/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

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

async function makeFindingFixture(orgId: OrgId, findingId: string, answers: string[]): Promise<number> {
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
    record: { RecordId: "r-" + findingId, VoName: "VO 01 - Test Person", ActivatingOffice: "ECG", Shift: "Day" },
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
  assertEquals(entry!.completed, false, "Yes→No flip must clear completed flag");
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
