/** E2E test for the Question Lab admin modal + CRUD routing.
 *  Regression guards:
 *    - main.ts had `/api/qlab` in BACKEND_PREFIXES, sending the frontend
 *      HTMX wrapper URL `/api/qlab/configs/new` to danet which 404'd.
 *      The fix added the wrapper paths to FRONTEND_PREFIX_PATHS so they hit
 *      Fresh's filesystem routes instead.
 *    - The dashboard QLab admin modal at `/api/admin/modal/qlab` is a new
 *      surface that mirrors prod's "Question Lab" admin modal. */
import { assertEquals, assert, assertStringIncludes } from "#assert";
import { startServer, stopServer, createTestSession, BASE } from "./helpers.ts";

let session: { cookie: string; email: string };

Deno.test({
  name: "E2E QLab setup — start server and create session",
  async fn() {
    await startServer();
    session = await createTestSession();
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({ name: "E2E QLab: POST /api/qlab/configs/new returns 200 HTML (regression: was 404)", sanitizeResources: false, async fn() {
  const res = await fetch(`${BASE}/api/qlab/configs/new`, {
    method: "POST",
    headers: { cookie: session.cookie, "content-type": "application/x-www-form-urlencoded" },
    redirect: "manual",
  });
  assertEquals(res.status, 200, `expected 200 (frontend HTMX wrapper), got ${res.status}`);
  assertEquals(res.headers.get("content-type"), "text/html");
  await res.text();
}});

Deno.test({ name: "E2E QLab: GET /api/admin/modal/qlab renders modal HTML with builder link", sanitizeResources: false, async fn() {
  const res = await fetch(`${BASE}/api/admin/modal/qlab`, {
    headers: { cookie: session.cookie },
    redirect: "manual",
  });
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "text/html");
  const html = await res.text();
  assertStringIncludes(html, "Question Lab");
  assertStringIncludes(html, "Open Config Builder");
  assertStringIncludes(html, "/question-lab");
  assertStringIncludes(html, "Internal (Date Legs)");
  assertStringIncludes(html, "Partner (Packages)");
  assertStringIncludes(html, "Remove / Use Product default");
}});

Deno.test({ name: "E2E QLab: GET /api/admin/modal/qlab?tab=partner shows partner-tab body", sanitizeResources: false, async fn() {
  const res = await fetch(`${BASE}/api/admin/modal/qlab?tab=partner`, {
    headers: { cookie: session.cookie },
    redirect: "manual",
  });
  assertEquals(res.status, 200);
  const html = await res.text();
  assertStringIncludes(html, 'name="type" value="partner"');
  assertStringIncludes(html, "No office assignments yet.");
}});

Deno.test({ name: "E2E QLab: backend GET /api/qlab-assignments returns { internal, partner } shape", sanitizeResources: false, async fn() {
  const res = await fetch(`${BASE}/api/qlab-assignments`, { headers: { cookie: session.cookie } });
  assertEquals(res.status, 200);
  const data = await res.json();
  assert("internal" in data, "response must include `internal`");
  assert("partner" in data, "response must include `partner`");
}});

Deno.test({ name: "E2E QLab: POST /api/admin/modal/qlab/set creates assignment + re-renders modal", sanitizeResources: false, async fn() {
  const ts = Date.now();
  const configName = `E2E-Config-${ts}`;
  const destKey = `dest-${ts}`;

  // Need a config to bind to first — use the backend create endpoint.
  const cfgRes = await fetch(`${BASE}/api/qlab/configs`, {
    method: "POST",
    headers: { cookie: session.cookie, "content-type": "application/json" },
    body: JSON.stringify({ name: configName, type: "internal" }),
  });
  assertEquals(cfgRes.status, 200, "create config must succeed");
  await cfgRes.json();

  // Now bind via the modal's set route.
  const setRes = await fetch(`${BASE}/api/admin/modal/qlab/set`, {
    method: "POST",
    headers: { cookie: session.cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ type: "internal", key: destKey, configName }),
    redirect: "manual",
  });
  assertEquals(setRes.status, 200);
  const setHtml = await setRes.text();
  assertStringIncludes(setHtml, destKey, "modal should re-render with the new binding visible");
  assertStringIncludes(setHtml, configName);

  // Backend assignments should reflect the binding.
  const listRes = await fetch(`${BASE}/api/qlab-assignments`, { headers: { cookie: session.cookie } });
  const list = await listRes.json() as { internal?: Record<string, string> };
  assertEquals(list.internal?.[destKey], configName, "backend should persist the binding");

  // Unbind via clear route and verify removal.
  const clearRes = await fetch(`${BASE}/api/admin/modal/qlab/clear?type=internal&key=${encodeURIComponent(destKey)}`, {
    method: "POST",
    headers: { cookie: session.cookie },
    redirect: "manual",
  });
  assertEquals(clearRes.status, 200);
  await clearRes.text();
  const after = await (await fetch(`${BASE}/api/qlab-assignments`, { headers: { cookie: session.cookie } })).json() as { internal?: Record<string, string> };
  assertEquals(after.internal?.[destKey], undefined, "binding should be removed");
}});

Deno.test({
  name: "E2E QLab cleanup — stop server",
  fn() { stopServer(); },
  sanitizeResources: false,
  sanitizeOps: false,
});
