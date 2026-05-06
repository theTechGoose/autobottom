/** E2E API endpoint tests — verify backend JSON endpoints through unified server.
 *  Run with: deno task test:e2e */
import { assertEquals, assert } from "#assert";
import { startServer, stopServer, createTestSession, BASE } from "./helpers.ts";

let session: { cookie: string; email: string };

Deno.test({
  name: "E2E API setup — start server and create session",
  async fn() {
    await startServer();
    session = await createTestSession();
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({ name: "E2E API: GET /admin/dashboard/data → JSON with pipeline stats", sanitizeResources: false, async fn() {
  const res = await fetch(`${BASE}/admin/dashboard/data`, { headers: { cookie: session.cookie } });
  assertEquals(res.status, 200);
  const data = await res.json();
  assert("pipeline" in data, "Should have pipeline key");
  assert("review" in data, "Should have review key");
}});

Deno.test({ name: "E2E API: GET /audit/stats → JSON", sanitizeResources: false, async fn() {
  const res = await fetch(`${BASE}/audit/stats`, { headers: { cookie: session.cookie } });
  assertEquals(res.status, 200);
  const data = await res.json();
  assert(typeof data === "object", "Should be JSON object");
}});

Deno.test({ name: "E2E API: GET /review/api/stats → JSON with review stats", sanitizeResources: false, async fn() {
  const res = await fetch(`${BASE}/review/api/stats`, { headers: { cookie: session.cookie } });
  assertEquals(res.status, 200);
  const data = await res.json();
  assert("pending" in data, "Should have pending key");
  assert("decided" in data, "Should have decided key");
}});

Deno.test({ name: "E2E API: GET /admin/token-usage → JSON with token data", sanitizeResources: false, async fn() {
  const res = await fetch(`${BASE}/admin/token-usage`, { headers: { cookie: session.cookie } });
  assertEquals(res.status, 200);
  const data = await res.json();
  assert("total_tokens" in data, "Should have total_tokens key");
  assert("calls" in data, "Should have calls key");
}});

Deno.test({ name: "E2E API: GET /cron/status → JSON", sanitizeResources: false, async fn() {
  const res = await fetch(`${BASE}/cron/status`);
  assertEquals(res.status, 200);
  const data = await res.json();
  assert("ok" in data || "crons" in data, "Should have ok or crons key");
}});

Deno.test({ name: "E2E API: GET /admin/pipeline-config → JSON", sanitizeResources: false, async fn() {
  const res = await fetch(`${BASE}/admin/pipeline-config`, { headers: { cookie: session.cookie } });
  assertEquals(res.status, 200);
  const data = await res.json();
  assert(typeof data === "object", "Should be JSON object");
}});

Deno.test({
  name: "E2E API cleanup — stop server",
  fn() { stopServer(); },
  sanitizeResources: false,
  sanitizeOps: false,
});
