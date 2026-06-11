/** Smoke + unit tests for the judge repository:
 *  - basic queue populate / decide / dismiss
 *  - dedup soft-hide path (markFindingHidden / deleteDuplicates)
 *  - postJudgedAudit's audit-done-idx sync contract
 *
 *  The dedup + postJudgedAudit sections force in-mem Firestore mode via
 *  resetFirestoreCredentials() so no real Firestore is involved. */

import { assert, assertEquals, assertExists } from "#assert";
import {
  populateJudgeQueue,
  recordJudgeDecision,
  getJudgeStats,
  claimNextItem,
  dismissFindingFromJudgeQueue,
  findDuplicates,
  deleteDuplicates,
  postJudgedAudit,
  type DedupPlan,
} from "./mod.ts";
import {
  resetFirestoreCredentials,
  setStored,
  getStored,
} from "@core/data/firestore/mod.ts";
import { saveFinding, getFinding } from "@audit/domain/data/audit-repository/mod.ts";
import {
  writeAuditDoneIndex,
  queryAuditDoneIndex,
  markFindingHidden,
  getHiddenFindingIds,
  _resetHiddenCacheForTesting,
  type AuditHiddenEntry,
} from "@audit/domain/data/stats-repository/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

const kvOpts = { sanitizeResources: false, sanitizeOps: false };
const ORG = "test-org-" + crypto.randomUUID().slice(0, 8);

function reset() {
  resetFirestoreCredentials();
  _resetHiddenCacheForTesting();
}

// ─── basic queue flow ──────────────────────────────────────────────────────

Deno.test({ name: "judge queue — populate and stats", ...kvOpts, fn: async () => {
  const questions = [
    { header: "Q1", populated: "P1", thinking: "T1", defense: "D1", answer: "No" },
    { header: "Q2", populated: "P2", thinking: "T2", defense: "D2", answer: "No" },
  ];
  await populateJudgeQueue(ORG, "f-judge-1", questions, "redo");
  const stats = await getJudgeStats(ORG);
  assert(stats.pending >= 2);
}});

Deno.test({ name: "judge — decide reduces pending", ...kvOpts, fn: async () => {
  const qs = [{ header: "Q", populated: "P", thinking: "T", defense: "D", answer: "No" }];
  await populateJudgeQueue(ORG, "f-judge-2", qs);
  const { remaining } = await recordJudgeDecision(ORG, "f-judge-2", 0, "uphold", "judge@test.com");
  assertEquals(remaining, 0);
}});

Deno.test({ name: "judge — dismiss removes from queue", ...kvOpts, fn: async () => {
  const qs = [{ header: "Q", populated: "P", thinking: "T", defense: "D", answer: "No" }];
  await populateJudgeQueue(ORG, "f-judge-dismiss", qs);
  const { dismissed } = await dismissFindingFromJudgeQueue(ORG, "f-judge-dismiss");
  assert(dismissed > 0);
}});

// ─── getJudgeStats parity with the queue ───────────────────────────────────
// Regression for the "dashboard says 16 pending, queue is All caught up" bug:
// getJudgeStats must count only rows the queue will actually serve — i.e. it
// must apply the same hidden-finding + auto-skip-appealType gate claimNextItem
// uses. A raw judge-pending row count over-reports because hidden rows linger.

Deno.test({ name: "getJudgeStats — hidden finding is excluded from pending", ...kvOpts, fn: async () => {
  reset();
  const org = ("test-jstats-hidden-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
  const fid = "f-jstats-hidden";
  const questions = [
    { header: "Q1", populated: "P1", thinking: "T1", defense: "D1", answer: "No" },
    { header: "Q2", populated: "P2", thinking: "T2", defense: "D2", answer: "No" },
  ];
  await populateJudgeQueue(org, fid, questions);
  assertEquals((await getJudgeStats(org)).pending, 2, "both questions count while visible");

  // Soft-hide the finding (dedup path) — it stays in judge-pending but must
  // drop out of the count, exactly like the queue stops serving it.
  await markFindingHidden(org, fid, "dedup");
  _resetHiddenCacheForTesting(); // bust the SWR cache primed by the count above
  assertEquals((await getJudgeStats(org)).pending, 0, "hidden finding must not be counted");
}});

Deno.test({ name: "getJudgeStats — auto-skip appeal type is excluded from pending", ...kvOpts, fn: async () => {
  reset();
  const org = ("test-jstats-skip-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
  const qs = [{ header: "Q", populated: "P", thinking: "T", defense: "D", answer: "No" }];
  await populateJudgeQueue(org, "f-jstats-skip", qs, "different-recording");
  assertEquals((await getJudgeStats(org)).pending, 0, "auto-skip appealType must not be counted");
}});

Deno.test({ name: "getJudgeStats — a normal pending item is counted", ...kvOpts, fn: async () => {
  reset();
  const org = ("test-jstats-normal-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
  const qs = [{ header: "Q", populated: "P", thinking: "T", defense: "D", answer: "No" }];
  await populateJudgeQueue(org, "f-jstats-normal", qs);
  assertEquals((await getJudgeStats(org)).pending, 1, "a plain, visible appeal must be counted");
}});

Deno.test({ name: "getJudgeStats — pendingAudits counts distinct appeals, pending counts questions", ...kvOpts, fn: async () => {
  reset();
  const org = ("test-jstats-audits-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
  await populateJudgeQueue(org, "f-audit-A", [
    { header: "Q1", populated: "P", thinking: "T", defense: "D", answer: "No" },
    { header: "Q2", populated: "P", thinking: "T", defense: "D", answer: "No" },
  ]);
  await populateJudgeQueue(org, "f-audit-B", [
    { header: "Q1", populated: "P", thinking: "T", defense: "D", answer: "No" },
  ]);
  const s = await getJudgeStats(org);
  assertEquals(s.pending, 3, "3 question-rows pending across both audits");
  assertEquals(s.pendingAudits, 2, "2 distinct appeals/audits pending");
}});

// Pins the listStoredWithKeysAll fix: getJudgeStats must page past the 1000-row
// single-shot cap that plain listStoredWithKeys imposes. Every other stats test
// uses tiny fixtures, so a regression to the capped scan would be invisible to
// them. Seed 1001 rows (comfortably over the page boundary) on BOTH scanned
// types — judge-pending and judge-decided — and assert the full count survives.
// With the capped scan these would read ~1000; with listStoredWithKeysAll, 1001.
Deno.test({ name: "getJudgeStats — pending + decided counts page past the 1000-row cap", ...kvOpts, fn: async () => {
  reset();
  const org = ("test-jstats-page-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
  const OVER_CAP = 1001;

  // 1001 distinct findings, one question each → 1001 pending rows AND 1001
  // distinct appeals, so both `pending` and `pendingAudits` must read 1001.
  for (let i = 0; i < OVER_CAP; i++) {
    await populateJudgeQueue(org, "f-cap-" + i, [
      { header: "Q", populated: "P", thinking: "T", defense: "D", answer: "No" },
    ]);
  }
  // Seed judge-decided directly (recordJudgeDecision ×1001 would be needlessly
  // slow) — getJudgeStats reads `decided` via the same paged scan.
  for (let i = 0; i < OVER_CAP; i++) {
    await setStored("judge-decided", org, ["f-dec-" + i, 0], {
      findingId: "f-dec-" + i, questionIndex: 0, judge: "j@test.com", decidedAt: i,
    });
  }

  const s = await getJudgeStats(org);
  assertEquals(s.pending, OVER_CAP, "every pending row counts past the page cap");
  assertEquals(s.pendingAudits, OVER_CAP, "every distinct appeal counts past the page cap");
  assertEquals(s.decided, OVER_CAP, "every decided row counts past the page cap");
}});

// claimNextItem's two non-servable branches differ — pin them: skip-type rows
// are DRAINED (deleted + counter decremented), hidden rows LINGER (untouched).

Deno.test({ name: "claimNextItem — auto-skip rows are drained and the audit counter cleared", ...kvOpts, fn: async () => {
  reset();
  const org = ("test-claim-skip-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
  const fid = "f-claim-skip";
  await populateJudgeQueue(org, fid, [
    { header: "Q1", populated: "P", thinking: "T", defense: "D", answer: "No" },
    { header: "Q2", populated: "P", thinking: "T", defense: "D", answer: "No" },
  ], "different-recording");
  const { buffer } = await claimNextItem(org, "judge@test.com");
  assertEquals(buffer.length, 0, "auto-skip rows are never served to a judge");
  assertEquals((await getJudgeStats(org)).pending, 0, "drained rows leave judge-pending");
  assertEquals(await getStored("judge-audit-pending", org, fid), null, "audit counter cleared once it drains to zero");
}});

Deno.test({ name: "claimNextItem — hidden rows are left in place, not drained", ...kvOpts, fn: async () => {
  reset();
  const org = ("test-claim-hidden-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
  const fid = "f-claim-hidden";
  await populateJudgeQueue(org, fid, [{ header: "Q", populated: "P", thinking: "T", defense: "D", answer: "No" }]);
  await markFindingHidden(org, fid, "dedup");
  _resetHiddenCacheForTesting();
  const { buffer } = await claimNextItem(org, "judge@test.com");
  assertEquals(buffer.length, 0, "hidden rows are not served");
  assertEquals(await getStored("judge-audit-pending", org, fid), 1, "hidden row lingers — its counter is untouched (NOT drained)");
  assertEquals((await getJudgeStats(org)).pending, 0, "and it stays excluded from the count");
}});

// ─── dedup soft-hide path ──────────────────────────────────────────────────

const DEDUP_ORG = "test-org" as OrgId;

Deno.test("dedup — markFindingHidden writes the audit-hidden doc", async () => {
  reset();
  await markFindingHidden(DEDUP_ORG, "fid-1", "dedup");
  const v = await getStored<AuditHiddenEntry>("audit-hidden", DEDUP_ORG, "fid-1");
  assertExists(v);
  assertEquals(v?.findingId, "fid-1");
  assertEquals(v?.reason, "duplicate");
  assertEquals(v?.hiddenBy, "dedup");
  assert(typeof v?.hiddenAt === "number" && v.hiddenAt > 0);
});

Deno.test("dedup — getHiddenFindingIds returns the right Set", async () => {
  reset();
  await markFindingHidden(DEDUP_ORG, "fid-a", "dedup");
  await markFindingHidden(DEDUP_ORG, "fid-b", "dedup");
  const ids = await getHiddenFindingIds(DEDUP_ORG);
  assert(ids.has("fid-a"));
  assert(ids.has("fid-b"));
});

Deno.test("dedup — deleteDuplicates flags every loser with audit-hidden", async () => {
  reset();
  const ts = 1_700_000_000_000;
  const plan: DedupPlan = {
    scanned: 3, groups: 1, orphaned: 0,
    toDelete: [
      { id: "fid-keep", recordKey: "rk", ts, reviewed: true, keep: true },
      { id: "fid-loser-1", recordKey: "rk", ts, reviewed: false, keep: false },
      { id: "fid-loser-2", recordKey: "rk", ts, reviewed: false, keep: false },
    ],
  };
  const result = await deleteDuplicates(DEDUP_ORG, plan);
  assertEquals(result.deleted, 2);

  // Losers flagged
  assertExists(await getStored("audit-hidden", DEDUP_ORG, "fid-loser-1"));
  assertExists(await getStored("audit-hidden", DEDUP_ORG, "fid-loser-2"));
  // Keeper NOT flagged
  assertEquals(await getStored("audit-hidden", DEDUP_ORG, "fid-keep"), null);
});

Deno.test("dedup — deleteDuplicates is idempotent (call twice, no errors)", async () => {
  reset();
  const ts = 1_700_000_000_000;
  const plan: DedupPlan = {
    scanned: 1, groups: 1, orphaned: 0,
    toDelete: [{ id: "fid-idem", recordKey: "rk", ts, reviewed: false, keep: false }],
  };
  await deleteDuplicates(DEDUP_ORG, plan);
  await deleteDuplicates(DEDUP_ORG, plan); // must not throw
  const v = await getStored<AuditHiddenEntry>("audit-hidden", DEDUP_ORG, "fid-idem");
  assertExists(v);
});

Deno.test("dedup — flagged findings stay in audit-finding (no physical delete)", async () => {
  reset();
  const findingId = "fid-stays";
  const ts = 1_700_000_000_000;
  await setStored("audit-finding", DEDUP_ORG, [findingId], { id: findingId, body: "still here" });

  const plan: DedupPlan = {
    scanned: 1, groups: 1, orphaned: 0,
    toDelete: [{ id: findingId, recordKey: "rk", ts, reviewed: false, keep: false }],
  };
  await deleteDuplicates(DEDUP_ORG, plan);

  const stillThere = await getStored<{ id: string; body: string }>("audit-finding", DEDUP_ORG, findingId);
  assertExists(stillThere);
  assertEquals(stillThere?.body, "still here");
});

Deno.test("dedup — queryAuditDoneIndex hides flagged findings", async () => {
  reset();
  const tsA = 1_700_000_000_000;
  const tsB = 1_700_000_001_000;
  await writeAuditDoneIndex(DEDUP_ORG, {
    findingId: "fid-visible", completedAt: tsA, completed: true, score: 90, recordId: "r1",
  });
  await writeAuditDoneIndex(DEDUP_ORG, {
    findingId: "fid-hidden", completedAt: tsB, completed: true, score: 80, recordId: "r2",
  });
  await markFindingHidden(DEDUP_ORG, "fid-hidden", "dedup");

  const got = await queryAuditDoneIndex(DEDUP_ORG, tsA - 1, tsB + 1);
  const ids = got.map((e) => e.findingId).sort();
  assertEquals(ids, ["fid-visible"]);
});

Deno.test("dedup — findDuplicates is idempotent after deleteDuplicates", async () => {
  reset();
  const recordId = "rec-shared";
  const tsA = 1_700_000_000_000;
  const tsB = 1_700_000_500_000;

  await writeAuditDoneIndex(DEDUP_ORG, {
    findingId: "fid-A", completedAt: tsA, completed: true, score: 90, recordId, reason: "reviewed",
  });
  await writeAuditDoneIndex(DEDUP_ORG, {
    findingId: "fid-B", completedAt: tsB, completed: true, score: 80, recordId, reason: "perfect_score",
  });

  const plan1 = await findDuplicates(DEDUP_ORG, tsA - 1, tsB + 1);
  assertEquals(plan1.groups, 1);
  const losers = plan1.toDelete.filter((d) => !d.keep);
  assertEquals(losers.length, 1);

  await deleteDuplicates(DEDUP_ORG, plan1);
  // Bust cache so the second run sees the freshly-flagged hidden ID.
  _resetHiddenCacheForTesting();

  const plan2 = await findDuplicates(DEDUP_ORG, tsA - 1, tsB + 1);
  // Loser is hidden; only the keeper remains in scope, so no dup group.
  assertEquals(plan2.groups, 0);
  assertEquals(plan2.toDelete.length, 0);
});

// ─── forward fix: orphaned entries are never flagged as duplicates ─────────

Deno.test("dedup — orphaned entry (no resolvable recordId) is NOT marked a duplicate loser", async () => {
  reset();
  const orgId = ("test-orphan-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  const ts = 1_700_000_000_000;
  // Finding finished but with no record.RecordId and no recordingId → unkeyable.
  await saveFinding(orgId, { id: "fid-orphan", findingStatus: "finished", record: {}, completedAt: ts } as any);
  // Index row written without a recordId (the exact orphan shape).
  await writeAuditDoneIndex(orgId, { findingId: "fid-orphan", completedAt: ts, completed: true, score: 88 });

  const plan = await findDuplicates(orgId, ts - 1, ts + 1);
  assertEquals(plan.orphaned, 1, "should be counted as orphaned");
  assertEquals(plan.toDelete.filter((d) => !d.keep).length, 0, "a lone orphan must never be a duplicate loser");
});

// ─── dedup groups by RECORDING, and never touches an appealed finding ──────
// Root-cause fix for dedup soft-hiding real appeals: dedup must group on the
// recording (recordingId, unique per recording), NOT the coarse recordId —
// which for date-legs is the destination value shared by many distinct
// recordings. And a finding with an OPEN appeal must never be a dedup loser.

Deno.test("dedup — distinct recordings sharing a coarse recordId are NOT deduped", async () => {
  reset();
  const orgId = ("test-dedup-reckey-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  const ts = 1_700_000_000_000;
  // Two DIFFERENT recordings (vo-1, vo-2) that happen to share the same coarse
  // recordId "dest-1" (e.g. two date-legs in one destination). NOT duplicates.
  await writeAuditDoneIndex(orgId, { findingId: "fid-leg1", completedAt: ts, completed: true, score: 90, recordId: "dest-1", recordingId: "vo-1", reason: "reviewed" });
  await writeAuditDoneIndex(orgId, { findingId: "fid-leg2", completedAt: ts + 1000, completed: true, score: 80, recordId: "dest-1", recordingId: "vo-2" });

  const plan = await findDuplicates(orgId, ts - 1, ts + 2000);
  assertEquals(plan.groups, 0, "different recordings must not group by the shared destination recordId");
  assertEquals(plan.toDelete.filter((d) => !d.keep).length, 0, "no losers — these are distinct recordings");
});

Deno.test("dedup — two findings of the SAME recording ARE deduped", async () => {
  reset();
  const orgId = ("test-dedup-samerec-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  const ts = 1_700_000_000_000;
  // Same recording (vo-1) audited twice → a genuine duplicate. Keep the reviewed one.
  await writeAuditDoneIndex(orgId, { findingId: "fid-keep", completedAt: ts, completed: true, score: 90, recordId: "dest-1", recordingId: "vo-1", reason: "reviewed" });
  await writeAuditDoneIndex(orgId, { findingId: "fid-loser", completedAt: ts + 1000, completed: true, score: 80, recordId: "dest-1", recordingId: "vo-1" });

  const plan = await findDuplicates(orgId, ts - 1, ts + 2000);
  assertEquals(plan.groups, 1, "same recording must form one duplicate group");
  const losers = plan.toDelete.filter((d) => !d.keep).map((d) => d.id);
  assertEquals(losers, ["fid-loser"], "the non-reviewed copy is the loser");
  assertEquals(plan.toDelete.find((d) => d.keep)?.id, "fid-keep", "the reviewed copy is kept");
});

Deno.test("dedup — a finding with an open appeal is never a duplicate loser", async () => {
  reset();
  const orgId = ("test-dedup-appeal-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  const ts = 1_700_000_000_000;
  // Genuine same-recording pair, but the second copy has an OPEN appeal.
  await writeAuditDoneIndex(orgId, { findingId: "fid-keep", completedAt: ts, completed: true, score: 90, recordId: "dest-1", recordingId: "vo-1", reason: "reviewed" });
  await writeAuditDoneIndex(orgId, { findingId: "fid-appealed", completedAt: ts + 1000, completed: true, score: 80, recordId: "dest-1", recordingId: "vo-1" });
  await populateJudgeQueue(orgId, "fid-appealed", [{ header: "Q", populated: "P", thinking: "T", defense: "D", answer: "No" }], "redo");

  const plan = await findDuplicates(orgId, ts - 1, ts + 2000);
  const losers = plan.toDelete.filter((d) => !d.keep).map((d) => d.id);
  assert(!losers.includes("fid-appealed"), "an appealed finding must never be hidden by dedup");
});

Deno.test("dedup — legacy rows with a recordId but NO recordingId still group by recordId", async () => {
  // Pins the documented fallback: pre-recordingId index rows keep the prior
  // coarse-recordId grouping (the known limitation called out in findDuplicates).
  reset();
  const orgId = ("test-dedup-legacy-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  const ts = 1_700_000_000_000;
  await writeAuditDoneIndex(orgId, { findingId: "fid-l1", completedAt: ts, completed: true, score: 90, recordId: "rk-legacy", reason: "reviewed" });
  await writeAuditDoneIndex(orgId, { findingId: "fid-l2", completedAt: ts + 1000, completed: true, score: 80, recordId: "rk-legacy" });

  const plan = await findDuplicates(orgId, ts - 1, ts + 2000);
  assertEquals(plan.groups, 1, "legacy recordId-only rows still group by recordId (prior behaviour preserved)");
  assertEquals(plan.toDelete.filter((d) => !d.keep).map((d) => d.id), ["fid-l2"], "the newer, non-reviewed legacy row is the loser");
});

// ─── postJudgedAudit — audit-done-idx sync contract ────────────────────────
// postJudgedAudit must write a fresh audit-done-idx entry whenever judges
// have overturned at least one question. If a future change removes the
// writeAuditDoneIndex call from postJudgedAudit, these tests fail — fix the
// code, not the tests.

async function makeFindingWith4Nos(orgId: OrgId, findingId: string): Promise<number> {
  const completedAt = Date.now();
  const answeredQuestions = [0, 1, 2, 3].map((i) => ({
    header: `Q${i}`,
    populated: `populated ${i}`,
    thinking: `thinking ${i}`,
    defense: `defense ${i}`,
    answer: "No",
  }));
  await saveFinding(orgId, {
    id: findingId,
    auditJobId: "job-" + findingId,
    findingStatus: "finished",
    recordingId: "rec-" + findingId,
    recordingIdField: "VoGenie",
    owner: "test@x.com",
    record: { RecordId: "r-" + findingId, VoName: "VO 02 - Judge Test", ActivatingOffice: "EPG", Shift: "Night" },
    answeredQuestions,
    completedAt,
  } as unknown as Parameters<typeof saveFinding>[1]);
  return completedAt;
}

async function seedJudgeDecisions(
  orgId: OrgId,
  findingId: string,
  decisions: Array<{ questionIndex: number; decision: "uphold" | "overturn" }>,
): Promise<void> {
  for (const d of decisions) {
    await setStored("judge-decided", orgId, [findingId, d.questionIndex], {
      findingId,
      questionIndex: d.questionIndex,
      header: `Q${d.questionIndex}`,
      populated: `populated ${d.questionIndex}`,
      thinking: "thinking",
      defense: "defense",
      answer: "No",
      decision: d.decision,
      judge: "judge@x.com",
      decidedAt: Date.now(),
    });
  }
}

Deno.test("postJudgedAudit — full overturn rewrites index to 100% completed", async () => {
  reset();
  const ORG = ("test-judge-full-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
  const fid = "fid-judge-full-" + crypto.randomUUID().slice(0, 8);
  const completedAt = await makeFindingWith4Nos(ORG, fid);
  // Stale index seeded with pre-judge score (0% — all Nos).
  await writeAuditDoneIndex(ORG, {
    findingId: fid, completedAt, score: 0, completed: false, isPackage: false,
  });
  // Judge overturns ALL 4.
  await seedJudgeDecisions(ORG, fid, [
    { questionIndex: 0, decision: "overturn" },
    { questionIndex: 1, decision: "overturn" },
    { questionIndex: 2, decision: "overturn" },
    { questionIndex: 3, decision: "overturn" },
  ]);

  await postJudgedAudit(ORG, fid, "judge@x.com");

  // Finding's answeredQuestions reflects the overturns.
  const refreshed = await getFinding(ORG, fid);
  assertExists(refreshed);
  const qs = (refreshed!.answeredQuestions ?? []) as Array<{ answer: string }>;
  qs.forEach((q, i) => assertEquals(q.answer, "Yes", `q[${i}] should be overturned to Yes`));

  // Index entry now reflects post-judge state.
  const idx = await queryAuditDoneIndex(ORG, completedAt - 1000, completedAt + 1000);
  const entry = idx.find((e) => e.findingId === fid);
  assertExists(entry, "index entry must exist after postJudgedAudit");
  assertEquals(entry!.score, 100, "index score must be 100 after all-overturn");
  assertEquals(entry!.completed, true, "score === 100 must mark completed");
  assertEquals(entry!.reason, "reviewed");
});

Deno.test("postJudgedAudit — partial overturn rewrites index with intermediate score", async () => {
  reset();
  const ORG = ("test-judge-partial-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
  const fid = "fid-judge-part-" + crypto.randomUUID().slice(0, 8);
  const completedAt = await makeFindingWith4Nos(ORG, fid);
  await writeAuditDoneIndex(ORG, {
    findingId: fid, completedAt, score: 0, completed: false, isPackage: false,
  });
  // Judge overturns 2 of 4 → 50%.
  await seedJudgeDecisions(ORG, fid, [
    { questionIndex: 0, decision: "overturn" },
    { questionIndex: 1, decision: "overturn" },
    { questionIndex: 2, decision: "uphold" },
    { questionIndex: 3, decision: "uphold" },
  ]);

  await postJudgedAudit(ORG, fid, "judge@x.com");

  const idx = await queryAuditDoneIndex(ORG, completedAt - 1000, completedAt + 1000);
  const entry = idx.find((e) => e.findingId === fid);
  assertExists(entry);
  assertEquals(entry!.score, 50, "index score must reflect partial overturn (2/4 = 50%)");
  assertEquals(entry!.completed, false, "score < 100 must NOT mark completed");
});

Deno.test("postJudgedAudit — all-uphold leaves index unchanged (no write)", async () => {
  reset();
  const ORG = ("test-judge-uphold-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
  const fid = "fid-judge-up-" + crypto.randomUUID().slice(0, 8);
  const completedAt = await makeFindingWith4Nos(ORG, fid);
  // Seed index with a distinctive marker score so we can detect non-rewrite.
  await writeAuditDoneIndex(ORG, {
    findingId: fid, completedAt, score: 0, completed: false, isPackage: false,
    voName: "PRE-EXISTING-MARKER",
  });
  // Judge upholds everything → no overturns, no finding modification, no index write.
  await seedJudgeDecisions(ORG, fid, [
    { questionIndex: 0, decision: "uphold" },
    { questionIndex: 1, decision: "uphold" },
    { questionIndex: 2, decision: "uphold" },
    { questionIndex: 3, decision: "uphold" },
  ]);

  await postJudgedAudit(ORG, fid, "judge@x.com");

  // Index entry untouched — postJudgedAudit only writes when overturns > 0.
  const idx = await queryAuditDoneIndex(ORG, completedAt - 1000, completedAt + 1000);
  const entry = idx.find((e) => e.findingId === fid);
  assertExists(entry);
  assertEquals(entry!.voName, "PRE-EXISTING-MARKER", "all-uphold path must not rewrite index");
  assert(entry!.score === 0, "score must remain at seeded 0 (no overturns means no score change)");
});
