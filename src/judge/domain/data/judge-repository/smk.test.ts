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
  dismissAppealForFinding,
  findDuplicates,
  deleteDuplicates,
  diagnoseDuplicates,
  postJudgedAudit,
  getAppeal,
  saveAppeal,
  listChargebackBackfillFids,
  processChargebackBackfillBatch,
  reconcileChargebackForFinding,
  type DedupPlan,
} from "./mod.ts";
import {
  resetFirestoreCredentials,
  setStored,
  getStored,
  listStoredByCompletedAt,
} from "@core/data/firestore/mod.ts";
import { saveFinding, getFinding } from "@audit/domain/data/audit-repository/mod.ts";
import {
  writeAuditDoneIndex,
  writeSoleAuditDoneIndex,
  collapseDuplicateIndexRows,
  queryAuditDoneIndex,
  markFindingHidden,
  getHiddenFindingIds,
  saveChargebackEntry,
  getChargebackEntries,
  saveWireDeductionEntry,
  getWireDeductionEntries,
  _resetHiddenCacheForTesting,
  type AuditHiddenEntry,
} from "@audit/domain/data/stats-repository/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";
import type { AuditDoneIndexEntry } from "@core/dto/types.ts";

/** Raw read of a finding's audit-done-idx rows — bypasses queryAuditDoneIndex's
 *  SWR cache so post-mutation assertions see the live store. */
async function idxRowsFor(orgId: OrgId, findingId: string): Promise<AuditDoneIndexEntry[]> {
  const rows = await listStoredByCompletedAt<AuditDoneIndexEntry>(
    "audit-done-idx", orgId, 0, Number.MAX_SAFE_INTEGER,
    { limit: Number.MAX_SAFE_INTEGER, fieldName: "completedAt" },
  );
  return rows.filter((r) => r.findingId === findingId);
}

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

// Regression for "dismissed the appeal, button still says Appeal Filed": a
// dismissal has to undo every write file-appeal made, not just the queue rows.
// The dismissal email tells the auditor to file again — appealedAt left on the
// finding makes that impossible, and appealStatus left on the index row keeps
// "Appeal Pending" on every history screen.
Deno.test({ name: "judge — dismissAppealForFinding unlocks the appeal button and clears the badge", ...kvOpts, fn: async () => {
  reset();
  const orgId = ("test-dismiss-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  const fid = "f-dismiss-full";
  const completedAt = 1_700_000_000_000;
  const appealedAt = completedAt + 60_000;

  await saveFinding(orgId, {
    id: fid, findingStatus: "finished", completedAt, score: 84,
    appealedAt, appealComment: "second genie number in the notes",
  });
  // Same write order file-appeal uses: queue rows, then the appeal record, then
  // the index row (which stamps appealStatus off that record).
  await populateJudgeQueue(orgId, fid, [
    { header: "Taxes", populated: "P", thinking: "T", defense: "D", answer: "No" },
    { header: "Active Bankruptcy", populated: "P", thinking: "T", defense: "D", answer: "No" },
  ], "redo");
  await saveAppeal(orgId, { findingId: fid, appealedAt, status: "pending", auditor: "vo@test.com", appealedQuestions: ["0", "1"] });
  await writeAuditDoneIndex(orgId, { findingId: fid, completedAt, completed: true, score: 84, recordId: "rec-D" });

  // Pre-state: everything reads "appeal open".
  assertEquals((await idxRowsFor(orgId, fid))[0].appealStatus, "pending", "badge starts pending");
  assertEquals(await getStored<number>("judge-audit-pending", orgId, fid), 2, "counter starts at the filed count");

  const { dismissed } = await dismissAppealForFinding(orgId, fid);

  assertEquals(dismissed, 2, "both queue rows torn down");
  assertEquals(await getAppeal(orgId, fid), null, "appeal record deleted");
  assertEquals(await getStored<number>("judge-audit-pending", orgId, fid), null, "stale counter cleared");

  const after = await getFinding(orgId, fid) as Record<string, any>;
  assertEquals(after.appealedAt, undefined, "appealedAt cleared — button goes back to red 'File Appeal'");
  assertEquals(after.appealComment, undefined, "stale comment cleared so it can't surface under the next appeal");
  assertEquals(after.score, 84, "the audit itself is untouched");

  const rows = await idxRowsFor(orgId, fid);
  assertEquals(rows.length, 1, "still exactly one index row");
  assertEquals(rows[0].appealStatus, "none", "history badge no longer reads 'Appeal Pending'");
  assertEquals(rows[0].score, 84, "score preserved through the re-stamp");

  // The auditor can now file again — the whole point of a dismissal.
  await populateJudgeQueue(orgId, fid, [
    { header: "Taxes", populated: "P", thinking: "T", defense: "D", answer: "No" },
  ], "redo");
  assertEquals(await getStored<number>("judge-audit-pending", orgId, fid), 1, "re-filed appeal queues cleanly");
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

// ─── duplicate-index-row cleanup (the real fix) ────────────────────────────
// The "duplicates" are duplicate audit-done-idx ROWS for the same finding (an
// audit row + a review row at a different completedAt). The cleanup keeps ONE
// row per finding (reviewed/judged, else newest) and deletes the stale row by
// key — it must NEVER hide the finding.

// Helper: seed a finding's original audit row + its later reviewed row.
async function seedDupRows(orgId: OrgId, fid: string, ts: number): Promise<void> {
  // Original audit row — older, pre-review score, carries recordingId.
  await writeAuditDoneIndex(orgId, { findingId: fid, completedAt: ts, completed: false, score: 80, recordId: "rec-" + fid, recordingId: "vo-" + fid });
  // Review row — newer, post-review score, reviewed, recordingId blank (real shape).
  await writeAuditDoneIndex(orgId, { findingId: fid, completedAt: ts + 1000, completed: true, score: 96, recordId: "rec-" + fid, reason: "reviewed", reviewedBy: "alice@x.com" });
}

Deno.test("diagnoseDuplicates — reports duplicate rows per finding, keeper is the reviewed row, never writes", async () => {
  reset();
  const orgId = ("test-diag-rows-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  const ts = 1_700_000_000_000;
  await seedDupRows(orgId, "fid-X", ts);                       // 2 rows
  await writeAuditDoneIndex(orgId, { findingId: "fid-Y", completedAt: ts + 5000, completed: true, score: 100, recordId: "recY", recordingId: "voY" }); // 1 row

  const diag = await diagnoseDuplicates(orgId, ts - 1, ts + 10_000);
  assertEquals(diag.scannedRows, 3);
  assertEquals(diag.distinctFindings, 2);
  assertEquals(diag.findingsWithDupes, 1);
  assertEquals(diag.staleRows, 1);
  assertEquals(diag.sampleTotal, 1);

  const gX = diag.sampleGroups.find((g) => g.findingId === "fid-X");
  assertExists(gX);
  assertEquals(gX?.rowCount, 2);
  // Keeper presented first = the reviewed row (score 96); the audit row is DELETE.
  assertEquals(gX?.members[0].decision, "KEEP");
  assertEquals(gX?.members[0].score, 96);
  assertEquals(gX?.members[0].reason, "reviewed");
  assertEquals(gX?.members[1].decision, "DELETE");
  assertEquals(gX?.members[1].score, 80);

  // Read-only: diagnosis must never hide a finding.
  assertEquals((await getHiddenFindingIds(orgId)).size, 0);
});

Deno.test("collapseDuplicateIndexRows — keeps reviewed row, deletes stale by key, backfills recordingId, idempotent", async () => {
  reset();
  const orgId = ("test-collapse-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  const ts = 1_700_000_000_000;
  await seedDupRows(orgId, "fid-X", ts);

  // Dry run: counts only, nothing removed.
  const dry = await collapseDuplicateIndexRows(orgId, ts - 1, ts + 10_000, { execute: false });
  assertEquals(dry.findingsWithDupes, 1);
  assertEquals(dry.staleRows, 1);
  assertEquals(dry.rowsDeleted, 0);
  assertEquals((await idxRowsFor(orgId, "fid-X")).length, 2, "dry run leaves both rows");

  // Execute: keep the reviewed row, delete the stale audit row.
  const run = await collapseDuplicateIndexRows(orgId, ts - 1, ts + 10_000, { execute: true });
  assertEquals(run.rowsDeleted, 1);
  assertEquals(run.failed, 0);
  const remaining = await idxRowsFor(orgId, "fid-X");
  assertEquals(remaining.length, 1, "exactly one row survives");
  assertEquals(remaining[0].score, 96, "the reviewed row is kept");
  assertEquals(remaining[0].recordingId, "vo-fid-X", "recordingId backfilled onto the kept reviewed row");
  // The finding itself is never hidden.
  assertEquals((await getHiddenFindingIds(orgId)).size, 0);

  // Idempotent: a second run finds nothing to do.
  const again = await collapseDuplicateIndexRows(orgId, ts - 1, ts + 10_000, { execute: true });
  assertEquals(again.findingsWithDupes, 0);
  assertEquals(again.staleRows, 0);
});

Deno.test("collapseDuplicateIndexRows — surfaces delete failures via injected deleteRow", async () => {
  reset();
  const orgId = ("test-collapse-fail-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  const ts = 1_700_000_000_000;
  await seedDupRows(orgId, "fid-Z", ts);

  const res = await collapseDuplicateIndexRows(orgId, ts - 1, ts + 10_000, {
    execute: true,
    deleteRow: () => { throw new Error("boom"); },
  });
  assertEquals(res.staleRows, 1);
  assertEquals(res.rowsDeleted, 0);
  assertEquals(res.failed, 1);
  assertEquals(res.failedIds, ["fid-Z"]);
});

Deno.test("writeSoleAuditDoneIndex — one row at reviewedAt, audit-time sibling deleted, reviewer attribution preserved", async () => {
  reset();
  const orgId = ("test-sole-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  const completedAt = 1_700_000_000_000;
  const reviewedAt = completedAt + 5000;
  // Original audit row.
  await writeAuditDoneIndex(orgId, { findingId: "fid-S", completedAt, completed: false, score: 80, recordId: "recS", recordingId: "voS" });

  // Review writes via the helper with the corrected finding (reviewedAt set):
  // keys at reviewedAt and deletes the original audit-time row.
  await writeSoleAuditDoneIndex(orgId, { completedAt, reviewedAt }, {
    findingId: "fid-S", doneAt: reviewedAt, completed: true, score: 96, reason: "reviewed",
    recordId: "recS", recordingId: "voS", reviewedBy: "alice@x.com",
  });
  let rows = await idxRowsFor(orgId, "fid-S");
  assertEquals(rows.length, 1, "exactly one row after review");
  assertEquals(rows[0].completedAt, reviewedAt, "keyed at reviewedAt (reviewer-throughput bucket preserved)");
  assertEquals(rows[0].reviewedBy, "alice@x.com");

  // A judge-style overwrite carries the new score but NOT reviewedBy — the merge
  // must preserve the reviewer attribution.
  await writeSoleAuditDoneIndex(orgId, { completedAt, reviewedAt }, {
    findingId: "fid-S", completed: false, score: 50, recordId: "recS",
  });
  rows = await idxRowsFor(orgId, "fid-S");
  assertEquals(rows.length, 1, "still exactly one row after judge");
  assertEquals(rows[0].score, 50, "judge score applied");
  assertEquals(rows[0].reviewedBy, "alice@x.com", "reviewer attribution preserved through judge overwrite");
});

Deno.test("writeSoleAuditDoneIndex — skips a malformed finding (no finite completedAt/reviewedAt) instead of minting a wall-clock row", async () => {
  reset();
  const orgId = ("test-sole-bad-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  const wrote = await writeSoleAuditDoneIndex(orgId, {}, {
    findingId: "fid-bad", completed: true, score: 50, recordId: "recBad",
  });
  assertEquals(wrote, false, "no finite timestamp → write is skipped");
  assertEquals((await idxRowsFor(orgId, "fid-bad")).length, 0, "no orphan row minted at wall-clock time");
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

// ── Chunked payroll/chargeback backfill (list + per-batch process) ───────────

Deno.test("chargeback backfill — list enumerates fids; process deletes a now-passing entry, rewrites a still-failing one", async () => {
  resetFirestoreCredentials();
  _resetHiddenCacheForTesting();
  const org = ("test-cbbf-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
  const now = 1_700_000_000_000;

  // Finding A — re-audited to all-pass (a reviewer flipped its fail). Its STALE
  // 50% chargeback entry must be DELETED by the backfill.
  await saveFinding(org, {
    id: "A", findingStatus: "finished", recordingIdField: "VoGenie", completedAt: now,
    record: { RecordId: "rA", VoName: "VO 01 - Amy", ActivatingOffice: "ACT", DestinationDisplay: "HI", "706": "100" },
    answeredQuestions: [{ header: "Q0", answer: "Yes" }, { header: "Q1", answer: "Yes" }],
  } as unknown as Parameters<typeof saveFinding>[1]);
  await saveChargebackEntry(org, {
    findingId: "A", ts: now, voName: "Amy", destination: "HI", revenue: "100", recordId: "rA",
    score: 50, failedQHeaders: ["Q0"], egregiousHeaders: [], omissionHeaders: ["Q0"],
  });

  // Finding B — still failing one question. Its entry must be REWRITTEN to the
  // recomputed score with only the real remaining fail.
  await saveFinding(org, {
    id: "B", findingStatus: "finished", recordingIdField: "VoGenie", completedAt: now,
    record: { RecordId: "rB", VoName: "VO 02 - Bob", ActivatingOffice: "ACT", DestinationDisplay: "HI", "706": "200" },
    answeredQuestions: [{ header: "Q0", answer: "Yes" }, { header: "Q1", answer: "No" }],
  } as unknown as Parameters<typeof saveFinding>[1]);
  await saveChargebackEntry(org, {
    findingId: "B", ts: now, voName: "Bob", destination: "HI", revenue: "200", recordId: "rB",
    score: 0, failedQHeaders: ["Q0", "Q1"], egregiousHeaders: [], omissionHeaders: ["Q0", "Q1"],
  });

  const fids = (await listChargebackBackfillFids(org, now - 1000, now + 1000)).sort();
  assertEquals(fids, ["A", "B"], "list enumerates both entries' fids");

  const res = await processChargebackBackfillBatch(org, fids);
  assertEquals(res.cbDeleted, 1, "the now-passing audit's entry is deleted");
  assertEquals(res.cbUpdated, 1, "the still-failing audit's entry is rewritten");

  const entries = await getChargebackEntries(org, now - 1000, now + 1000);
  assertEquals(entries.find((e) => e.findingId === "A"), undefined, "A (now passes) removed from the sheet");
  const b = entries.find((e) => e.findingId === "B");
  assertExists(b);
  assertEquals(b!.score, 50, "B rewritten to the recomputed 50% (1/2 Yes)");
  assertEquals(b!.failedQHeaders, ["Q1"], "B lists only the real remaining fail (Q1), not the stale Q0");
});

const CB_NOW = 1_700_000_000_000;

/** Seed a finished finding the chargeback reconcile can read. `answers` are
 *  {answer, header?, egregious?}; header defaults to Q<i> (pass "" to test the
 *  empty-header edge). isPackage flips recordingIdField to GenieNumber. */
async function seedCbFinding(
  org: OrgId,
  id: string,
  answers: Array<{ answer: string; header?: string; egregious?: boolean }>,
  opts: { isPackage?: boolean } = {},
): Promise<void> {
  await saveFinding(org, {
    id,
    findingStatus: "finished",
    recordingIdField: opts.isPackage ? "GenieNumber" : "VoGenie",
    completedAt: CB_NOW,
    record: {
      RecordId: "r-" + id, VoName: "VO 01 - T", GuestName: "G",
      ActivatingOffice: "ACT", OfficeName: "ACT Office", DestinationDisplay: "HI", "706": "100",
    },
    answeredQuestions: answers.map((a, i) => ({
      header: a.header === undefined ? "Q" + i : a.header,
      answer: a.answer,
      egregious: a.egregious,
    })),
  } as unknown as Parameters<typeof saveFinding>[1]);
}

Deno.test("reconcileChargebackForFinding — four outcomes + skip cases + empty-header edge", async () => {
  resetFirestoreCredentials();
  _resetHiddenCacheForTesting();
  const org = ("test-cbrec-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
  const cbEntry = (id: string) => saveChargebackEntry(org, {
    findingId: id, ts: CB_NOW, voName: "x", destination: "", revenue: "", recordId: "r-" + id,
    score: 50, failedQHeaders: ["Q0"], egregiousHeaders: [], omissionHeaders: ["Q0"],
  });
  const cbOf = async (id: string) => (await getChargebackEntries(org, 0, CB_NOW + 1000)).find((e) => e.findingId === id);
  const wireOf = async (id: string) => (await getWireDeductionEntries(org, 0, CB_NOW + 1000)).find((e) => e.findingId === id);

  // (1) cbDeleted — date-leg, all Yes (passing) → deletes the existing chargeback.
  await seedCbFinding(org, "cbDel", [{ answer: "Yes" }, { answer: "Yes" }]);
  await cbEntry("cbDel");
  assertEquals(await reconcileChargebackForFinding(org, "cbDel"),
    { cbUpdated: false, cbDeleted: true, wireUpdated: false, wireDeleted: false });
  assertEquals(await cbOf("cbDel"), undefined, "passing date-leg → chargeback deleted");

  // (2) cbUpdated — date-leg with real No+header → saves recomputed score + split headers.
  await seedCbFinding(org, "cbUpd", [
    { answer: "Yes" }, { answer: "No", header: "Income", egregious: true }, { answer: "No", header: "Omit" },
  ]);
  const r2 = await reconcileChargebackForFinding(org, "cbUpd");
  assertEquals(r2.cbUpdated, true);
  const cb = await cbOf("cbUpd");
  assertExists(cb);
  assertEquals(cb!.score, 33, "1/3 Yes → 33%");
  assertEquals([...cb!.failedQHeaders].sort(), ["Income", "Omit"]);
  assertEquals(cb!.egregiousHeaders, ["Income"], "egregious split by the egregious flag");
  assertEquals(cb!.omissionHeaders, ["Omit"]);

  // (3) wireDeleted — package, all Yes (passing) → deletes the existing wire entry.
  await seedCbFinding(org, "wDel", [{ answer: "Yes" }, { answer: "Yes" }], { isPackage: true });
  await saveWireDeductionEntry(org, {
    findingId: "wDel", ts: CB_NOW, score: 50, questionsAudited: 2, totalSuccess: 1,
    recordId: "r-wDel", office: "ACT", excellenceAuditor: "x", guestName: "G",
  });
  assertEquals((await reconcileChargebackForFinding(org, "wDel")).wireDeleted, true);
  assertEquals(await wireOf("wDel"), undefined, "passing package → wire entry deleted (symmetric)");

  // (4) wireUpdated — package, failing → saves wire entry with score + totalSuccess.
  await seedCbFinding(org, "wUpd", [{ answer: "Yes" }, { answer: "No", header: "X" }], { isPackage: true });
  assertEquals((await reconcileChargebackForFinding(org, "wUpd")).wireUpdated, true);
  const w = await wireOf("wUpd");
  assertExists(w);
  assertEquals(w!.score, 50);
  assertEquals(w!.totalSuccess, 1, "totalSuccess counts === \"Yes\"");
  assertEquals(w!.questionsAudited, 2);

  // skip — missing finding → all-false none, no writes.
  assertEquals(await reconcileChargebackForFinding(org, "ghost"),
    { cbUpdated: false, cbDeleted: false, wireUpdated: false, wireDeleted: false });

  // skip — zero answers → all-false none.
  await seedCbFinding(org, "empty", []);
  assertEquals(await reconcileChargebackForFinding(org, "empty"),
    { cbUpdated: false, cbDeleted: false, wireUpdated: false, wireDeleted: false });

  // edge — a literal "No" with an EMPTY header is filtered out (q.header falsy),
  // so failedQs is empty → passing → DELETE, not a chargeable fail.
  await seedCbFinding(org, "edge", [{ answer: "Yes" }, { answer: "No", header: "" }]);
  await cbEntry("edge");
  assertEquals((await reconcileChargebackForFinding(org, "edge")).cbDeleted, true,
    "a No with an empty header is not a chargeable fail → entry deleted");
  assertEquals(await cbOf("edge"), undefined);
});

Deno.test("processChargebackBackfillBatch — folds totals across >1 concurrency slice (25 fids)", async () => {
  resetFirestoreCredentials();
  _resetHiddenCacheForTesting();
  const org = ("test-cbagg-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
  const fids: string[] = [];
  // CONCURRENCY=20, so 25 fids = two slices (20 + 5); scanned===25 proves the
  // outer accumulation folded BOTH, not just the first slice.
  for (let i = 0; i < 10; i++) {
    const id = "d" + i; await seedCbFinding(org, id, [{ answer: "Yes" }]);
    await saveChargebackEntry(org, {
      findingId: id, ts: CB_NOW, voName: "x", destination: "", revenue: "", recordId: "r-" + id,
      score: 50, failedQHeaders: ["Q0"], egregiousHeaders: [], omissionHeaders: ["Q0"],
    });
    fids.push(id); // → cbDeleted
  }
  for (let i = 0; i < 8; i++) { const id = "u" + i; await seedCbFinding(org, id, [{ answer: "No", header: "X" }]); fids.push(id); } // → cbUpdated
  for (let i = 0; i < 3; i++) {
    const id = "wd" + i; await seedCbFinding(org, id, [{ answer: "Yes" }], { isPackage: true });
    await saveWireDeductionEntry(org, {
      findingId: id, ts: CB_NOW, score: 50, questionsAudited: 1, totalSuccess: 0,
      recordId: "r-" + id, office: "ACT", excellenceAuditor: "x", guestName: "G",
    });
    fids.push(id); // → wireDeleted
  }
  for (let i = 0; i < 2; i++) { const id = "wu" + i; await seedCbFinding(org, id, [{ answer: "No", header: "X" }], { isPackage: true }); fids.push(id); } // → wireUpdated
  await seedCbFinding(org, "empty2", []); fids.push("empty2"); // skipped (no answers)
  fids.push("missing-fid"); // skipped (no finding)

  const res = await processChargebackBackfillBatch(org, fids);
  assertEquals(res.scanned, 25, "both concurrency slices folded (would be 20 if only the first ran)");
  assertEquals(res.cbDeleted, 10);
  assertEquals(res.cbUpdated, 8);
  assertEquals(res.wireDeleted, 3);
  assertEquals(res.wireUpdated, 2);
});

// ─── repeat-submission guard (one decrement, one completion, per question) ──
// Prod incident (finding cEs2p0IYZXJbHugyqZgt5, 2026-07-30): the judge hotkeys
// fire htmx.ajax with no in-flight lock, so a second keypress during the ~1.2s
// round-trip resubmits the SAME question. recordJudgeDecision decremented the
// audit counter on every submission, so an 11-question appeal hit 0 after 7
// unique decisions — postJudgedAudit fired early, then again on each remaining
// decision (Math.max(0, 0-1) is still 0), mailing the auditor 5 "appeal
// complete" emails with partial scores (56%→84%, 84%→88% … 96%→100%).

/** Poll for the judgeAction stamp postJudgedAudit writes — it's fired
 *  fire-and-forget from recordJudgeDecision, so it can't be awaited directly. */
async function stampedAfter(orgId: OrgId, findingId: string, ms = 150): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const f = await getFinding(orgId, findingId) as { answeredQuestions?: Array<{ judgeAction?: string }> } | null;
    if (f?.answeredQuestions?.some((q) => q.judgeAction)) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
}

Deno.test({ name: "judge — resubmitting the same question decrements the counter only once", ...kvOpts, fn: async () => {
  reset();
  const org = ("test-judge-dup-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
  const fid = "f-judge-dup";
  await makeFindingWith4Nos(org, fid);
  await populateJudgeQueue(org, fid, [0, 1, 2].map((i) => ({
    _origIdx: i, header: `Q${i}`, populated: `populated ${i}`, thinking: "T", defense: "D", answer: "No",
  })), "redo");
  // Claim like the real queue does — pending rows move to judge-active, so a
  // repeat submission finds the question in neither store (as it did in prod).
  await claimNextItem(org, "j@test.com");

  assertEquals((await recordJudgeDecision(org, fid, 0, "overturn", "j@test.com", "error")).remaining, 2);
  // The double-tap. Before the fix this returned 1 and the audit "completed"
  // two questions early.
  assertEquals(
    (await recordJudgeDecision(org, fid, 0, "overturn", "j@test.com", "error")).remaining, 2,
    "a repeat submission of an already-decided question must not decrement again",
  );
  assertEquals((await recordJudgeDecision(org, fid, 1, "overturn", "j@test.com", "error")).remaining, 1);
  assertEquals(
    await stampedAfter(org, fid), false,
    "postJudgedAudit must NOT run while question 2 is still undecided (no early appeal-result email)",
  );

  assertEquals((await recordJudgeDecision(org, fid, 2, "overturn", "j@test.com", "error")).remaining, 0);
  assertEquals(await stampedAfter(org, fid), true, "postJudgedAudit runs once the last question is decided");
}});

Deno.test({ name: "judge — a repeat submission keeps the question's context", ...kvOpts, fn: async () => {
  reset();
  const org = ("test-judge-dup-ctx-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
  const fid = "f-judge-dup-ctx";
  await makeFindingWith4Nos(org, fid);
  await populateJudgeQueue(org, fid, [{
    _origIdx: 0, header: "Q0", populated: "populated 0", thinking: "T", defense: "D", answer: "No",
  }], "redo");
  await claimNextItem(org, "j@test.com"); // pending → active, so the repeat finds neither

  await recordJudgeDecision(org, fid, 0, "overturn", "j@test.com", "error");
  await recordJudgeDecision(org, fid, 0, "overturn", "j@test.com", "error");

  // On the repeat, judge-active and judge-pending are both drained. Falling
  // back to a blank stub would erase the header postJudgedAudit keys its
  // appealed/denied sets off (and reviewer-quality buckets overturns by).
  const decided = await getStored<{ header?: string; populated?: string }>("judge-decided", org, fid, 0);
  assertEquals(decided?.header, "Q0", "header must survive a repeat submission");
  assertEquals(decided?.populated, "populated 0", "prompt must survive a repeat submission");
}});

Deno.test({ name: "judge — a decision arriving after the counter hit 0 does not re-run postJudgedAudit", ...kvOpts, fn: async () => {
  reset();
  const org = ("test-judge-late-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
  const fid = "f-judge-late";
  await makeFindingWith4Nos(org, fid);
  await populateJudgeQueue(org, fid, [{
    _origIdx: 0, header: "Q0", populated: "P", thinking: "T", defense: "D", answer: "No",
  }], "redo");
  await setStored("judge-audit-pending", org, [fid], 0); // already exhausted

  assertEquals((await recordJudgeDecision(org, fid, 0, "overturn", "j@test.com", "error")).remaining, 0);
  assertEquals(
    await stampedAfter(org, fid), false,
    "0 → 0 is not a transition to zero — no second post-judge write, no duplicate email",
  );
}});

// ─── postJudgedAudit — chargeback/wire ("payroll") resync ───────────────────
// The review path resyncs the deduction entry on finalize; the judge path never
// did. So an audit that failed review (entry written) and was then overturned
// back to a pass on appeal kept its deduction row forever — a real pay hit for
// an auditor who WON. Found in prod on 3 findings (33WsgrD4mM0fh-vk1YNtS,
// JoCmLpmpVGSb4sKfIJqah, Z1_xHjHoLviagqoXjOomV), all sitting at 100% with a
// live chargeback row.

Deno.test("postJudgedAudit — full overturn clears the chargeback entry", async () => {
  reset();
  const org = ("test-judge-cb-clear-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
  const fid = "fid-judge-cb-clear";
  await seedCbFinding(org, fid, [{ answer: "No", header: "Q0" }, { answer: "Yes", header: "Q1" }]);
  await saveChargebackEntry(org, {
    findingId: fid, ts: CB_NOW, voName: "T", destination: "HI", revenue: "100", recordId: "r-" + fid,
    score: 50, failedQHeaders: ["Q0"], egregiousHeaders: [], omissionHeaders: ["Q0"],
  });
  assertEquals((await getChargebackEntries(org, 0, Number.MAX_SAFE_INTEGER)).length, 1, "deduction exists pre-appeal");

  await seedJudgeDecisions(org, fid, [{ questionIndex: 0, decision: "overturn" }]);
  await postJudgedAudit(org, fid, "judge@x.com");

  assertEquals(
    (await getChargebackEntries(org, 0, Number.MAX_SAFE_INTEGER)).length, 0,
    "audit is back to 100% — the deduction must be gone, not left on the payroll sheet",
  );
});

Deno.test("postJudgedAudit — partial overturn rewrites the entry to the remaining fails", async () => {
  reset();
  const org = ("test-judge-cb-part-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
  const fid = "fid-judge-cb-part";
  await seedCbFinding(org, fid, [
    { answer: "No", header: "Q0" }, { answer: "No", header: "Q1" },
    { answer: "Yes", header: "Q2" }, { answer: "Yes", header: "Q3" },
  ]);
  await saveChargebackEntry(org, {
    findingId: fid, ts: CB_NOW, voName: "T", destination: "HI", revenue: "100", recordId: "r-" + fid,
    score: 50, failedQHeaders: ["Q0", "Q1"], egregiousHeaders: [], omissionHeaders: ["Q0", "Q1"],
  });

  // Judge overturns Q0, upholds Q1 → still failing at 75%.
  await seedJudgeDecisions(org, fid, [
    { questionIndex: 0, decision: "overturn" },
    { questionIndex: 1, decision: "uphold" },
  ]);
  await postJudgedAudit(org, fid, "judge@x.com");

  const entries = await getChargebackEntries(org, 0, Number.MAX_SAFE_INTEGER);
  assertEquals(entries.length, 1, "still failing — the deduction stays");
  assertEquals(entries[0].score, 75, "score must be the post-judge score, not the pre-appeal 50%");
  assertEquals(entries[0].failedQHeaders, ["Q1"], "only the upheld question is still chargeable");
  assertEquals(entries[0].ts, CB_NOW, "ts stays the original completedAt so it lands in the same pay period");
});

Deno.test("postJudgedAudit — full overturn clears a package finding's wire deduction", async () => {
  reset();
  const org = ("test-judge-wire-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
  const fid = "fid-judge-wire";
  await seedCbFinding(org, fid, [{ answer: "No", header: "Q0" }], { isPackage: true });
  await saveWireDeductionEntry(org, {
    findingId: fid, ts: CB_NOW, score: 0, questionsAudited: 1, totalSuccess: 0,
    recordId: "r-" + fid, office: "ACT", excellenceAuditor: "T", guestName: "G",
  });

  await seedJudgeDecisions(org, fid, [{ questionIndex: 0, decision: "overturn" }]);
  await postJudgedAudit(org, fid, "judge@x.com");

  assertEquals(
    (await getWireDeductionEntries(org, 0, Number.MAX_SAFE_INTEGER)).length, 0,
    "package audit back to 100% — the wire deduction must be cleared too",
  );
});

// ─── postJudgedAudit — appeal record resolution ─────────────────────────────
// The appeal doc was written status:"pending" at file time and nothing ever
// moved it, so every judged appeal read "Appeal Pending" forever on admin /
// manager / operations-portal / super-manager audit history (all four render
// off the same audit-done-idx appealStatus), and record-dedup skipped those
// records permanently.

Deno.test("postJudgedAudit — resolves the appeal and flips the index badge to complete", async () => {
  reset();
  const org = ("test-judge-appeal-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
  const fid = "fid-judge-appeal";
  const completedAt = await makeFindingWith4Nos(org, fid);
  await saveAppeal(org, {
    findingId: fid, appealedAt: completedAt, status: "pending",
    auditor: "vo@x.com", comment: "bot errored", appealedQuestions: ["0"],
  });
  await writeAuditDoneIndex(org, {
    findingId: fid, completedAt, score: 0, completed: false, isPackage: false, voName: "VO 02 - Judge Test",
  });
  assertEquals(
    (await idxRowsFor(org, fid))[0]?.appealStatus,
    "pending", "badge reads Appeal Pending while the judge still has it",
  );

  await seedJudgeDecisions(org, fid, [{ questionIndex: 0, decision: "overturn" }]);
  await postJudgedAudit(org, fid, "judge@x.com");

  const appeal = await getAppeal(org, fid);
  assertEquals(appeal?.status, "complete", "appeal record must be resolved once the judge decides");
  assertEquals(appeal?.judgedBy, "judge@x.com");
  assertEquals(appeal?.comment, "bot errored", "resolving must not drop the auditor's appeal comment");
  assertEquals(
    (await idxRowsFor(org, fid))[0]?.appealStatus,
    "complete", "every audit-history surface reads this field — it must say complete",
  );
});

Deno.test("postJudgedAudit — an all-uphold appeal still closes (badge flips, score does not)", async () => {
  reset();
  const org = ("test-judge-appeal-up-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
  const fid = "fid-judge-appeal-up";
  const completedAt = await makeFindingWith4Nos(org, fid);
  await saveAppeal(org, {
    findingId: fid, appealedAt: completedAt, status: "pending", auditor: "vo@x.com", appealedQuestions: ["0"],
  });
  await writeAuditDoneIndex(org, {
    findingId: fid, completedAt, score: 42, completed: false, isPackage: false, voName: "VO 02 - Judge Test",
  });

  // Judge upholds everything — the appeal is decided, the score is not.
  await seedJudgeDecisions(org, fid, [{ questionIndex: 0, decision: "uphold" }]);
  await postJudgedAudit(org, fid, "judge@x.com");

  assertEquals((await getAppeal(org, fid))?.status, "complete", "a denied appeal is still a closed appeal");
  const entry = (await idxRowsFor(org, fid))[0];
  assertEquals(entry?.appealStatus, "complete", "badge must flip even when nothing was overturned");
  assertEquals(entry?.score, 42, "an upheld appeal must NOT move the score");
});
