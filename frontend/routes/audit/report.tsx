/** Audit report page — GET /audit/report?id=X. Uses <AuditReport> component.
 *  Ported from production's handleGetReport (main:controller.ts, ~1467 lines of inline HTML).
 *  Our version is ~200 lines of Preact + ~60 lines of CSS, reusing existing classes. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { apiFetch } from "../../lib/api.ts";
import { AuditReport } from "../../components/AuditReport.tsx";

export default define.page(async function AuditReportPage(ctx) {
  const url = new URL(ctx.req.url);
  // Trim — browsers URL-encode leading whitespace as `+`, so "copy/paste from
  // success message with a space" becomes ` LhW-...` which never matches.
  const id = (url.searchParams.get("id") ?? "").trim();
  const user = ctx.state.user;

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
  try {
    const data = await apiFetch<Record<string, unknown>>(`/audit/finding?id=${encodeURIComponent(id)}`, ctx.req);
    if (data && (data as { error?: string }).error) {
      errorMsg = (data as { error: string }).error;
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
              : <>Failed to load finding: {errorMsg}</>}
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title={`Report ${id}`} section="admin" user={user} hideSidebar>
      <AuditReport finding={finding} id={id} auditorEmail={user?.email ?? ""} />
    </Layout>
  );
});
