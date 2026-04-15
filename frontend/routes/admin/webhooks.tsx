/** Webhook configuration — 5 event types with URL + headers. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { apiFetch } from "../../lib/api.ts";

const KINDS = ["terminate", "appeal", "manager", "review", "judge", "judge-finish", "re-audit-receipt"] as const;

export default define.page(async function WebhooksPage(ctx) {
  const user = ctx.state.user!;
  const configs: Record<string, { postUrl?: string; postHeaders?: unknown }> = {};
  for (const kind of KINDS) {
    try { configs[kind] = await apiFetch(`/admin/settings/${kind}`, ctx.req); } catch { configs[kind] = {}; }
  }

  return (
    <Layout title="Webhooks" section="admin" user={user}>
      <div class="page-header"><h1>Webhook Configuration</h1><p class="page-sub">Configure outbound webhooks for pipeline events</p></div>
      {KINDS.map((kind) => (
        <div key={kind} class="card" style="margin-bottom:12px;">
          <div class="tbl-title" style="text-transform:capitalize;">{kind.replace(/-/g, " ")}</div>
          <form hx-post={`/api/admin/webhook-save?kind=${kind}`} hx-target={`#wh-result-${kind}`} hx-swap="innerHTML">
            <div class="form-group"><label>POST URL</label><input type="url" name="postUrl" value={configs[kind]?.postUrl ?? ""} placeholder="https://..." /></div>
            <div class="form-group"><label>Headers (JSON)</label><textarea name="postHeaders" rows={3} style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text-bright);padding:10px;font-size:12px;font-family:var(--mono);resize:vertical;">{JSON.stringify(configs[kind]?.postHeaders ?? {}, null, 2)}</textarea></div>
            <div style="display:flex;gap:8px;align-items:center;"><button class="btn btn-primary" type="submit" style="padding:6px 16px;font-size:12px;">Save</button><span id={`wh-result-${kind}`}></span></div>
          </form>
        </div>
      ))}
    </Layout>
  );
});
