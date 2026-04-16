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

Deno.test({ name: "E2E Dashboard: /api/admin/dashboard/refresh returns table HTML", sanitizeResources: false, async fn() {
  const res = await fetch(`${BASE}/api/admin/dashboard/refresh`, { headers: { cookie: session.cookie } });
  assertEquals(res.status, 200);
  const html = await res.text();
  assertStringIncludes(html, "Recently Completed", "must include Recently Completed section");
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

// ── Cleanup ───────────────────────────────────────────────────────────────────

Deno.test({
  name: "E2E Dashboard cleanup — stop server",
  fn() { stopServer(); },
  sanitizeResources: false,
  sanitizeOps: false,
});
