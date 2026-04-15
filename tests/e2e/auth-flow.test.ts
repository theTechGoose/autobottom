/** E2E auth flow tests — pure fetch against running server.
 *  Run with: deno task test:e2e */
import { assertEquals, assert } from "#assert";
import { startServer, stopServer, createTestSession, BASE } from "./helpers.ts";

// Start server before all tests, stop after
let session: { cookie: string; email: string };

Deno.test({
  name: "E2E setup — start server and create test session",
  async fn() {
    await startServer();
    session = await createTestSession();
    console.log(`[E2E] Test session: ${session.email}`);
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// --- Public routes ---

Deno.test("E2E: GET /login returns 200 HTML (public)", async () => {
  const res = await fetch(`${BASE}/login`);
  assertEquals(res.status, 200);
  const text = await res.text();
  assert(text.includes("Sign in"), "Should contain login form");
});

Deno.test("E2E: GET /register returns 200 HTML (public)", async () => {
  const res = await fetch(`${BASE}/register`);
  assertEquals(res.status, 200);
  const text = await res.text();
  assert(text.includes("Create your organization"), "Should contain register form");
});

// --- Auth required routes ---

Deno.test("E2E: GET /admin/dashboard without cookie → 302 redirect to /login", async () => {
  const res = await fetch(`${BASE}/admin/dashboard`, { redirect: "manual" });
  assertEquals(res.status, 302);
  const location = res.headers.get("location") ?? "";
  assert(location.includes("/login"), `Should redirect to login, got: ${location}`);
});

Deno.test("E2E: GET /admin/api/me with cookie → 200 JSON with email and role", async () => {
  const res = await fetch(`${BASE}/admin/api/me`, {
    headers: { cookie: session.cookie },
  });
  assertEquals(res.status, 200);
  const data = await res.json();
  assertEquals(data.email, session.email);
  assertEquals(data.role, "admin");
});

Deno.test("E2E: GET /admin/dashboard with cookie → 200 HTML", async () => {
  const res = await fetch(`${BASE}/admin/dashboard`, {
    headers: { cookie: session.cookie },
  });
  assertEquals(res.status, 200);
  const text = await res.text();
  assert(text.includes("Dashboard"), "Should contain dashboard content");
  assert(text.includes("<!DOCTYPE html>") || text.includes("<html"), "Should be HTML");
});

Deno.test("E2E: GET /review with cookie → 200 HTML", async () => {
  const res = await fetch(`${BASE}/review`, {
    headers: { cookie: session.cookie },
  });
  assertEquals(res.status, 200);
  const text = await res.text();
  assert(text.includes("<html"), "Should be HTML");
});

Deno.test("E2E: GET /admin/api/me without cookie → 401", async () => {
  const res = await fetch(`${BASE}/admin/api/me`);
  assertEquals(res.status, 401);
});

// --- Register + Login flow ---

Deno.test("E2E: POST /api/register creates org → 303 with cookie", async () => {
  const ts = Date.now();
  const res = await fetch(`${BASE}/api/register`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `orgName=FlowTest${ts}&email=flow${ts}@test.local&password=testpass`,
    redirect: "manual",
  });
  assertEquals(res.status, 303);
  const cookie = res.headers.get("set-cookie") ?? "";
  assert(cookie.includes("session="), "Should set session cookie");
  const location = res.headers.get("location") ?? "";
  assertEquals(location, "/admin/dashboard");
});

Deno.test("E2E: POST /api/login with valid creds → 303 with cookie", async () => {
  // Use the session we created in setup
  const ts = Date.now();
  const email = `login${ts}@test.local`;
  // First register
  await fetch(`${BASE}/api/register`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `orgName=LoginTest${ts}&email=${email}&password=testpass`,
    redirect: "manual",
  });
  // Then login
  const res = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `email=${email}&password=testpass`,
    redirect: "manual",
  });
  assertEquals(res.status, 303);
  const cookie = res.headers.get("set-cookie") ?? "";
  assert(cookie.includes("session="), "Should set session cookie");
});

// --- Cleanup ---

Deno.test({
  name: "E2E cleanup — stop server",
  fn() {
    stopServer();
  },
  sanitizeResources: false,
  sanitizeOps: false,
});
