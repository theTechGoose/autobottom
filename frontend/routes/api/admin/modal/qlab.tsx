/** Modal content: Question Lab — assignment management. Mirrors prod's
 *  dashboard QLab modal. INTERNAL (date-leg destinations) and PARTNER (offices)
 *  tabs each show current assignments + a bind form. The "Open Config Builder →"
 *  link in the header takes the admin to /question-lab to edit the configs
 *  themselves. */
import { define } from "../../../../lib/define.ts";
import { apiFetch } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

interface QLConfig { id: string; name: string; type: "internal" | "partner"; }
interface AssignmentResponse {
  internal?: Record<string, string>;
  partner?: Record<string, string>;
}

export type QlabTab = "internal" | "partner";

export async function renderQlabModal(
  req: Request,
  opts: { tab?: QlabTab; message?: string } = {},
): Promise<Response> {
  const tab: QlabTab = opts.tab === "partner" ? "partner" : "internal";

  let configs: QLConfig[] = [];
  let assignments: AssignmentResponse = {};
  try {
    const d = await apiFetch<{ configs?: QLConfig[] }>("/api/qlab/configs", req);
    configs = d.configs ?? [];
  } catch {}
  try {
    assignments = await apiFetch<AssignmentResponse>("/api/qlab-assignments", req);
  } catch {}

  const html = renderToString(<QlabModalBody tab={tab} configs={configs} assignments={assignments} message={opts.message} />);
  return new Response(html, { headers: { "content-type": "text/html" } });
}

export function QlabModalBody({
  tab, configs, assignments, message,
}: { tab: QlabTab; configs: QLConfig[]; assignments: AssignmentResponse; message?: string }) {
  const tabConfigs = configs.filter((c) => c.type === tab);
  const list = (tab === "internal" ? assignments.internal : assignments.partner) ?? {};
  const entries = Object.entries(list);

  const fieldLabel = tab === "internal" ? "Destination" : "Office";
  const placeholder = tab === "internal" ? "Destination ID" : "Office name…";
  const description = tab === "internal"
    ? "Assign a Question Lab config to a specific destination ID. Internal audits for that destination will use the assigned config."
    : "Assign a Question Lab config to a partner office name. Package audits for that office will use the assigned config.";
  const emptyText = tab === "internal" ? "No destination assignments yet." : "No office assignments yet.";

  return (
    <div>
      {/* Header */}
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:4px;">
        <div>
          <div class="modal-title" style="margin-bottom:2px;">Question Lab</div>
          <div class="modal-sub" style="margin-bottom:0;">
            Assign Question Lab configs to destinations and offices. Audits use QB questions by default; assign a config to override for that destination or office.
          </div>
        </div>
        <a
          href="/question-lab"
          class="tbl-link"
          style="font-size:12px;font-weight:600;color:var(--blue);text-decoration:none;white-space:nowrap;margin-left:14px;"
        >Open Config Builder →</a>
      </div>

      {/* Tabs */}
      <div style="display:flex;gap:4px;margin:14px 0 12px;border-bottom:1px solid var(--border);">
        <button
          class={`sf-btn ghost um-tab ${tab === "internal" ? "active" : ""}`}
          style={`padding:8px 14px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;border-radius:0;border-bottom:2px solid ${tab === "internal" ? "var(--blue)" : "transparent"};color:${tab === "internal" ? "var(--blue)" : "var(--text-dim)"};`}
          hx-get="/api/admin/modal/qlab?tab=internal"
          hx-target="#qlab-modal-content"
          hx-swap="innerHTML"
        >Internal (Date Legs)</button>
        <button
          class={`sf-btn ghost um-tab ${tab === "partner" ? "active" : ""}`}
          style={`padding:8px 14px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;border-radius:0;border-bottom:2px solid ${tab === "partner" ? "var(--blue)" : "transparent"};color:${tab === "partner" ? "var(--blue)" : "var(--text-dim)"};`}
          hx-get="/api/admin/modal/qlab?tab=partner"
          hx-target="#qlab-modal-content"
          hx-swap="innerHTML"
        >Partner (Packages)</button>
      </div>

      {/* Description */}
      <div style="font-size:12px;color:var(--text-muted);line-height:1.55;margin-bottom:14px;">{description}</div>

      {/* Current assignments */}
      <div style="margin-bottom:18px;">
        {entries.length === 0 ? (
          <div style="color:var(--text-dim);font-size:12px;padding:10px 0;">{emptyText}</div>
        ) : (
          <div style="display:flex;flex-direction:column;gap:6px;">
            {entries.map(([key, configName]) => (
              <div key={key} style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;font-size:12px;">
                <div style="flex:1;min-width:0;">
                  <div style="color:var(--text-bright);font-weight:600;font-family:var(--mono);">{key}</div>
                  <div style="color:var(--text-dim);font-size:11px;margin-top:2px;">→ {configName}</div>
                </div>
                <button
                  type="button"
                  class="sf-btn danger"
                  style="font-size:10px;"
                  hx-post={`/api/admin/modal/qlab/clear?type=${tab}&key=${encodeURIComponent(key)}`}
                  hx-target="#qlab-modal-content"
                  hx-swap="innerHTML"
                  hx-confirm={`Remove ${fieldLabel.toLowerCase()} assignment for "${key}"?`}
                >Unbind</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bind form */}
      <form
        hx-post="/api/admin/modal/qlab/set"
        hx-target="#qlab-modal-content"
        hx-swap="innerHTML"
        style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;border-top:1px solid var(--border);padding-top:14px;"
      >
        <input type="hidden" name="type" value={tab} />
        <div style="flex:1;min-width:160px;">
          <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.8px;">{fieldLabel}</label>
          <input
            class="sf-input"
            name="key"
            type="text"
            placeholder={placeholder}
            required
            style="width:100%;font-size:12px;font-family:var(--mono);"
          />
        </div>
        <div style="flex:1;min-width:200px;">
          <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.8px;">Config</label>
          <select class="sf-input" name="configName" style="width:100%;font-size:12px;">
            <option value="">— Remove / Use Product default</option>
            {tabConfigs.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
        </div>
        <button type="submit" class="sf-btn primary" style="font-size:11px;">Assign</button>
      </form>

      {message && (
        <div style="margin-top:10px;font-size:11px;color:var(--green);">{message}</div>
      )}

      <div style="margin-top:16px;display:flex;justify-content:flex-end;border-top:1px solid var(--border);padding-top:12px;">
        <button class="sf-btn ghost" data-close-modal="qlab-modal" type="button">Close</button>
      </div>
    </div>
  );
}

export const handler = define.handlers({
  GET(ctx) {
    const url = new URL(ctx.req.url);
    const tab = (url.searchParams.get("tab") === "partner" ? "partner" : "internal") as QlabTab;
    return renderQlabModal(ctx.req, { tab });
  },
});
