/** Chargebacks & Omissions report. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { apiFetch } from "../../lib/api.ts";

export default define.page(async function ChargebacksPage(ctx) {
  const user = ctx.state.user!;
  const url = new URL(ctx.req.url);
  const since = url.searchParams.get("since") ?? String(Date.now() - 7 * 86_400_000);
  const until = url.searchParams.get("until") ?? String(Date.now());
  let chargebacks: unknown[] = [];
  try { const data = await apiFetch<{ chargebacks: unknown[] }>(`/admin/chargebacks?since=${since}&until=${until}`, ctx.req); chargebacks = data.chargebacks ?? []; } catch {}

  return (
    <Layout title="Chargebacks" section="admin" user={user}>
      <div class="page-header"><h1>Chargebacks & Omissions</h1><p class="page-sub">Review chargeback data and wire deductions</p></div>
      <div class="card" style="margin-bottom:16px;padding:14px 18px;">
        <form method="GET" action="/admin/chargebacks-report" style="display:flex;gap:10px;align-items:flex-end;">
          <div class="form-group" style="margin-bottom:0;"><label>Since (ms)</label><input type="text" name="since" value={since} style="font-family:var(--mono);font-size:12px;" /></div>
          <div class="form-group" style="margin-bottom:0;"><label>Until (ms)</label><input type="text" name="until" value={until} style="font-family:var(--mono);font-size:12px;" /></div>
          <button class="btn btn-primary" type="submit" style="height:40px;">Load</button>
          <button class="btn btn-ghost" style="height:40px;" hx-post="/api/admin/queue-action" hx-vals='{"action":"post-to-sheet"}' hx-swap="none">Post to Sheet</button>
        </form>
      </div>
      <div class="tbl">
        <div class="tbl-title">Chargebacks ({chargebacks.length})</div>
        <table class="data-table">
          <thead><tr><th>Finding</th><th>Record</th><th>Amount</th><th>Reason</th></tr></thead>
          <tbody>
            {chargebacks.length === 0 ? <tr class="empty-row"><td colSpan={4}>No chargebacks in range</td></tr> : chargebacks.map((c: any, i) => (
              <tr key={i}><td class="mono">{c.findingId?.slice(0, 8) ?? "\u2014"}</td><td class="mono">{c.recordId ?? "\u2014"}</td><td>{c.amount ?? "\u2014"}</td><td>{c.reason ?? "\u2014"}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
});
