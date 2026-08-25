/** E2E-ish tests for the dashboard entrypoint.
 *
 *  Exercises DashboardController.auditsData() directly (not via HTTP) to
 *  verify the SWR cache wrapper around queryAuditDoneIndex used by
 *  /admin/audits/data. The cache itself lives in the repository
 *  (src/audit/domain/data/stats-repository/queryAuditDoneIndex), so
 *  /admin/audits/data, /admin/unreviewed-audits (bulk-flip), and any
 *  future caller share it.
 *
 *  Forces in-mem mode so no real Firestore is involved. Verifies behavior
 *  through the public auditsData() method — doesn't peek at internal cache
 *  state (which would couple the test to implementation details and break
 *  the next time the cache layer moves). */

import { assert, assertEquals, assertExists } from "#assert";
import { resetFirestoreCredentials } from "@core/data/firestore/mod.ts";
import {
  writeAuditDoneIndex,
  _resetHiddenCacheForTesting,
  _resetQueryAuditDoneIndexCacheForTests,
} from "@audit/domain/data/stats-repository/mod.ts";
import { defaultOrgId } from "@core/business/auth/mod.ts";
import { DashboardController } from "./mod.ts";

Deno.test("dashboard e2e — placeholder", () => { assert(true); });

// The controller's auditsData hardcodes ORG() = defaultOrgId(), so tests
// must seed entries under the same orgId — otherwise the query returns
// zero matches.
// This file seeds and counts rows, so it must own its org outright: the
// configured default now points at a database with real snapshot data in it.
Deno.env.set("DEFAULT_ORG_ID", "dash-e2e-" + crypto.randomUUID().slice(0, 8));
const ORG = defaultOrgId();

function reset() {
  resetFirestoreCredentials();
  _resetHiddenCacheForTesting();
  _resetQueryAuditDoneIndexCacheForTests();
  // Clear the controller's remaining static caches (dash, not idx — that
  // moved to the repo). Casting to access private statics — fine for tests.
  // deno-lint-ignore no-explicit-any
  const C = DashboardController as any;
  C._dashCache?.clear?.();
  C._dashPending?.clear?.();
}

async function seedEntries(orgId: string, n: number, baseTs: number) {
  for (let i = 0; i < n; i++) {
    await writeAuditDoneIndex(orgId as never, {
      findingId: `fid-${i}`,
      completedAt: baseTs + i,
      completed: true,
      score: 80,
      recordId: `rec-${i}`,
    });
  }
}

Deno.test("audit-history cache — cold call returns seeded entries", async () => {
  reset();
  const ts = 1_700_000_000_000;
  await seedEntries(ORG, 3, ts);

  const ctrl = new DashboardController();
  const result = await ctrl.auditsData(
    String(ts - 1), String(ts + 1000), "all", "", "", "", "", "", "0", "100", "1", "50", "", "",
  ) as { items: unknown[]; total: number };
  assertExists(result.items);
  assertEquals(result.total, 3);
});

Deno.test("audit-history cache — warm call within 30s reuses cache (behavioral)", async () => {
  reset();
  const ts = 1_700_000_000_000;
  await seedEntries(ORG, 3, ts);

  const ctrl = new DashboardController();
  // Warm the cache with one call.
  await ctrl.auditsData(
    String(ts - 1), String(ts + 1000), "all", "", "", "", "", "", "0", "100", "1", "50", "", "",
  );
  // Drop the in-mem FS store entries — if the second call re-fetches from
  // FS it'll see zero entries; if it correctly serves from the repo cache
  // it'll still see 3.
  resetFirestoreCredentials();
  _resetHiddenCacheForTesting();
  // Deliberately DO NOT call _resetQueryAuditDoneIndexCacheForTests here
  // — that's the cache we're verifying.

  const result = await ctrl.auditsData(
    String(ts - 1), String(ts + 1000), "all", "", "", "", "", "", "0", "100", "1", "50", "", "",
  ) as { items: unknown[]; total: number };
  assertEquals(result.total, 3, "second call within 30s must serve cached value, not refetch");
});

Deno.test("audit-history cache — different date ranges return their own results", async () => {
  reset();
  const ts = 1_700_000_000_000;
  await seedEntries(ORG, 5, ts);

  const ctrl = new DashboardController();
  // Range 1 covers all 5
  const r1 = await ctrl.auditsData(
    String(ts - 1), String(ts + 100), "all", "", "", "", "", "", "0", "100", "1", "50", "", "",
  ) as { items: unknown[]; total: number };
  assertEquals(r1.total, 5);

  // Range 2 covers only first 3 — different cache slot, must not return r1's value
  const r2 = await ctrl.auditsData(
    String(ts - 1), String(ts + 2), "all", "", "", "", "", "", "0", "100", "1", "50", "", "",
  ) as { items: unknown[]; total: number };
  assertEquals(r2.total, 3, "different (from,to) range must have its own cache slot");
});
