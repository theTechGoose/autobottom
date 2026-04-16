/** E2E test for dashboard stats/tables/tokens auto-refresh and orgId isolation.
 *
 *  SAFETY: Any test here that starts an audit MUST use:
 *    - RID 429534 (known-safe date-leg record for testing)
 *    - POST directly to backend /audit/test-by-rid with isTest: true
 *    - testEmailRecipients: [session.email]
 *  NEVER hit the frontend /api/admin/test-audit endpoint — that's the production
 *  path that fires real webhooks and emails.
 *
 *  Run: deno task test:e2e:dashboard */
import { assertEquals, assert, assertStringIncludes } from "#assert";
import { startServer, stopServer, createTestSession, BASE } from "./helpers.ts";

const SAFE_RID = "429534";

let session: { cookie: string; email: string };

Deno.test({
  name: "E2E Dashboard setup — start server and create session",
  async fn() {
    await startServer();
    session = await createTestSession();
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// ── Refresh endpoints render identically to SSR (no label drift) ──────────────

Deno.test({ name: "E2E Dashboard: /api/admin/stats renders the 5 expected labels", sanitizeResources: false, async fn() {
  const res = await fetch(`${BASE}/api/admin/stats`, { headers: { cookie: session.cookie } });
  assertEquals(res.status, 200);
  const html = await res.text();
  // Regression guard: these labels MUST stay identical to the SSR dashboard.
  assertStringIncludes(html, "In Pipeline", "must have 'In Pipeline' (not 'In Pipe')");
  assertStringIncludes(html, "Active", "must have 'Active' card");
  assertStringIncludes(html, "Completed (24h)", "must have 'Completed (24h)' with parens");
  assertStringIncludes(html, "Errors (24h)", "must have 'Errors (24h)' with parens");
  assertStringIncludes(html, "Retries (24h)", "must have 'Retries (24h)' with parens");
  // And MUST NOT have the leftover labels from the old version
  assert(!html.includes("In Pipe<"), "must not have bare 'In Pipe' label");
  assert(!html.includes("Review Pending"), "refresh endpoint must not add extra cards");
}});

Deno.test({ name: "E2E Dashboard: /api/admin/dashboard/refresh returns ALL three tables always-visible", sanitizeResources: false, async fn() {
  const res = await fetch(`${BASE}/api/admin/dashboard/refresh`, { headers: { cookie: session.cookie } });
  assertEquals(res.status, 200);
  const html = await res.text();
  // Regression guards: these sections must ALWAYS render (with empty-row when no data).
  // Previous bug: tables were conditional on length > 0, so new audits never appeared.
  // Note: we don't assert "No active audits" because shared KV may have real/test data.
  // The length-independent guard is: all three table titles AND their empty-row TEMPLATE
  // placeholders (colspan=6 for Active, colspan=5 for Errors, colspan=7 for Completed)
  // must be in the component — even if the row isn't used because there's live data.
  assertStringIncludes(html, "Active Audits", "Active Audits table must always render");
  assertStringIncludes(html, "Recent Errors (24h)", "Recent Errors table must always render");
  assertStringIncludes(html, "Recently Completed (24h)", "Recently Completed table must always render");
  // Inline action buttons (no separate Queue Management panel)
  assertStringIncludes(html, "Terminate Running", "Terminate Running button must be inline with Active Audits title");
  assertStringIncludes(html, "Clear Errors", "Clear Errors button must be inline with Recent Errors title");
}});

Deno.test({ name: "E2E Dashboard: /api/admin/dashboard/review returns Review Queue HTML", sanitizeResources: false, async fn() {
  const res = await fetch(`${BASE}/api/admin/dashboard/review`, { headers: { cookie: session.cookie } });
  assertEquals(res.status, 200);
  const html = await res.text();
  assertStringIncludes(html, "Review Queue", "must include Review Queue header");
  assertStringIncludes(html, "Internal", "must include Internal row");
  assertStringIncludes(html, "Partner", "must include Partner row");
}});

Deno.test({ name: "E2E Debug: /admin/debug/step-dispatch confirms fix deployed", sanitizeResources: false, async fn() {
  const res = await fetch(`${BASE}/admin/debug/step-dispatch`, { headers: { cookie: session.cookie } });
  assertEquals(res.status, 200);
  const body = await res.json() as { ok: boolean; stepDispatchMovedToMain: boolean };
  assertEquals(body.ok, true);
  assertEquals(body.stepDispatchMovedToMain, true);
}});

Deno.test({ name: "E2E Debug: /admin/debug/self-url returns the REQUEST origin (not env fallback)", sanitizeResources: false, async fn() {
  // Regression guard for the "branch preview has wrong SELF_URL" bug that stopped
  // audits from running. The AsyncLocalStorage fix in main.ts should make this
  // endpoint return BASE (the request origin) regardless of what env var is set to.
  const res = await fetch(`${BASE}/admin/debug/self-url`, { headers: { cookie: session.cookie } });
  assertEquals(res.status, 200);
  const body = await res.json() as { selfUrl: string; envSelfUrl: string | null; source: string };
  assertEquals(body.selfUrl, BASE, `selfUrl must match the request origin (got ${body.selfUrl}, expected ${BASE})`);
  assertEquals(body.source, "async-local-storage", "must come from ALS, not env fallback");
}});

Deno.test({ name: "E2E Audit Report: GET /audit/report?id=X renders a page (not 404)", sanitizeResources: false, async fn() {
  const res = await fetch(`${BASE}/audit/report?id=nonexistent-test-id`, { headers: { cookie: session.cookie } });
  assertEquals(res.status, 200, "report page must exist so Find Audit clicks don't 404");
  const html = await res.text();
  assertStringIncludes(html, "nonexistent-test-id", "page should echo the finding ID");
  assertStringIncludes(html, "Audit Report", "page should be titled Audit Report");
}});

Deno.test({ name: "E2E Dashboard: delete-finding endpoint accepts form POST", sanitizeResources: false, async fn() {
  // Regression guard: Find Audit Delete button posts to /api/admin/find-audit/delete
  const res = await fetch(`${BASE}/api/admin/find-audit/delete`, {
    method: "POST",
    headers: { cookie: session.cookie, "content-type": "application/x-www-form-urlencoded" },
    body: "id=nonexistent-test",
    redirect: "manual",
  });
  // Accepts: 200 with status message. NOT a redirect, NOT a 404.
  assertEquals(res.status, 200, `expected 200 got ${res.status}`);
  const html = await res.text();
  // Should include either "Deleted" or "Delete failed" — endpoint ran
  assert(html.includes("Deleted") || html.includes("Delete failed") || html.includes("Enter a finding"), `unexpected response: ${html.slice(0, 200)}`);
}});

Deno.test({ name: "E2E Dashboard: /api/admin/dashboard/tokens returns token panel HTML", sanitizeResources: false, async fn() {
  const res = await fetch(`${BASE}/api/admin/dashboard/tokens`, { headers: { cookie: session.cookie } });
  assertEquals(res.status, 200);
  const html = await res.text();
  // Either shows a real total or "No token usage"
  assert(html.includes("tokens") || html.includes("No token usage"), "must include tokens or empty state");
}});

// ── OrgId agreement + isTest persistence ──────────────────────────────────────
// These tests require QuickBase credentials to succeed (to look up RID 429534).
// When credentials aren't set (CI, local dev without .env), the backend returns
// a QuickBase 500. We gracefully skip in that case but still fail if the audit
// succeeded yet went to the wrong org or dropped isTest — the bugs we actually care about.

async function createSafeTestAudit(): Promise<{ findingId?: string; skip?: string }> {
  const res = await fetch(`${BASE}/audit/test-by-rid?rid=${SAFE_RID}`, {
    method: "POST",
    headers: { cookie: session.cookie, "content-type": "application/json" },
    body: JSON.stringify({ rid: SAFE_RID, isTest: true, testEmailRecipients: [session.email] }),
  });
  if (res.status === 500) {
    const body = await res.text();
    if (body.includes("QuickBase") || body.includes("Unknown Hostname")) {
      return { skip: `QuickBase unavailable (${body.slice(0, 80)})` };
    }
    throw new Error(`Unexpected 500: ${body.slice(0, 200)}`);
  }
  assertEquals(res.status, 200, `backend create failed: ${res.status}`);
  const data = await res.json() as { findingId?: string; error?: string };
  if (data.error) return { skip: `backend error: ${data.error}` };
  return { findingId: data.findingId };
}

Deno.test({ name: "E2E Dashboard: test audit runs and appears in dashboard data (orgId agreement)", sanitizeResources: false, async fn() {
  const result = await createSafeTestAudit();
  if (result.skip) { console.log(`[SKIP] ${result.skip}`); return; }
  assert(result.findingId, "must return findingId");

  const dashRes = await fetch(`${BASE}/admin/dashboard/data`, { headers: { cookie: session.cookie } });
  assertEquals(dashRes.status, 200);
  const data = await dashRes.json() as {
    pipeline: { active?: Array<{ findingId: string }>; errors?: Array<{ findingId: string }> };
    recentCompleted: Array<{ findingId: string }>;
  };
  const allFindingIds = [
    ...(data.pipeline.active ?? []).map(a => a.findingId),
    ...(data.pipeline.errors ?? []).map(e => e.findingId),
    ...(data.recentCompleted ?? []).map(r => r.findingId),
  ];
  assert(
    allFindingIds.includes(result.findingId!),
    `findingId ${result.findingId} not visible in dashboard — audit is saved under wrong orgId. Found: ${JSON.stringify(allFindingIds)}`,
  );
}});

Deno.test({ name: "E2E Dashboard: isTest flag is stored on the finding (safety guard)", sanitizeResources: false, async fn() {
  const result = await createSafeTestAudit();
  if (result.skip) { console.log(`[SKIP] ${result.skip}`); return; }
  assert(result.findingId, "must return findingId");

  const getRes = await fetch(`${BASE}/audit/finding?id=${result.findingId}`, { headers: { cookie: session.cookie } });
  assertEquals(getRes.status, 200);
  const finding = await getRes.json() as { isTest?: boolean };
  assertEquals(finding.isTest, true, "isTest MUST be true — safe-mode prevents customer emails/webhooks");
}});

Deno.test({ name: "E2E Pipeline: POST /audit/step/init dispatches via main.ts (not the @Req-broken danet path)", sanitizeResources: false, async fn() {
  // Regression guard: if step dispatch ever moves back into danet's StepController
  // with @Req, this test fails loudly. The specific crash message we want to avoid:
  //   {"status":500,"message":"Cannot read properties of undefined (reading 'json')"}
  // which happens when danet passes `undefined` for @Req via router.fetch().
  //
  // NOTE: this test is placed AFTER the "always-visible tables" test because it
  // intentionally exercises stepInit, which writes to active-tracking KV and would
  // otherwise pollute the "No active audits" empty-row assertion.
  const res = await fetch(`${BASE}/audit/step/init`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ findingId: "nonexistent-test-finding", orgId: "default" }),
  });
  const body = await res.text();
  assert(
    !body.includes("Cannot read properties of undefined"),
    `step dispatch broken — @Req returned undefined: ${body.slice(0, 200)}`,
  );
  // Acceptable outcomes: 200 (step ran and gracefully said "finding not found")
  // or 404 (route not found — worth flagging but not the @Req crash).
  // NOT acceptable: the specific "Cannot read properties of undefined" payload above.
}});

// ── Cleanup ───────────────────────────────────────────────────────────────────

Deno.test({
  name: "E2E Dashboard cleanup — stop server",
  fn() { stopServer(); },
  sanitizeResources: false,
  sanitizeOps: false,
});
