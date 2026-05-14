/** Audit report page — GET /audit/report?id=X. Uses <AuditReport> component.
 *  Ported from production's handleGetReport (main:controller.ts, ~1467 lines of inline HTML).
 *  Our version is ~200 lines of Preact + ~60 lines of CSS, reusing existing classes. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { apiFetch } from "../../lib/api.ts";
import { AuditReport } from "../../components/AuditReport.tsx";
import { authenticate } from "@core/business/auth/mod.ts";

export default define.page(async function AuditReportPage(ctx) {
  const url = new URL(ctx.req.url);
  // Trim — browsers URL-encode leading whitespace as `+`, so "copy/paste from
  // success message with a space" becomes ` LhW-...` which never matches.
  const id = (url.searchParams.get("id") ?? "").trim();
  // Inline opportunistic auth (NOT in middleware). The /audit/report path
  // is public so customers can view appeal reports anonymously, but if an
  // admin happens to be logged in we want to render the per-question flip
  // button. Putting this in the middleware made EVERY public-path hit
  // (including /login itself) compete for the auth-lane Firestore slot,
  // which broke login under concurrency. Doing it here scopes the auth
  // lookup to only this one page.
  let user = ctx.state.user;
  if (!user) {
    try {
      const auth = await authenticate(ctx.req);
      if (auth?.email && auth?.role) {
        user = {
          email: auth.email,
          orgId: auth.orgId,
          role: auth.role as "admin" | "judge" | "manager" | "reviewer" | "user",
        };
      }
    } catch { /* anonymous is fine */ }
  }
  console.log(`[AUDIT-REPORT] auth resolved: user=${user?.email ?? "anon"} role=${user?.role ?? "none"} isAdmin=${user?.role === "admin"}`);

  if (!id) {
    return (
      <Layout title="Audit Report" section="admin" user={user} hideSidebar>
        <div style="padding:60px;text-align:center;color:var(--text-dim);">
          <h1 style="font-size:18px;color:var(--text-bright);margin-bottom:12px;">Missing finding ID</h1>
          <p>Open with <code>/audit/report?id=&lt;findingId&gt;</code></p>
          <p style="margin-top:16px;"><a href="/admin/dashboard" class="tbl-link">&larr; Dashboard</a></p>
        </div>
      </Layout>
    );
  }

  // deno-lint-ignore no-explicit-any
  let finding: any = null;
  let errorMsg: string | null = null;
  // Distinguishes "transient FS abort, user can retry" from "not found".
  // Backend sets retry:true on the response when getFinding aborted on the
  // chunked-read path; we render a retry button instead of a hard error.
  let canRetry = false;
  try {
    const data = await apiFetch<Record<string, unknown>>(`/audit/finding?id=${encodeURIComponent(id)}`, ctx.req);
    if (data && (data as { error?: string }).error) {
      errorMsg = (data as { error: string }).error;
      canRetry = (data as { retry?: boolean }).retry === true;
    } else {
      finding = data;
    }
  } catch (e) {
    errorMsg = (e as Error).message;
  }

  if (errorMsg || !finding) {
    return (
      <Layout title={`Report ${id}`} section="admin" user={user} hideSidebar>
        <div style="max-width:720px;margin:60px auto;padding:0 24px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
            <div>
              <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1.5px;font-weight:700;">Audit Report</div>
              <h1 style="font-size:18px;color:var(--text-bright);font-family:var(--mono);margin-top:2px;">{id}</h1>
            </div>
            <a href="/admin/dashboard" class="sf-btn ghost" style="text-decoration:none;">&larr; Dashboard</a>
          </div>
          <div style="background:var(--red-bg);border:1px solid rgba(248,81,73,0.2);border-radius:8px;padding:16px 20px;color:var(--red);font-size:13px;">
            {errorMsg === "not found"
              ? <>No audit finding with id <code>{id}</code> was found. It may have been deleted, or this report was run on a different deployment.</>
              : canRetry
                ? <>Server is busy. The audit data couldn't be read just now — usually a brief Firestore wedge that clears in seconds.</>
                : <>Failed to load finding: {errorMsg}</>}
          </div>
          {canRetry && (
            <div style="margin-top:16px;text-align:center;">
              <a href={`/audit/report?id=${encodeURIComponent(id)}`} class="sf-btn primary" style="text-decoration:none;display:inline-block;padding:10px 20px;">Retry</a>
            </div>
          )}
        </div>
      </Layout>
    );
  }

  const isAdmin = user?.role === "admin";
  // Auditor email for the appeal flow. The `auditor` field is purely
  // informational — it's stored on the appeal record, included in the
  // appeal-filed webhook email to the judge, and logged for tracing.
  // It is NOT used for access control. The audit-report page is public
  // so customers reach it via their audit-complete email link and need
  // to file appeals without logging in.
  //
  // Fallback chain: logged-in user → agent's VoEmail from finding →
  // finding.owner (if not the literal "api" default) → hardcoded
  // sentinel. Backend requires non-empty, sentinel keeps that contract.
  const findingAny = finding as Record<string, unknown>;
  const findingRecord = (findingAny.record as Record<string, unknown> | undefined) ?? {};
  const voEmail = String(findingRecord.VoEmail ?? "").trim();
  const ownerEmail = String(findingAny.owner ?? "").trim();
  const appealAuditorEmail =
    (user?.email ?? "") ||
    voEmail ||
    (ownerEmail && ownerEmail !== "api" ? ownerEmail : "") ||
    "appeal-from-public-report@autobottom.local";

  return (
    <Layout title={`Report ${id}`} section="admin" user={user} hideSidebar>
      <AuditReport finding={finding} id={id} auditorEmail={appealAuditorEmail} isAdmin={isAdmin} />
      <script
        // deno-lint-ignore react-no-danger
        dangerouslySetInnerHTML={{
          __html: `
window.copySnippet = function(idx) {
  var el = document.getElementById('rpt-q-snippet-' + idx);
  if (!el) return;
  navigator.clipboard.writeText(el.textContent || '').then(function() {
    var btn = document.querySelector('.rpt-q-copy[data-idx="' + idx + '"]');
    if (btn) { var orig = btn.textContent; btn.textContent = 'Copied'; setTimeout(function() { btn.textContent = orig; }, 1200); }
  });
};
window.flipQuestion = function(idx) {
  var btn = document.querySelector('.rpt-q-edit[data-idx="' + idx + '"]');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  fetch('/admin/flip-answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ findingId: ${JSON.stringify(id)}, questionIndex: idx, flippedBy: ${JSON.stringify(user?.email ?? "admin")} }),
    credentials: 'include',
  }).then(function(r) { return r.json(); }).then(function(d) {
    if (d.ok) { window.location.reload(); }
    else { alert(d.error || 'Failed to flip'); if (btn) { btn.disabled = false; btn.textContent = '✏'; } }
  }).catch(function() { if (btn) { btn.disabled = false; btn.textContent = '✏'; } });
};
window.adminRerunGenies = function() {
  var idsEl = document.getElementById('rpt-rerun-ids');
  var commentEl = document.getElementById('rpt-rerun-comment');
  var btn = document.getElementById('rpt-rerun-btn');
  var out = document.getElementById('rpt-rerun-output');
  if (!idsEl || !out) return;
  // Accept comma OR newline-separated input.
  var raw = String(idsEl.value || '').split(/[\\s,]+/).map(function(s) { return s.trim(); }).filter(Boolean);
  if (raw.length === 0) {
    out.style.display = 'block';
    out.textContent = 'Enter at least one genie ID.';
    return;
  }
  var bad = raw.filter(function(s) { return !/^\\d+$/.test(s); });
  if (bad.length) {
    out.style.display = 'block';
    out.textContent = 'Invalid genie ID(s): ' + bad.join(', ') + ' — must be digits only.';
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Running…'; }
  out.style.display = 'block';
  out.textContent = 'Submitting ' + raw.length + ' genie ID(s)…';
  fetch('/api/audit/appeal/different-recording', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      findingId: ${JSON.stringify(id)},
      recordingIds: raw,
      comment: String(commentEl ? commentEl.value : '') || 'admin re-run',
      agentEmail: ${JSON.stringify(user?.email ?? "admin")}
    }),
    credentials: 'include',
  }).then(function(r) {
    return r.text().then(function(text) {
      var pretty;
      try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch (_) { pretty = text; }
      out.textContent = 'HTTP ' + r.status + ' ' + r.statusText + '\\n\\n' + pretty;
    });
  }).catch(function(err) {
    out.textContent = 'fetch failed: ' + (err && err.message ? err.message : String(err));
  }).finally(function() {
    if (btn) { btn.disabled = false; btn.textContent = 'Re-run'; }
  });
};
        `,
        }}
      />
    </Layout>
  );
});
