/** Email reports — list, create, delete scheduled reports. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { apiFetch } from "../../lib/api.ts";

export default define.page(async function EmailReportsPage(ctx) {
  const user = ctx.state.user!;
  let configs: unknown[] = [];
  try { const data = await apiFetch<{ configs: unknown[] }>("/admin/email-reports", ctx.req); configs = data.configs ?? []; } catch {}

  return (
    <Layout title="Email Reports" section="admin" user={user}>
      <div class="page-header"><h1>Email Reports</h1><p class="page-sub">Scheduled email report configurations</p></div>
      <div class="tbl">
        <table class="data-table">
          <thead><tr><th>Name</th><th>Recipients</th><th>Schedule</th><th>Status</th></tr></thead>
          <tbody>
            {configs.length === 0 ? <tr class="empty-row"><td colSpan={4}>No email reports configured</td></tr> : configs.map((c: any, i) => (
              <tr key={i}><td style="font-weight:600;color:var(--text-bright);">{c.name ?? `Report ${i + 1}`}</td><td class="mono">{c.recipients?.join(", ") ?? "\u2014"}</td><td>{c.schedule ?? "\u2014"}</td><td><span class={`pill pill-${c.enabled !== false ? "green" : "red"}`}>{c.enabled !== false ? "Active" : "Disabled"}</span></td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
});
