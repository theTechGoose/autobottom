/** Audit dimensions — departments, shifts, partner offices. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { apiFetch } from "../../lib/api.ts";

export default define.page(async function DimensionsPage(ctx) {
  const user = ctx.state.user!;
  let dims = { departments: [] as string[], shifts: [] as string[] };
  let partners: Record<string, unknown> = {};
  try { dims = await apiFetch("/admin/audit-dimensions", ctx.req); } catch {}
  try { const p = await apiFetch<{ offices: Record<string, unknown> }>("/admin/partner-dimensions", ctx.req); partners = p.offices ?? {}; } catch {}

  return (
    <Layout title="Dimensions" section="admin" user={user}>
      <div class="page-header"><h1>Audit Dimensions</h1><p class="page-sub">Configure departments, shifts, and partner offices</p></div>
      <div class="card" style="margin-bottom:12px;">
        <div class="tbl-title">Departments & Shifts</div>
        <form hx-post="/api/admin/config-save" hx-vals='{"endpoint":"/admin/audit-dimensions"}' hx-target="#dim-result" hx-swap="innerHTML">
          <div class="form-group"><label>Departments (comma-separated)</label><input type="text" name="departments" value={dims.departments?.join(", ") ?? ""} /></div>
          <div class="form-group"><label>Shifts (comma-separated)</label><input type="text" name="shifts" value={dims.shifts?.join(", ") ?? ""} /></div>
          <div style="display:flex;gap:8px;align-items:center;"><button class="btn btn-primary" type="submit">Save</button><span id="dim-result"></span></div>
        </form>
      </div>
      <div class="card">
        <div class="tbl-title">Partner Offices</div>
        <pre style="font-size:11px;color:var(--text);background:var(--bg);padding:10px;border-radius:6px;overflow-x:auto;max-height:300px;">{JSON.stringify(partners, null, 2)}</pre>
      </div>
    </Layout>
  );
});
