/** Audit history — search, filter, retry, terminate. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { apiFetch } from "../../lib/api.ts";
import { timeAgo } from "../../lib/format.ts";

interface AuditEntry {
  findingId: string;
  recordId?: string;
  type?: string;
  score?: number;
  completedAt?: number;
  findingStatus?: string;
}

export default define.page(async function AdminAudits(ctx) {
  const user = ctx.state.user!;
  const url = new URL(ctx.req.url);
  const since = url.searchParams.get("since") ?? String(Date.now() - 7 * 86_400_000);
  const until = url.searchParams.get("until") ?? String(Date.now());
  const recordId = url.searchParams.get("recordId") ?? "";

  let audits: AuditEntry[] = [];
  try {
    if (recordId) {
      const data = await apiFetch<{ audits: AuditEntry[] }>(`/admin/audits-by-record?recordId=${recordId}`, ctx.req);
      audits = data.audits ?? [];
    } else {
      const data = await apiFetch<{ audits: AuditEntry[] }>(`/admin/audits/data?since=${since}&until=${until}`, ctx.req);
      audits = data.audits ?? [];
    }
  } catch (e) {
    console.error("Failed to load audits:", e);
  }

  return (
    <Layout title="Audits" section="admin" user={user}>
      <div class="page-header">
        <h1>Audit History</h1>
        <p class="page-sub">{audits.length} audits found</p>
      </div>

      <div class="card" style="margin-bottom: 16px; padding: 14px 18px;">
        <form method="GET" action="/admin/audits" style="display:flex;gap:10px;align-items:flex-end;">
          <div class="form-group" style="margin-bottom:0;flex:1;">
            <label>Record ID</label>
            <input type="text" name="recordId" value={recordId} placeholder="Search by QuickBase record ID" />
          </div>
          <button class="btn btn-primary" type="submit" style="height:40px;">Search</button>
          {recordId && <a href="/admin/audits" class="btn btn-ghost" style="height:40px;">Clear</a>}
        </form>
      </div>

      <div class="tbl">
        <table class="data-table">
          <thead>
            <tr><th>Finding</th><th>Record</th><th>Type</th><th>Score</th><th>Status</th><th>Completed</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {audits.length === 0 ? (
              <tr class="empty-row"><td colSpan={7}>No audits found</td></tr>
            ) : audits.map((a) => (
              <tr key={a.findingId}>
                <td class="mono">{a.findingId?.slice(0, 8) ?? "\u2014"}</td>
                <td class="mono">{a.recordId ?? "\u2014"}</td>
                <td>{a.type ? <span class={`pill ${a.type === "internal" ? "pill-blue" : "pill-purple"}`}>{a.type}</span> : "\u2014"}</td>
                <td>{a.score != null ? <span class={`pill pill-${a.score >= 90 ? "green" : a.score >= 70 ? "yellow" : "red"}`}>{a.score}%</span> : "\u2014"}</td>
                <td>{a.findingStatus ? <span class={`pill pill-${a.findingStatus === "completed" || a.findingStatus === "done" ? "green" : a.findingStatus === "error" ? "red" : "blue"}`}>{a.findingStatus}</span> : "\u2014"}</td>
                <td class="time-ago">{a.completedAt ? timeAgo(a.completedAt) : "\u2014"}</td>
                <td style="display:flex;gap:4px;">
                  <button class="btn btn-ghost" style="padding:3px 8px;font-size:10px;" hx-get={`/api/admin/retry?findingId=${a.findingId}`} hx-swap="none">Retry</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
});

