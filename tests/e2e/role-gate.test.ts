/** E2E test for the admin-path role gate.
 *
 *  Regression guard for the bug where a manager-role user could load
 *  /admin/dashboard because frontend middleware only gated /super-admin/*.
 *  Run: deno test --allow-all tests/e2e/role-gate.test.ts */
import { assertEquals, assert } from "#assert";
import { startServer, stopServer, BASE } from "./helpers.ts";

let adminSession: { cookie: string; email: string };
let managerSession: { cookie: string; email: string };

/** Login an existing email/password and return the session cookie. */
async function login(email: string, password: string): Promise<{ cookie: string; email: string }> {
  const loginRes = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`,
    redirect: "manual",
  });
  const loginCookie = loginRes.headers.get("set-cookie") ?? "";
  const sessionMatch = loginCookie.match(/session=([^;]+)/);
  if (!sessionMatch) {
    const body = await loginRes.text().catch(() => "");
    throw new Error(`Login failed for ${email}: status=${loginRes.status}, body=${body.slice(0, 200)}`);
  }
  return { cookie: `session=${sessionMatch[1]}`, email };
}

/** Register an admin in a specific orgId by hitting the backend /register
 *  endpoint directly (the frontend /api/register doesn't expose orgId). */
async function registerAdminInOrg(orgId: string): Promise<{ cookie: string; email: string }> {
  const ts = Date.now() + Math.floor(Math.random() * 10000);
  const email = `e2e-admin-${ts}@test.local`;
  const password = "e2e-admin-pass";
  const res = await fetch(`${BASE}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, orgId }),
  });
  assertEquals(res.status, 200, `backend /register failed: ${res.status}`);
  const data = await res.json() as { ok?: boolean; cookie?: string; error?: string };
  if (!data.ok) throw new Error(`/register error: ${data.error}`);
  // Login to get a fresh cookie (the response cookie includes Set-Cookie attrs we'd
  // have to parse; just login again — same outcome).
  return login(email, password);
}

/** Create a manager-role user in the default org via the admin /admin/users
 *  endpoint, then log them in. The admin session and the manager must share
 *  an orgId for the impersonation test to work — see registerAdminInOrg above
 *  which forces the admin into the same org `defaultOrgId()` returns. */
async function createManagerSession(adminCookie: string): Promise<{ cookie: string; email: string }> {
  const ts = Date.now() + Math.floor(Math.random() * 10000);
  const email = `e2e-mgr-${ts}@test.local`;
  const password = "e2e-mgr-pass";

  const addRes = await fetch(`${BASE}/admin/users`, {
    method: "POST",
    headers: {
      cookie: adminCookie,
      "content-type": "application/json",
      "accept": "application/json",
    },
    body: JSON.stringify({ email, password, role: "manager" }),
  });
  const addBody = await addRes.text();
  assertEquals(addRes.status, 200, `admin/users add failed: ${addRes.status} body=${addBody.slice(0, 200)}`);
  return login(email, password);
}

const DEFAULT_ORG_ID = Deno.env.get("CHARGEBACKS_ORG_ID") ?? Deno.env.get("DEFAULT_ORG_ID") ?? "default";

Deno.test({
  name: "E2E Role-gate setup — start server and create admin + manager sessions",
  async fn() {
    await startServer();
    // Both admin and manager land in the same default org so impersonation
    // (which uses listUsers(adminOrgId)) can find the manager.
    adminSession = await registerAdminInOrg(DEFAULT_ORG_ID);
    managerSession = await createManagerSession(adminSession.cookie);
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({ name: "E2E Role-gate: unauthenticated GET /admin/dashboard → 302 to /login", sanitizeResources: false, async fn() {
  const res = await fetch(`${BASE}/admin/dashboard`, { redirect: "manual" });
  await res.body?.cancel();
  assertEquals(res.status, 302, `expected redirect, got ${res.status}`);
  const loc = res.headers.get("location") ?? "";
  assert(loc.startsWith("/login"), `expected /login redirect, got ${loc}`);
}});

Deno.test({ name: "E2E Role-gate: manager session GET /admin/dashboard → 302 to manager dashboard", sanitizeResources: false, async fn() {
  const res = await fetch(`${BASE}/admin/dashboard`, {
    headers: { cookie: managerSession.cookie },
    redirect: "manual",
  });
  await res.body?.cancel();
  assertEquals(res.status, 302, `manager must be redirected away from /admin/dashboard, got ${res.status}`);
  const loc = res.headers.get("location") ?? "";
  assertEquals(loc, "/manager", `manager should be redirected to /manager, got ${loc}`);
}});

Deno.test({ name: "E2E Role-gate: admin session GET /admin/dashboard → 200", sanitizeResources: false, async fn() {
  const res = await fetch(`${BASE}/admin/dashboard`, {
    headers: { cookie: adminSession.cookie },
    redirect: "manual",
  });
  const html = await res.text();
  assertEquals(res.status, 200, `admin must be allowed: status=${res.status} body=${html.slice(0, 200)}`);
}});

Deno.test({ name: "E2E Role-gate: admin impersonating a manager keeps access to /admin/dashboard", sanitizeResources: false, async fn() {
  // The impersonation block in middleware swaps ctx.state.user to the target
  // (manager) but stashes the real admin email in ctx.state.impersonatedBy.
  // The role gate must use that real role, not the swapped one, so admins
  // can still navigate to admin tools while in impersonation mode.
  const url = `${BASE}/admin/dashboard?as=${encodeURIComponent(managerSession.email)}`;
  const res = await fetch(url, {
    headers: { cookie: adminSession.cookie },
    redirect: "manual",
  });
  const html = await res.text();
  assertEquals(res.status, 200, `admin impersonating a manager must keep admin access: status=${res.status} body=${html.slice(0, 200)}`);
}});

Deno.test({ name: "E2E Role-gate: manager session GET /api/admin/* → 302 (api gate matches admin gate)", sanitizeResources: false, async fn() {
  const res = await fetch(`${BASE}/api/admin/stats`, {
    headers: { cookie: managerSession.cookie },
    redirect: "manual",
  });
  await res.body?.cancel();
  assertEquals(res.status, 302, `manager must be blocked from /api/admin/*, got ${res.status}`);
}});

Deno.test({
  name: "E2E Role-gate cleanup — stop server",
  fn() { stopServer(); },
  sanitizeResources: false,
  sanitizeOps: false,
});
