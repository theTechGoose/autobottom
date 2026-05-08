/** Verifies the SWR cache wrapper around queryAuditDoneIndex used by
 *  /admin/audits/data. Forces in-mem mode so no real Firestore is
 *  involved. The cache lives as a private static on
 *  DashboardController, so we exercise it indirectly through the
 *  public auditsData() method. */

import { assert, assertEquals, assertExists } from "#assert";
import { resetFirestoreCredentials } from "@core/data/firestore/mod.ts";
import {
  writeAuditDoneIndex,
  _resetHiddenCacheForTesting,
} from "@audit/domain/data/stats-repository/mod.ts";
import { defaultOrgId } from "@core/business/auth/mod.ts";
import { DashboardController } from "./mod.ts";

// The controller's auditsData hardcodes ORG() = defaultOrgId(), so the
// test must seed entries under the same orgId — otherwise the query
// returns zero matches.
const ORG = defaultOrgId();

function reset() {
  resetFirestoreCredentials();
  _resetHiddenCacheForTesting();
  // Clear the controller's static caches between tests so each test
  // starts cold. Casting to access private statics — fine for tests.
  // deno-lint-ignore no-explicit-any
  const C = DashboardController as any;
  C._auditIdxCache?.clear?.();
  C._auditIdxPending?.clear?.();
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

Deno.test("audit-history cache — cold call populates the cache", async () => {
  reset();
  const ts = 1_700_000_000_000;
  await seedEntries(ORG, 3, ts);

  const ctrl = new DashboardController();
  const result = await ctrl.auditsData(
    String(ts - 1), String(ts + 1000), "all", "", "", "", "", "", "0", "100", "1", "50", "",
  ) as { items: unknown[]; total: number };
  assertExists(result.items);
  assertEquals(result.total, 3);

  // deno-lint-ignore no-explicit-any
  const C = DashboardController as any;
  const cacheKey = `${ORG}:${ts - 1}:${ts + 1000}`;
  const cached = C._auditIdxCache.get(cacheKey);
  assertExists(cached, "expected cache populated after cold call");
  assertEquals(cached.value.length, 3);
});

Deno.test("audit-history cache — warm call within 30s reuses cache", async () => {
  reset();
  const ts = 1_700_000_000_000;
  await seedEntries(ORG, 3, ts);

  const ctrl = new DashboardController();
  // Warm
  await ctrl.auditsData(
    String(ts - 1), String(ts + 1000), "all", "", "", "", "", "", "0", "100", "1", "50", "",
  );
  // Drop the in-mem store entries — if the second call re-fetches from
  // FS it'll see zero entries; if it correctly serves from cache it'll
  // still see 3.
  resetFirestoreCredentials();
  _resetHiddenCacheForTesting();

  const result = await ctrl.auditsData(
    String(ts - 1), String(ts + 1000), "all", "", "", "", "", "", "0", "100", "1", "50", "",
  ) as { items: unknown[]; total: number };
  assertEquals(result.total, 3, "second call within 30s must serve cached value");
});

Deno.test("audit-history cache — different date range gets a separate cache slot", async () => {
  reset();
  const ts = 1_700_000_000_000;
  await seedEntries(ORG, 5, ts);

  const ctrl = new DashboardController();
  // Range 1 covers all 5
  const r1 = await ctrl.auditsData(
    String(ts - 1), String(ts + 100), "all", "", "", "", "", "", "0", "100", "1", "50", "",
  ) as { items: unknown[]; total: number };
  assertEquals(r1.total, 5);

  // Range 2 covers only first 3
  const r2 = await ctrl.auditsData(
    String(ts - 1), String(ts + 2), "all", "", "", "", "", "", "0", "100", "1", "50", "",
  ) as { items: unknown[]; total: number };
  assertEquals(r2.total, 3);

  // deno-lint-ignore no-explicit-any
  const C = DashboardController as any;
  assert(C._auditIdxCache.size >= 2, "expected at least 2 distinct cache entries");
});
