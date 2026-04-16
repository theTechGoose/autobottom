/** Audit report page — GET /audit/report?id=X.
 *  Currently a JSON-dump placeholder. The production-equivalent full-HTML report is
 *  thousands of lines and hasn't been ported yet — this unblocks the Find Audit flow
 *  (Dashboard → View Report) so clicks don't 404. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { apiFetch } from "../../lib/api.ts";

export default define.page(async function AuditReport(ctx) {
  const url = new URL(ctx.req.url);
  const id = url.searchParams.get("id") ?? "";
  const user = ctx.state.user;

  if (!id) {
    return (
      <Layout title="Audit Report" section="admin" user={user} hideSidebar>
        <div style="padding:48px;text-align:center;color:var(--text-dim);">
          <h1 style="font-size:18px;color:var(--text-bright);margin-bottom:12px;">Missing finding ID</h1>
          <p>Open a report with <code>/audit/report?id=&lt;findingId&gt;</code></p>
        </div>
      </Layout>
    );
  }

  let finding: Record<string, unknown> | { error: string } = { error: "not-loaded" };
  try {
    finding = await apiFetch<Record<string, unknown>>(`/audit/finding?id=${encodeURIComponent(id)}`, ctx.req);
  } catch (e) {
    finding = { error: (e as Error).message };
  }

  const err = (finding as { error?: string }).error;
  const prettyJson = JSON.stringify(finding, null, 2);

  return (
    <Layout title={`Report ${id}`} section="admin" user={user} hideSidebar>
      <div style="max-width:1000px;margin:0 auto;padding:32px 24px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
          <div>
            <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1.5px;font-weight:700;">Audit Report</div>
            <h1 style="font-size:18px;color:var(--text-bright);font-family:var(--mono);margin-top:2px;">{id}</h1>
          </div>
          <a href="/admin/dashboard" class="btn btn-ghost" style="text-decoration:none;">&larr; Dashboard</a>
        </div>

        {err ? (
          <div style="background:var(--red-bg);border:1px solid rgba(248,81,73,0.2);border-radius:8px;padding:16px 20px;color:var(--red);font-size:13px;">
            Failed to load finding: {err}
          </div>
        ) : (
          <div style="background:var(--bg-raised);border:1px solid var(--border);border-radius:10px;padding:18px 22px;">
            <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:10px;">Finding data</div>
            <pre style="font-family:var(--mono);font-size:11px;color:var(--text);background:var(--bg);padding:14px 16px;border-radius:6px;overflow:auto;max-height:70vh;line-height:1.5;white-space:pre-wrap;word-break:break-word;">{prettyJson}</pre>
          </div>
        )}
        <div style="margin-top:12px;font-size:11px;color:var(--text-dim);text-align:center;">
          Full report UI is pending port from legacy codebase.
        </div>
      </div>
    </Layout>
  );
});
