/** Smoke tests for record-ID deduplication — the keeper rule (pure) and the
 *  full "strip to inert, keep the body" eviction (money path). */

import { assert, assertEquals } from "#assert";
import { diagnoseDuplicateRecords, evictDuplicateFinding, evictDuplicateRecords, pickRecordKeeper } from "./mod.ts";
import type { AuditDoneIndexEntry } from "@core/dto/types.ts";
import {
  _resetHiddenCacheForTesting,
  getChargebackEntry,
  getHiddenFindingIds,
  saveChargebackEntry,
  writeAuditDoneIndex,
} from "@audit/domain/data/stats-repository/mod.ts";
import { getFinding, saveFinding } from "@audit/domain/data/audit-repository/mod.ts";

const kvOpts = { sanitizeResources: false, sanitizeOps: false };

function entry(p: Partial<AuditDoneIndexEntry> & { findingId: string }): AuditDoneIndexEntry {
  return { completed: true, completedAt: p.startedAt ?? 0, score: 0, ...p };
}

// ── Keeper rule (pure) ───────────────────────────────────────────────────────

Deno.test("pickRecordKeeper — 100%-on-entry beats a reviewed (and later) audit", () => {
  const members = [
    entry({ findingId: "reviewed-newer", reason: "reviewed", reviewedBy: "a@x", startedAt: 200, score: 80 }),
    entry({ findingId: "entry100-older", reason: "perfect_score", startedAt: 100, score: 100 }),
  ];
  const { keeperIdx, reason } = pickRecordKeeper(members);
  assertEquals(reason, "entry_100");
  assertEquals(members[keeperIdx].findingId, "entry100-older");
});

Deno.test("pickRecordKeeper — reviewed beats a later unreviewed audit", () => {
  const members = [
    entry({ findingId: "unreviewed-newer", startedAt: 300, score: 50 }),
    entry({ findingId: "reviewed-older", reviewedBy: "a@x", startedAt: 100, score: 76 }),
  ];
  const { keeperIdx, reason } = pickRecordKeeper(members);
  assertEquals(reason, "reviewed");
  assertEquals(members[keeperIdx].findingId, "reviewed-older");
});

Deno.test("pickRecordKeeper — else the latest-audited wins", () => {
  const members = [
    entry({ findingId: "old", startedAt: 100, score: 40 }),
    entry({ findingId: "new", startedAt: 300, score: 60 }),
    entry({ findingId: "mid", startedAt: 200, score: 50 }),
  ];
  const { keeperIdx, reason } = pickRecordKeeper(members);
  assertEquals(reason, "latest");
  assertEquals(members[keeperIdx].findingId, "new");
});

Deno.test("pickRecordKeeper — all reviewed, none 100: latest startedAt breaks the tie (489476 shape)", () => {
  const members = [
    entry({ findingId: "m_t_jO", reviewedBy: "joshk@x", startedAt: 1783640458862, score: 76 }),
    entry({ findingId: "wdNtTgh", reviewedBy: "aknight@x", startedAt: 1783640765856, score: 80 }),
    entry({ findingId: "kdpiqu", reviewedBy: "joshk@x", startedAt: 1783641358754, score: 76 }),
  ];
  const { keeperIdx, reason } = pickRecordKeeper(members);
  assertEquals(reason, "reviewed");
  assertEquals(members[keeperIdx].findingId, "kdpiqu"); // latest startedAt
});

Deno.test("pickRecordKeeper — ranks by startedAt (audit time), not review-polluted completedAt", () => {
  // early-audit ran first (startedAt 100) but was reviewed LAST (completedAt 999);
  // late-audit ran later (startedAt 200) but was reviewed earlier (completedAt 500).
  // completedAt is re-keyed to the review time, so ranking on it would pick the
  // wrong finding. startedAt is the true audit time → late-audit wins.
  const members = [
    entry({ findingId: "early-audit", reviewedBy: "a@x", startedAt: 100, completedAt: 999, score: 70 }),
    entry({ findingId: "late-audit", reviewedBy: "a@x", startedAt: 200, completedAt: 500, score: 70 }),
  ];
  const { keeperIdx } = pickRecordKeeper(members);
  assertEquals(members[keeperIdx].findingId, "late-audit");
});

// ── Eviction (money path) ────────────────────────────────────────────────────

Deno.test({
  name: "evictDuplicateFinding — drains the payroll row + marks hidden, keeps the raw audit body",
  ...kvOpts,
  fn: async () => {
    const org = "test-dedup-evict-" + crypto.randomUUID().slice(0, 8);
    const fid = "loser-" + crypto.randomUUID().slice(0, 8);
    _resetHiddenCacheForTesting();

    await saveFinding(org, {
      id: fid,
      findingStatus: "finished",
      record: { RecordId: "R1" },
      recordingId: "G1",
      answeredQuestions: [],
      startedAt: 100,
      completedAt: 200,
    });
    await writeAuditDoneIndex(
      org,
      { findingId: fid, completedAt: 200, completed: true, score: 76, recordId: "R1", startedAt: 100, reviewedBy: "a@x", reason: "reviewed" },
      { assumeFinished: true },
    );
    // deno-lint-ignore no-explicit-any
    await saveChargebackEntry(org, { findingId: fid, recordId: "R1", score: 76 } as any);
    assert((await getChargebackEntry(org, fid)) !== null, "chargeback seeded");

    const { hadChargeback } = await evictDuplicateFinding(org, fid, "test");
    assertEquals(hadChargeback, true, "reported it removed a chargeback row");
    assertEquals(await getChargebackEntry(org, fid), null, "payroll row removed");

    _resetHiddenCacheForTesting();
    assert((await getHiddenFindingIds(org)).has(fid), "finding marked hidden(duplicate)");
    assert((await getFinding(org, fid)) !== null, "raw audit body kept (recoverable parachute)");
  },
});

Deno.test({
  name: "diagnose + evict records — keeps the latest reviewed, retires the rest of the booking",
  ...kvOpts,
  fn: async () => {
    const org = "test-dedup-rec-" + crypto.randomUUID().slice(0, 8);
    const rid = "489476";
    _resetHiddenCacheForTesting();

    const seed = async (fid: string, startedAt: number, score: number) => {
      await saveFinding(org, {
        id: fid,
        findingStatus: "finished",
        record: { RecordId: rid },
        recordingId: "G1",
        answeredQuestions: [],
        startedAt,
        completedAt: startedAt + 100,
      });
      await writeAuditDoneIndex(
        org,
        { findingId: fid, completedAt: startedAt + 100, completed: true, score, recordId: rid, startedAt, reviewedBy: "r@x", reason: "reviewed" },
        { assumeFinished: true },
      );
      // deno-lint-ignore no-explicit-any
      await saveChargebackEntry(org, { findingId: fid, recordId: rid, score } as any);
    };
    // Three reviewed audits of the SAME record; f-c is the latest-audited.
    // Realistic recent timestamps — findAuditsByRecordId (the authoritative
    // re-resolve) only looks back 365d from now, so 1970-era values are invisible.
    const base = Date.now() - 3 * 86_400_000; // 3 days ago
    await seed("f-a", base, 76);
    await seed("f-b", base + 5 * 60_000, 80);
    await seed("f-c", base + 15 * 60_000, 76);

    const diag = await diagnoseDuplicateRecords(org, 0, Date.now() + 1000);
    assertEquals(diag.recordsWithDupes, 1, "one record audited more than once");
    assertEquals(diag.losersToEvict, 2, "two losers");
    const grp = diag.sampleGroups[0];
    assertEquals(grp.keeperId, "f-c", "latest-audited reviewed finding kept");
    assertEquals(grp.keeperReason, "reviewed");

    const res = await evictDuplicateRecords(org, 0, Date.now() + 1000, { execute: true, hiddenBy: "test" });
    assertEquals(res.evicted, 2);
    assertEquals(res.chargebacksRemoved, 2, "both losers' payroll rows removed");

    assert((await getChargebackEntry(org, "f-c")) !== null, "keeper payroll intact");
    assertEquals(await getChargebackEntry(org, "f-a"), null, "loser a payroll removed");
    assertEquals(await getChargebackEntry(org, "f-b"), null, "loser b payroll removed");

    _resetHiddenCacheForTesting();
    const hidden = await getHiddenFindingIds(org);
    assert(!hidden.has("f-c"), "keeper not hidden");
    assert(hidden.has("f-a") && hidden.has("f-b"), "losers marked hidden(duplicate)");
  },
});
