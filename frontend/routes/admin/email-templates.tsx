/** Email templates — CRUD for email templates. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { apiFetch } from "../../lib/api.ts";

export default define.page(async function EmailTemplatesPage(ctx) {
  const user = ctx.state.user!;
  let templates: unknown[] = [];
  try { const data = await apiFetch<{ templates: unknown[] }>("/admin/email-templates", ctx.req); templates = data.templates ?? []; } catch {}

  return (
    <Layout title="Email Templates" section="admin" user={user}>
      <div class="page-header"><h1>Email Templates</h1><p class="page-sub">Manage email notification templates</p></div>
      <div class="tbl">
        <table class="data-table">
          <thead><tr><th>Name</th><th>Subject</th><th>Actions</th></tr></thead>
          <tbody>
            {templates.length === 0 ? <tr class="empty-row"><td colSpan={3}>No templates</td></tr> : templates.map((t: any, i) => (
              <tr key={i}><td style="font-weight:600;color:var(--text-bright);">{t.name ?? `Template ${i + 1}`}</td><td>{t.subject ?? "\u2014"}</td><td><button class="btn btn-ghost" style="padding:3px 8px;font-size:10px;">Edit</button></td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
});
