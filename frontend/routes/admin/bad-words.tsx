/** Bad words configuration. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { apiFetch } from "../../lib/api.ts";

export default define.page(async function BadWordsPage(ctx) {
  const user = ctx.state.user!;
  let config = { enabled: false, emails: [] as string[], words: [] as unknown[] };
  try { config = await apiFetch("/admin/bad-word-config", ctx.req); } catch {}

  return (
    <Layout title="Bad Words" section="admin" user={user}>
      <div class="page-header"><h1>Bad Words Configuration</h1><p class="page-sub">Configure profanity scanning for transcripts</p></div>
      <div class="card">
        <form hx-post="/api/admin/config-save" hx-vals='{"endpoint":"/admin/bad-word-config"}' hx-target="#bw-result" hx-swap="innerHTML">
          <div class="form-group"><label>Enabled</label><select name="enabled" style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text-bright);padding:10px 14px;font-size:14px;"><option value="true" selected={config.enabled}>Yes</option><option value="false" selected={!config.enabled}>No</option></select></div>
          <div class="form-group"><label>Alert Emails (comma-separated)</label><input type="text" name="emails" value={config.emails?.join(", ") ?? ""} placeholder="alert@company.com, admin@company.com" /></div>
          <div style="display:flex;gap:8px;align-items:center;"><button class="btn btn-primary" type="submit">Save</button><span id="bw-result"></span></div>
        </form>
      </div>
    </Layout>
  );
});
