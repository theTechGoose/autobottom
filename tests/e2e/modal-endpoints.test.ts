/** E2E test for the admin modal HTMX endpoints.
 *  Guards against the response-shape, endpoint-path, and redirect bugs fixed in 55cf2de.
 *  Run with: deno task test:e2e (or directly via deno test) */
import { assertEquals, assert, assertStringIncludes } from "#assert";
import { startServer, stopServer, createTestSession, BASE } from "./helpers.ts";

let session: { cookie: string; email: string };

// ── Setup/teardown ────────────────────────────────────────────────────────────

Deno.test({
  name: "E2E Modal setup — start server and create session",
  async fn() {
    await startServer();
    session = await createTestSession();
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// ── Backend shape contracts (guard against frontend misreading responses) ─────

Deno.test({ name: "E2E Modal: backend GET /admin/email-templates returns { templates: [...] } shape", sanitizeResources: false, async fn() {
  const res = await fetch(`${BASE}/admin/email-templates`, { headers: { cookie: session.cookie } });
  assertEquals(res.status, 200);
  const data = await res.json();
  // Frontend (email-templates.tsx) must handle BOTH shapes but this asserts the real backend shape
  assert("templates" in data, "backend returns { templates: [] }, not a bare array");
  assert(Array.isArray(data.templates), "templates must be an array");
}});

Deno.test({ name: "E2E Modal: backend POST /admin/email-templates returns { ok, template: {id} } shape", sanitizeResources: false, async fn() {
  const res = await fetch(`${BASE}/admin/email-templates`, {
    method: "POST",
    headers: { cookie: session.cookie, "content-type": "application/json" },
    body: JSON.stringify({ name: `Shape-Test-${Date.now()}`, subject: "s", html: "<p>x</p>" }),
  });
  assertEquals(res.status, 200);
  const data = await res.json();
  assertEquals(data.ok, true);
  assert("template" in data, "backend returns { ok, template }, frontend must read result.template.id");
  assert(typeof data.template?.id === "string" && data.template.id.length > 0, "template.id must be present");
}});

Deno.test({ name: "E2E Modal: backend GET /admin/manager-scopes returns Record<email, scope>", sanitizeResources: false, async fn() {
  const res = await fetch(`${BASE}/admin/manager-scopes`, { headers: { cookie: session.cookie } });
  assertEquals(res.status, 200, "GET /admin/manager-scopes must exist (not path-param style)");
  const data = await res.json();
  assert(typeof data === "object" && !Array.isArray(data), "should return Record<email, scope>");
}});

Deno.test({ name: "E2E Modal: backend POST /admin/manager-scopes accepts { email, scope } body", sanitizeResources: false, async fn() {
  const testEmail = `manager-${Date.now()}@test.local`;
  const res = await fetch(`${BASE}/admin/manager-scopes`, {
    method: "POST",
    headers: { cookie: session.cookie, "content-type": "application/json" },
    body: JSON.stringify({ email: testEmail, scope: { departments: ["TEST-DEPT"], shifts: [] } }),
  });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.ok, true);

  const listRes = await fetch(`${BASE}/admin/manager-scopes`, { headers: { cookie: session.cookie } });
  const list = await listRes.json() as Record<string, { departments: string[] }>;
  assertEquals(list[testEmail]?.departments, ["TEST-DEPT"], "scope should persist under email key");
}});

Deno.test({ name: "E2E Modal: backend POST /admin/audit-dimensions accepts full body (no /add subroute)", sanitizeResources: false, async fn() {
  const res = await fetch(`${BASE}/admin/audit-dimensions`, {
    method: "POST",
    headers: { cookie: session.cookie, "content-type": "application/json" },
    body: JSON.stringify({ departments: ["E2E-DEPT-1", "E2E-DEPT-2"], shifts: ["E2E-SHIFT"] }),
  });
  assertEquals(res.status, 200);

  const getRes = await fetch(`${BASE}/admin/audit-dimensions`, { headers: { cookie: session.cookie } });
  const data = await getRes.json();
  assertEquals(data.departments, ["E2E-DEPT-1", "E2E-DEPT-2"]);
  assertEquals(data.shifts, ["E2E-SHIFT"]);

  // There is NO /add or /remove subroute — calling one should 404
  const add404 = await fetch(`${BASE}/admin/audit-dimensions/add`, {
    method: "POST",
    headers: { cookie: session.cookie, "content-type": "application/json" },
    body: JSON.stringify({ department: "foo" }),
  });
  assert(add404.status >= 400, `/admin/audit-dimensions/add must NOT exist — got ${add404.status}`);
  await add404.body?.cancel();
}});

// ── Frontend modal endpoints: auth and no-redirect ────────────────────────────

Deno.test({ name: "E2E Modal: frontend /api/admin/modal/email-templates renders with valid session", sanitizeResources: false, async fn() {
  const res = await fetch(`${BASE}/api/admin/modal/email-templates`, {
    headers: { cookie: session.cookie },
    redirect: "manual",
  });
  // Must NOT be redirected to /login — the session cookie is valid for backend, must also work for frontend
  assertEquals(res.status, 200, `expected 200, got ${res.status} ${res.headers.get("location") ?? ""}`);
  const html = await res.text();
  assertEquals(res.headers.get("content-type"), "text/html");
  assertStringIncludes(html, "Email Templates", "should render the email templates modal");
}});

Deno.test({ name: "E2E Modal: save email template via frontend endpoint — 200 HTML, no 303", sanitizeResources: false, async fn() {
  const name = `Test Template ${Date.now()}`;
  const saveRes = await fetch(`${BASE}/api/admin/modal/email-templates/save`, {
    method: "POST",
    headers: { cookie: session.cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ name, subject: "s", html: "<p>x</p>" }),
    redirect: "manual",
  });
  assertEquals(saveRes.status, 200, "save must return 200 OK (not a redirect)");
  const saveHtml = await saveRes.text();
  assertEquals(saveRes.headers.get("content-type"), "text/html");
  assertStringIncludes(saveHtml, name, "saved template name should appear in returned HTML");
}});

Deno.test({ name: "E2E Modal: saving template with existing id UPDATES (no duplicate row)", sanitizeResources: false, async fn() {
  const uniqueName = `Update-Test-${Date.now()}`;

  // 1. Create a new template (no id)
  const createRes = await fetch(`${BASE}/admin/email-templates`, {
    method: "POST",
    headers: { cookie: session.cookie, "content-type": "application/json" },
    body: JSON.stringify({ name: uniqueName, subject: "v1", html: "<p>v1</p>" }),
  });
  const created = await createRes.json();
  const id = created.template.id;
  assert(id, "new template must have id");

  // 2. Save again WITH id (simulating edit → save via the frontend's hidden id field)
  const updateRes = await fetch(`${BASE}/api/admin/modal/email-templates/save`, {
    method: "POST",
    headers: { cookie: session.cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id, name: uniqueName, subject: "v2", html: "<p>v2</p>" }),
    redirect: "manual",
  });
  assertEquals(updateRes.status, 200);
  await updateRes.text();

  // 3. Verify the backend has exactly ONE row with this name — no duplicate
  const listRes = await fetch(`${BASE}/admin/email-templates`, { headers: { cookie: session.cookie } });
  const list = await listRes.json() as { templates: Array<{ id: string; name: string; subject: string }> };
  const matches = list.templates.filter(t => t.name === uniqueName);
  assertEquals(matches.length, 1, `expected 1 template named ${uniqueName}, got ${matches.length}`);
  assertEquals(matches[0].id, id, "same id preserved");
  assertEquals(matches[0].subject, "v2", "subject must be updated to v2");
}});

Deno.test({ name: "E2E Modal: offices/add-dept via frontend — 200 HTML with chip, persists to backend", sanitizeResources: false, async fn() {
  const dept = `FRONTEND-DEPT-${Date.now()}`;
  const res = await fetch(`${BASE}/api/admin/modal/offices/add-dept`, {
    method: "POST",
    headers: { cookie: session.cookie, "content-type": "application/x-www-form-urlencoded" },
    body: `dept=${encodeURIComponent(dept)}`,
    redirect: "manual",
  });
  assertEquals(res.status, 200);
  const html = await res.text();
  assertStringIncludes(html, dept, "newly added dept should appear in returned chip list");

  const getRes = await fetch(`${BASE}/admin/audit-dimensions`, { headers: { cookie: session.cookie } });
  const data = await getRes.json();
  assert((data.departments ?? []).includes(dept), "backend should have the dept");
}});

Deno.test({ name: "E2E Dashboard: /api/admin/test-audit receives test-rid field (inputs have name=)", sanitizeResources: false, async fn() {
  // Regression guard: if the dashboard <input> tags lose their name= attribute,
  // HTMX won't include the value in the form submission and this endpoint will
  // return "Enter a record ID" even when a value is typed.
  const res = await fetch(`${BASE}/api/admin/test-audit`, {
    method: "POST",
    headers: { cookie: session.cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ "test-rid": "999999", "test-type": "internal" }),
    redirect: "manual",
  });
  assertEquals(res.status, 200);
  const html = await res.text();
  // Must NOT say "Enter a record ID" — the rid was provided. May be a backend error
  // (record not found) which is fine; we only guard against the missing-field case.
  assert(!html.includes("Enter a record ID"), `got: ${html.slice(0, 200)}`);
}});

Deno.test({ name: "E2E Dashboard: /api/admin/find-audit receives find-finding-id field (input has name=)", sanitizeResources: false, async fn() {
  // Regression guard for find-finding-id input. HTMX hx-include uses the `name`
  // attribute as the query/body key; if name= is dropped, the endpoint sees no id.
  const res = await fetch(`${BASE}/api/admin/find-audit?find-finding-id=nonexistent`, {
    method: "GET",
    headers: { cookie: session.cookie },
    redirect: "manual",
  });
  assertEquals(res.status, 200);
  const html = await res.text();
  assert(!html.includes("Enter a finding ID"), `expected lookup to run (not blank-check); got: ${html.slice(0, 200)}`);
}});

// ── Cleanup ───────────────────────────────────────────────────────────────────

Deno.test({
  name: "E2E Modal cleanup — stop server",
  fn() { stopServer(); },
  sanitizeResources: false,
  sanitizeOps: false,
});
