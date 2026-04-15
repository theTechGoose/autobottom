/** Office bypass configuration. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { apiFetch } from "../../lib/api.ts";

export default define.page(async function OfficesPage(ctx) {
  const user = ctx.state.user!;
  let config = { patterns: [] as string[] };
  try { config = await apiFetch("/admin/office-bypass", ctx.req); } catch {}

  return (
    <Layout title="Offices" section="admin" user={user}>
      <div class="page-header"><h1>Office Bypass</h1><p class="page-sub">Configure office patterns to bypass auditing</p></div>
      <div class="card">
        <form hx-post="/api/admin/config-save" hx-vals='{"endpoint":"/admin/office-bypass"}' hx-target="#off-result" hx-swap="innerHTML">
          <div class="form-group"><label>Bypass Patterns (one per line)</label><textarea name="patterns" rows={6} style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text-bright);padding:10px 14px;font-size:13px;font-family:var(--mono);resize:vertical;">{config.patterns?.join("\n") ?? ""}</textarea></div>
          <div style="display:flex;gap:8px;align-items:center;"><button class="btn btn-primary" type="submit">Save</button><span id="off-result"></span></div>
        </form>
      </div>
    </Layout>
  );
});
