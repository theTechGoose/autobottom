/** Modal content: Webhook config — tabbed UI matching production. */
import { define } from "../../../../lib/define.ts";
import { apiFetch } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

const KINDS = [
  { kind: "terminate", label: "Audit Complete", desc: "Called when an audit review is completed" },
  { kind: "appeal", label: "Appeal Filed", desc: "Called when a team member files an appeal" },
  { kind: "manager", label: "Manager Review", desc: "Called when a manager remediation is needed" },
  { kind: "judge-finish", label: "Judge Finish", desc: "Called when a judge decides an appeal" },
  { kind: "re-audit-receipt", label: "Re-Audit Receipt", desc: "Called when a re-audit is received" },
] as const;

const EMAIL_KINDS = ["terminate", "appeal", "manager", "judge-finish", "re-audit-receipt"];
const SELF_ENDPOINTS: Record<string, string> = {
  terminate: "/webhooks/audit-complete",
  appeal: "/webhooks/appeal-filed",
  manager: "/webhooks/manager-review",
  "judge-finish": "/webhooks/appeal-decided",
};

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const activeKind = url.searchParams.get("kind") ?? "terminate";

    // Fetch config for active kind + template list
    let config: Record<string, unknown> = {};
    let templates: { id: string; name: string }[] = [];
    try { config = await apiFetch(`/admin/settings/${activeKind}`, ctx.req); } catch {}
    try {
      const tList = await apiFetch<unknown>("/admin/email-templates", ctx.req);
      templates = Array.isArray(tList) ? tList : [];
    } catch {}

    const kindInfo = KINDS.find(k => k.kind === activeKind) ?? KINDS[0];
    const isEmailKind = EMAIL_KINDS.includes(activeKind);
    const selfEndpoint = SELF_ENDPOINTS[activeKind];

    const html = renderToString(
      <div>
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px;">
          <div>
            <div class="modal-title">Webhook Configuration</div>
            <div class="modal-sub">Configure outbound webhooks for pipeline events</div>
          </div>
          <button data-close-modal="webhook-modal" style="background:none;border:none;color:var(--text-dim);font-size:20px;cursor:pointer;padding:0 4px;line-height:1;">&times;</button>
        </div>

        {/* Tabs */}
        <div class="wh-tabs">
          {KINDS.map(k => (
            <button
              key={k.kind}
              class={`wh-tab ${k.kind === activeKind ? "active" : ""}`}
              hx-get={`/api/admin/modal/webhook?kind=${k.kind}`}
              hx-target="#webhook-modal-content"
              hx-swap="innerHTML"
            >{k.label}</button>
          ))}
        </div>

        {/* Description */}
        <div class="modal-sub">{kindInfo.desc}</div>

        {/* Form */}
        <form hx-post={`/api/admin/modal/webhook/save?kind=${activeKind}`} hx-target="#wh-save-msg" hx-swap="innerHTML">
          <div class="sf">
            <label class="sf-label">External Webhook URL <span style="color:var(--text-dim);font-weight:400;">(optional — for external integrations only)</span></label>
            <input type="text" class="sf-input" name="postUrl" value={(config.postUrl as string) ?? ""} placeholder="https://example.com/webhook" />
          </div>
          <div class="sf">
            <label class="sf-label">Headers (JSON)</label>
            <textarea class="sf-input" name="postHeaders" placeholder='{"Authorization": "Bearer ..."}'>{config.postHeaders ? JSON.stringify(config.postHeaders, null, 2) : ""}</textarea>
          </div>
          <div class="sf">
            <label class="sf-label">Test Email <span style="color:var(--text-dim);font-weight:400;">(overrides all recipients when set — leave blank for live)</span></label>
            <input type="text" class="sf-input" name="testEmail" value={(config.testEmail as string) ?? ""} placeholder="yourname@example.com" />
          </div>
          <div class="sf">
            <label class="sf-label">BCC <span style="color:var(--text-dim);font-weight:400;">(comma-separated — skipped when test email is set)</span></label>
            <input type="text" class="sf-input" name="bcc" value={(config.bcc as string) ?? ""} placeholder="email1@example.com,email2@example.com" />
          </div>

          {/* Template dropdown — only for email kinds */}
          {isEmailKind && (
            <div class="sf">
              <label class="sf-label">Email Template <span style="color:var(--text-dim);font-weight:400;">(used for direct emails on this event)</span></label>
              <select class="sf-input" name="emailTemplateId" style="font-family:inherit;">
                <option value="">— No template (email disabled) —</option>
                {templates.map(t => <option key={t.id} value={t.id} selected={t.id === (config.emailTemplateId as string)}>{t.name}</option>)}
              </select>
            </div>
          )}

          {/* Dismissal template — judge-finish only */}
          {activeKind === "judge-finish" && (
            <div class="sf">
              <label class="sf-label">Dismissal Email Template <span style="color:var(--text-dim);font-weight:400;">(used when a judge dismisses — falls back to above if not set)</span></label>
              <select class="sf-input" name="dismissalTemplateId" style="font-family:inherit;">
                <option value="">— Use verdict template above —</option>
                {templates.map(t => <option key={t.id} value={t.id} selected={t.id === (config.dismissalTemplateId as string)}>{t.name}</option>)}
              </select>
            </div>
          )}

          {/* Default endpoint URL */}
          {selfEndpoint && (
            <div style="margin-top:10px;padding:10px 14px;background:var(--bg);border:1px solid var(--border);border-radius:8px;">
              <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:6px;">Default Email Endpoint (auto-configured)</div>
              <code style="font-size:10px;color:var(--cyan);word-break:break-all;line-height:1.5;">{selfEndpoint}</code>
            </div>
          )}

          <div class="modal-actions">
            <button type="button" class="sf-btn secondary" data-close-modal="webhook-modal">Cancel</button>
            <button type="submit" class="sf-btn primary">Save</button>
          </div>
          <span id="wh-save-msg"></span>
        </form>
      </div>
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
