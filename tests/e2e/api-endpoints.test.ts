/** E2E API endpoint tests — verify backend JSON endpoints work through unified server.
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

// --- Backend JSON endpoints (these go through danet) ---

Deno.test("E2E API: GET /admin/dashboard/data → JSON with pipeline stats", async () => {
  const res = await fetch(`${BASE}/admin/dashboard/data`, {
    headers: { cookie: session.cookie },
  });
  assertEquals(res.status, 200);
  const data = await res.json();
  assert("pipeline" in data, "Should have pipeline key");
  assert("review" in data, "Should have review key");
  assert("recentCompleted" in data, "Should have recentCompleted key");
});

Deno.test("E2E API: GET /audit/stats → JSON with pipeline stats", async () => {
  const res = await fetch(`${BASE}/audit/stats`, {
    headers: { cookie: session.cookie },
  });
  assertEquals(res.status, 200);
  const data = await res.json();
  assert(typeof data === "object", "Should be JSON object");
});

Deno.test("E2E API: GET /review/api/stats → JSON with review stats", async () => {
  const res = await fetch(`${BASE}/review/api/stats`, {
    headers: { cookie: session.cookie },
  });
  assertEquals(res.status, 200);
  const data = await res.json();
  assert("pending" in data, "Should have pending key");
  assert("decided" in data, "Should have decided key");
});

Deno.test("E2E API: GET /admin/users → JSON with users array", async () => {
  const res = await fetch(`${BASE}/admin/users`, {
    headers: { cookie: session.cookie },
  });
  assertEquals(res.status, 200);
  const data = await res.json();
  assert("users" in data, "Should have users key");
  assert(Array.isArray(data.users), "users should be array");
});

Deno.test("E2E API: GET /cron/status → JSON", async () => {
  const res = await fetch(`${BASE}/cron/status`);
  assertEquals(res.status, 200);
  const data = await res.json();
  assert("ok" in data || "crons" in data, "Should have ok or crons key");
});

Deno.test("E2E API: GET /admin/pipeline-config → JSON", async () => {
  const res = await fetch(`${BASE}/admin/pipeline-config`, {
    headers: { cookie: session.cookie },
  });
  assertEquals(res.status, 200);
  const data = await res.json();
  assert(typeof data === "object", "Should be JSON object");
});

// --- Cleanup ---

Deno.test({
  name: "E2E API cleanup — stop server",
  fn() {
    stopServer();
  },
  sanitizeResources: false,
  sanitizeOps: false,
});
