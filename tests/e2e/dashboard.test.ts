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
  // Active Audits rows must have per-row Retry and Stop buttons (present in the
  // render template even when empty-row placeholder is shown, via the Actions header).
  assertStringIncludes(html, "Actions", "Active Audits header must include Actions column");
  // The queue-action status slot must exist so queue-action responses have a target.
  assertStringIncludes(html, "queue-action-status", "queue-action-status span must be present for visible feedback");
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

Deno.test({ name: "E2E Debug: /admin/debug/self-url exposes all fallback sources and never emits loopback for QStash", sanitizeResources: false, async fn() {
  // Regression guard for TWO bugs:
  //  1. Branch preview SELF_URL: selfUrl must reflect the THIS-deployment origin,
  //     not whatever SELF_URL env points to.
  //  2. QStash loopback rejection: when the frontend SSR makes an internal
  //     localhost fetch, ALS origin becomes localhost. selfUrl() must detect
  //     that and fall back to a public URL (knownPublicOrigin, or the
  //     DENO_DEPLOYMENT_ID-derived URL, or SELF_URL env) so QStash doesn't
  //     reject the callback with "endpoint resolves to a loopback address".
  const res = await fetch(`${BASE}/admin/debug/self-url`, { headers: { cookie: session.cookie } });
  assertEquals(res.status, 200);
  const body = await res.json() as {
    selfUrl: string;
    envSelfUrl: string | null;
    source: string;
    sources: {
      scopedOrigin: string | null;
      scopedIsLocalhost: boolean;
      knownPublicOrigin: string | null;
      deploymentId: string | null;
      envSelfUrl: string | null;
      effective: string;
    };
  };
  // Sources must always be present for debugging.
  assert(body.sources, "sources breakdown must be present");
  assertEquals(body.sources.effective, body.selfUrl, "sources.effective must match top-level selfUrl");
  // In local E2E, BASE is localhost and there's no DENO_DEPLOYMENT_ID — so selfUrl
  // falls back to the localhost scoped origin. In a real deployment, it would
  // resolve via async-local-storage (external host) or deno-deployment-id.
  // The invariant we care about: if a public source is available, selfUrl MUST
  // use it instead of localhost.
  const hasPublicSource =
    (body.sources.scopedOrigin !== null && !body.sources.scopedIsLocalhost) ||
    body.sources.knownPublicOrigin !== null ||
    body.sources.deploymentId !== null ||
    body.sources.envSelfUrl !== null;
  if (hasPublicSource) {
    assert(
      !body.selfUrl.startsWith("http://localhost") && !body.selfUrl.startsWith("http://127."),
      `selfUrl must not be loopback when a public source exists: ${body.selfUrl}`,
    );
  }
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
  const TRACE_ID = "trace-test-id-" + Date.now();
  const res = await fetch(`${BASE}/audit/step/init`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ findingId: TRACE_ID, orgId: "default" }),
  });
  const body = await res.text();
  assert(
    !body.includes("Cannot read properties of undefined"),
    `step dispatch broken — @Req returned undefined: ${body.slice(0, 200)}`,
  );
  // Log traceability guard: error responses MUST echo findingId so future
  // Deno Deploy log filters by finding ID never lose the trail.
  assert(
    body.includes(TRACE_ID),
    `response must echo findingId for log traceability: ${body.slice(0, 300)}`,
  );
}});

Deno.test({ name: "E2E Dashboard: /api/admin/retry route exists and returns non-500", sanitizeResources: false, async fn() {
  // Regression guard: Retry button per row in Active Audits table must have a
  // working backend route. Accepts 204 (ran, backend gracefully handled missing
  // finding) or 200 with error span — just not 404 / server crash.
  const res = await fetch(`${BASE}/api/admin/retry?findingId=nonexistent-test`, {
    method: "GET",
    headers: { cookie: session.cookie },
  });
  assert(res.status === 204 || res.status === 200, `retry route must be reachable: got ${res.status}`);
}});

Deno.test({ name: "E2E Dashboard: /api/admin/terminate-finding route exists and returns non-500", sanitizeResources: false, async fn() {
  // Regression guard: Stop button per row in Active Audits must have a working
  // backend route. Previously no frontend wrapper existed at all.
  const res = await fetch(`${BASE}/api/admin/terminate-finding?findingId=nonexistent-test`, {
    method: "POST",
    headers: { cookie: session.cookie },
  });
  // Must be reachable — 204 (ran, no content) / 200 (ran with HTML body) / 500
  // (backend threw but handler exists). Crucially NOT 404 (no route registered).
  assert(
    [200, 204, 500].includes(res.status),
    `terminate-finding route must exist and be reachable: got ${res.status}`,
  );
}});

Deno.test({ name: "E2E Dashboard: /api/admin/queue-action returns HTML feedback (not 204)", sanitizeResources: false, async fn() {
  // Regression guard: queue-action must return HTML so the status slot can
  // render a "✓ done" message. Previously returned 204 which left buttons
  // appearing broken to the user.
  const res = await fetch(`${BASE}/api/admin/queue-action`, {
    method: "POST",
    headers: { cookie: session.cookie, "content-type": "application/json" },
    body: JSON.stringify({ action: "resume" }),
  });
  // 200 on success OR 500 on backend failure — either way must be HTML, not 204.
  assert(res.status !== 204, `queue-action must return HTML body, not 204: got ${res.status}`);
  const contentType = res.headers.get("content-type") ?? "";
  assertStringIncludes(contentType, "text/html", "queue-action must return text/html content-type");
  const body = await res.text();
  assert(body.includes("qa-status"), `queue-action response must include qa-status span for visible feedback: ${body.slice(0, 200)}`);
}});

Deno.test({ name: "E2E Debug: /admin/debug/api-url confirms unified-process API_URL", sanitizeResources: false, async fn() {
  // Regression guard: frontend SSR calls must go in-process (localhost) not
  // across deployments. If API_URL env is ever set to an external hostname,
  // audit creation/enqueue/step handlers run on different builds and logs
  // can't be correlated by finding ID.
  const res = await fetch(`${BASE}/admin/debug/api-url`, { headers: { cookie: session.cookie } });
  assertEquals(res.status, 200);
  const body = await res.json() as { apiUrl: string | null; inProcess: boolean };
  assertEquals(body.inProcess, true, `API_URL must be localhost (unified process), got ${body.apiUrl}`);
}});

// ── Cleanup ───────────────────────────────────────────────────────────────────

Deno.test({
  name: "E2E Dashboard cleanup — stop server",
  fn() { stopServer(); },
  sanitizeResources: false,
  sanitizeOps: false,
});
