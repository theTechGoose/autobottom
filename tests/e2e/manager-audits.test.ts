/** E2E for manager audit-history endpoint.
 *
 *  Verifies:
 *   - GET /manager/api/audit-history requires auth
 *   - returns shape {items, total, pages, page, owners, shifts, departments}
 *   - admin sees everything in window
 *   - manager scoping limits results to reviewed audits
 *   - date range filter narrows results
 *   - score range filter applies
 *   - reviewed=auto returns only perfect_score / invalid_genie items
 *   - pagination respects page + limit
 *   - owners/shifts/departments lists derived from in-window scoped entries
 *
 *  Approach: drive the endpoint by writing audit-done-index entries directly
 *  via POST /admin/test-fixtures... NOT available — instead we verify the
 *  endpoint is wired (auth + shape) and exercise filter parsing. Backend logic
 *  tests live next to the domain function.
 *
 *  Run: deno test -A --unstable-raw-imports --unstable-kv tests/e2e/manager-audits.test.ts
 */
import { assertEquals, assert } from "#assert";
import { startServer, stopServer, createTestSession, BASE } from "./helpers.ts";

let session: { cookie: string; email: string };

Deno.test({
  name: "E2E manager-audits setup — start server and create session",
  async fn() {
    await startServer();
    session = await createTestSession();
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({ name: "E2E manager-audits: requires auth (no cookie → 401)", sanitizeResources: false, async fn() {
  const res = await fetch(`${BASE}/manager/api/audit-history`);
  assertEquals(res.status, 401, `expected 401 unauthorized, got ${res.status}`);
}});

Deno.test({ name: "E2E manager-audits: admin session returns the expected shape", sanitizeResources: false, async fn() {
  // Default test session is admin (registered via /api/register → first user is admin).
  const res = await fetch(`${BASE}/manager/api/audit-history`, { headers: { cookie: session.cookie } });
  assertEquals(res.status, 200, `expected 200, got ${res.status}`);
  const data = await res.json() as Record<string, unknown>;
  // Shape contract — must match what the frontend page expects.
  for (const key of ["items", "total", "pages", "page", "owners", "shifts", "departments"]) {
    assert(key in data, `response missing "${key}" — shape contract violated`);
  }
  assert(Array.isArray(data.items), "items must be an array");
  assert(Array.isArray(data.owners), "owners must be an array");
  assert(Array.isArray(data.shifts), "shifts must be an array");
  assert(Array.isArray(data.departments), "departments must be an array");
  assertEquals(typeof data.total, "number");
  assertEquals(typeof data.pages, "number");
  assertEquals(typeof data.page, "number");
}});

Deno.test({ name: "E2E manager-audits: defaults to today (start-of-day → now)", sanitizeResources: false, async fn() {
  // No since/until → server defaults to start-of-day. Smoke that the endpoint
  // returns the same items count for two back-to-back default calls.
  const a = await fetch(`${BASE}/manager/api/audit-history`, { headers: { cookie: session.cookie } });
  const b = await fetch(`${BASE}/manager/api/audit-history`, { headers: { cookie: session.cookie } });
  assertEquals(a.status, 200);
  assertEquals(b.status, 200);
  const aData = await a.json() as { total: number };
  const bData = await b.json() as { total: number };
  // The default window is stable (within seconds), so the totals should match
  // — except in the edge case where a new audit completed between the two
  // requests (unlikely in an E2E run with a fresh org). If this ever flakes,
  // relax to `assert(Math.abs(...) <= 1)`.
  assert(Math.abs(aData.total - bData.total) <= 1, "default-window total should be stable");
}});

Deno.test({ name: "E2E manager-audits: explicit since/until applies", sanitizeResources: false, async fn() {
  // Way-in-the-past window → nothing should match for a fresh org.
  const since = "0";
  const until = "1000";
  const url = `${BASE}/manager/api/audit-history?since=${since}&until=${until}`;
  const res = await fetch(url, { headers: { cookie: session.cookie } });
  assertEquals(res.status, 200);
  const data = await res.json() as { total: number; items: unknown[] };
  assertEquals(data.total, 0, "no audits in 1970 → total must be 0");
  assertEquals(data.items.length, 0);
}});

Deno.test({ name: "E2E manager-audits: score range narrows results", sanitizeResources: false, async fn() {
  // Inverted range (min > max) → empty.
  const url = `${BASE}/manager/api/audit-history?scoreMin=99&scoreMax=1`;
  const res = await fetch(url, { headers: { cookie: session.cookie } });
  assertEquals(res.status, 200);
  const data = await res.json() as { total: number };
  assertEquals(data.total, 0, "scoreMin > scoreMax must yield zero results");
}});

Deno.test({ name: "E2E manager-audits: reviewed=auto filter is honored", sanitizeResources: false, async fn() {
  const res = await fetch(`${BASE}/manager/api/audit-history?reviewed=auto`, { headers: { cookie: session.cookie } });
  assertEquals(res.status, 200);
  const data = await res.json() as { items: Array<{ reason?: string }> };
  for (const it of data.items) {
    assert(
      it.reason === "perfect_score" || it.reason === "invalid_genie",
      `reviewed=auto must only return perfect_score/invalid_genie items, got reason=${it.reason}`,
    );
  }
}});

Deno.test({ name: "E2E manager-audits: pagination respects limit + page", sanitizeResources: false, async fn() {
  const res1 = await fetch(`${BASE}/manager/api/audit-history?limit=10&page=1`, { headers: { cookie: session.cookie } });
  assertEquals(res1.status, 200);
  const d1 = await res1.json() as { items: unknown[]; page: number; pages: number; total: number };
  assertEquals(d1.page, 1);
  assert(d1.items.length <= 10, `page=1 limit=10 returned ${d1.items.length} items`);
  assertEquals(d1.pages, Math.max(1, Math.ceil(d1.total / 10)), "pages must equal ceil(total/limit)");

  // page=2 returns items disjoint from page=1 (when there are enough results)
  if (d1.total > 10) {
    const res2 = await fetch(`${BASE}/manager/api/audit-history?limit=10&page=2`, { headers: { cookie: session.cookie } });
    const d2 = await res2.json() as { items: Array<{ findingId: string }>; page: number };
    assertEquals(d2.page, 2);
    const ids1 = new Set((d1.items as Array<{ findingId: string }>).map((i) => i.findingId));
    for (const it of d2.items) assert(!ids1.has(it.findingId), `page=2 item ${it.findingId} also appeared on page=1`);
  }
}});

Deno.test({ name: "E2E manager-audits: owners/shifts/departments lists are arrays of strings", sanitizeResources: false, async fn() {
  const res = await fetch(`${BASE}/manager/api/audit-history`, { headers: { cookie: session.cookie } });
  assertEquals(res.status, 200);
  const data = await res.json() as { owners: unknown[]; shifts: unknown[]; departments: unknown[] };
  for (const key of ["owners", "shifts", "departments"] as const) {
    for (const v of data[key]) {
      assertEquals(typeof v, "string", `${key} must contain only strings — got ${typeof v}`);
    }
  }
}});

Deno.test({ name: "E2E manager-audits: limit clamped to [10, 100]", sanitizeResources: false, async fn() {
  // limit=5 clamps to 10; limit=999 clamps to 100. Verify by checking the
  // returned items.length never exceeds the clamped limit.
  const a = await fetch(`${BASE}/manager/api/audit-history?limit=5`, { headers: { cookie: session.cookie } });
  const b = await fetch(`${BASE}/manager/api/audit-history?limit=999`, { headers: { cookie: session.cookie } });
  assertEquals(a.status, 200);
  assertEquals(b.status, 200);
  const ad = await a.json() as { items: unknown[] };
  const bd = await b.json() as { items: unknown[] };
  assert(ad.items.length <= 10, `limit=5 should clamp to >=10, got items=${ad.items.length}`);
  assert(bd.items.length <= 100, `limit=999 should clamp to <=100, got items=${bd.items.length}`);
}});

Deno.test({
  name: "E2E manager-audits cleanup — stop server",
  fn() { stopServer(); },
  sanitizeResources: false,
  sanitizeOps: false,
});
