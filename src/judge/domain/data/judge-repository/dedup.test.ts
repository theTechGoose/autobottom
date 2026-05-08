/** End-to-end test for the dedup soft-hide path using the in-memory Firestore
 *  fallback. Exercises markFindingHidden + getHiddenFindingIds + the public
 *  deleteDuplicates entrypoint and the queryAuditDoneIndex hidden filter.
 *
 *  Forces in-mem mode via resetFirestoreCredentials() so no real Firestore
 *  is involved. After resetFirestoreCredentials() we also reset the per-
 *  isolate hidden cache (resetFirestoreCredentials wipes the in-mem store
 *  but not this cache; tests that depend on freshness need both). */

import { assert, assertEquals, assertExists } from "#assert";
import {
  resetFirestoreCredentials,
  setStored, getStored,
} from "@core/data/firestore/mod.ts";
import {
  writeAuditDoneIndex,
  queryAuditDoneIndex,
  markFindingHidden,
  getHiddenFindingIds,
  _resetHiddenCacheForTesting,
  type AuditHiddenEntry,
} from "@audit/domain/data/stats-repository/mod.ts";
import { findDuplicates, deleteDuplicates, type DedupPlan } from "./mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

const ORG = "test-org" as OrgId;

function reset() {
  resetFirestoreCredentials();
  _resetHiddenCacheForTesting();
}

Deno.test("dedup — markFindingHidden writes the audit-hidden doc", async () => {
  reset();
  await markFindingHidden(ORG, "fid-1", "dedup");
  const v = await getStored<AuditHiddenEntry>("audit-hidden", ORG, "fid-1");
  assertExists(v);
  assertEquals(v?.findingId, "fid-1");
  assertEquals(v?.reason, "duplicate");
  assertEquals(v?.hiddenBy, "dedup");
  assert(typeof v?.hiddenAt === "number" && v.hiddenAt > 0);
});

Deno.test("dedup — getHiddenFindingIds returns the right Set", async () => {
  reset();
  await markFindingHidden(ORG, "fid-a", "dedup");
  await markFindingHidden(ORG, "fid-b", "dedup");
  const ids = await getHiddenFindingIds(ORG);
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
  const result = await deleteDuplicates(ORG, plan);
  assertEquals(result.deleted, 2);

  // Losers flagged
  assertExists(await getStored("audit-hidden", ORG, "fid-loser-1"));
  assertExists(await getStored("audit-hidden", ORG, "fid-loser-2"));
  // Keeper NOT flagged
  assertEquals(await getStored("audit-hidden", ORG, "fid-keep"), null);
});

Deno.test("dedup — deleteDuplicates is idempotent (call twice, no errors)", async () => {
  reset();
  const ts = 1_700_000_000_000;
  const plan: DedupPlan = {
    scanned: 1, groups: 1, orphaned: 0,
    toDelete: [{ id: "fid-idem", recordKey: "rk", ts, reviewed: false, keep: false }],
  };
  await deleteDuplicates(ORG, plan);
  await deleteDuplicates(ORG, plan); // must not throw
  const v = await getStored<AuditHiddenEntry>("audit-hidden", ORG, "fid-idem");
  assertExists(v);
});

Deno.test("dedup — flagged findings stay in audit-finding (no physical delete)", async () => {
  reset();
  const findingId = "fid-stays";
  const ts = 1_700_000_000_000;
  await setStored("audit-finding", ORG, [findingId], { id: findingId, body: "still here" });

  const plan: DedupPlan = {
    scanned: 1, groups: 1, orphaned: 0,
    toDelete: [{ id: findingId, recordKey: "rk", ts, reviewed: false, keep: false }],
  };
  await deleteDuplicates(ORG, plan);

  const stillThere = await getStored<{ id: string; body: string }>("audit-finding", ORG, findingId);
  assertExists(stillThere);
  assertEquals(stillThere?.body, "still here");
});

Deno.test("dedup — queryAuditDoneIndex hides flagged findings", async () => {
  reset();
  const tsA = 1_700_000_000_000;
  const tsB = 1_700_000_001_000;
  await writeAuditDoneIndex(ORG, {
    findingId: "fid-visible", completedAt: tsA, completed: true, score: 90, recordId: "r1",
  });
  await writeAuditDoneIndex(ORG, {
    findingId: "fid-hidden", completedAt: tsB, completed: true, score: 80, recordId: "r2",
  });
  await markFindingHidden(ORG, "fid-hidden", "dedup");

  const got = await queryAuditDoneIndex(ORG, tsA - 1, tsB + 1);
  const ids = got.map((e) => e.findingId).sort();
  assertEquals(ids, ["fid-visible"]);
});

// findDuplicates uses queryAuditDoneIndex internally, which already filters
// hidden — so a re-run of findDuplicates after a deleteDuplicates pass sees
// only un-flagged findings and produces an empty plan. Smoke-test that.
Deno.test("dedup — findDuplicates is idempotent after deleteDuplicates", async () => {
  reset();
  const recordId = "rec-shared";
  const tsA = 1_700_000_000_000;
  const tsB = 1_700_000_500_000;

  await writeAuditDoneIndex(ORG, {
    findingId: "fid-A", completedAt: tsA, completed: true, score: 90, recordId, reason: "reviewed",
  });
  await writeAuditDoneIndex(ORG, {
    findingId: "fid-B", completedAt: tsB, completed: true, score: 80, recordId, reason: "perfect_score",
  });

  const plan1 = await findDuplicates(ORG, tsA - 1, tsB + 1);
  assertEquals(plan1.groups, 1);
  const losers = plan1.toDelete.filter((d) => !d.keep);
  assertEquals(losers.length, 1);

  await deleteDuplicates(ORG, plan1);
  // Bust cache so the second run sees the freshly-flagged hidden ID.
  _resetHiddenCacheForTesting();

  const plan2 = await findDuplicates(ORG, tsA - 1, tsB + 1);
  // Loser is hidden; only the keeper remains in scope, so no dup group.
  assertEquals(plan2.groups, 0);
  assertEquals(plan2.toDelete.length, 0);
});
