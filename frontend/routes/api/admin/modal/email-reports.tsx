/** Modal content: Email Reports — list/edit CRUD matching production. */
import { define } from "../../../../lib/define.ts";
import { apiFetch } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

interface ReportConfig { id?: string; name?: string; recipients?: string[]; schedule?: string; enabled?: boolean; templateId?: string; }

export async function renderReportsModal(
  req: Request,
  opts: { view?: "list" | "edit"; editId?: string } = {},
): Promise<Response> {
  const view = opts.view ?? "list";
  const editId = opts.editId;

  let configs: ReportConfig[] = [];
  try { const d = await apiFetch<{ configs?: ReportConfig[] }>("/admin/email-reports", req); configs = d.configs ?? []; } catch {}

    // Edit view
    if (view === "edit") {
      const config = editId ? configs.find(c => c.id === editId) : null;
      const isNew = !config;
      const c = config ?? {};

      const html = renderToString(
        <div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
            <button class="sf-btn ghost" hx-get="/api/admin/modal/email-reports" hx-target="#email-reports-modal-content" hx-swap="innerHTML" style="font-size:11px;">&larr; Back</button>
            <div class="modal-title" style="margin-bottom:0;">{isNew ? "New Report" : `Edit: ${c.name ?? "Report"}`}</div>
          </div>

          <form hx-post="/api/admin/modal/email-reports/save" hx-target="#email-reports-modal-content" hx-swap="innerHTML">
            {c.id && <input type="hidden" name="id" value={c.id} />}

            <div class="sf">
              <label class="sf-label">Name</label>
              <input type="text" class="sf-input" name="name" value={c.name ?? ""} placeholder="Report name" required />
            </div>

            <div class="sf">
              <label class="sf-label">Recipients (one per line)</label>
              <textarea class="sf-input" name="recipients" rows={4} style="height:auto;" placeholder="email@example.com">{c.recipients?.join("\n") ?? ""}</textarea>
            </div>

            <div class="sf">
              <label class="sf-label">Schedule (cron expression)</label>
              <input type="text" class="sf-input" name="schedule" value={c.schedule ?? ""} placeholder="0 8 * * 1" />
            </div>

            <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--bg);border:1px solid var(--border);border-radius:8px;margin-bottom:12px;">
              <label style="font-size:11px;font-weight:600;color:var(--text-bright);flex:1;">Active</label>
              <input type="checkbox" name="enabled" checked={c.enabled !== false} style="width:16px;height:16px;" />
            </div>

            <div class="sf-actions">
              {!isNew && (
                <button
                  type="button" class="sf-btn danger"
                  hx-post={`/api/admin/modal/email-reports/delete?id=${c.id}`}
                  hx-target="#email-reports-modal-content"
                  hx-swap="innerHTML"
                  hx-confirm={`Delete "${c.name}"?`}
                >Delete</button>
              )}
              {!isNew && (
                <button
                  type="button" class="sf-btn ghost"
                  hx-post={`/api/admin/modal/email-reports/send-now?id=${c.id}`}
                  hx-target="#er-send-msg"
                  hx-swap="innerHTML"
                >Send Now</button>
              )}
              <button type="submit" class="sf-btn primary">Save</button>
            </div>
            <span id="er-send-msg"></span>
          </form>
        </div>
      );
      return new Response(html, { headers: { "content-type": "text/html" } });
    }

  // List view (default)
  const html = renderToString(
      <div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
          <div class="modal-title" style="margin-bottom:0;">Email Reports</div>
          <div style="display:flex;gap:8px;">
            <button class="sf-btn primary" style="font-size:11px;" hx-get="/api/admin/modal/email-reports?view=edit" hx-target="#email-reports-modal-content" hx-swap="innerHTML">+ New Report</button>
          </div>
        </div>

        <table class="data-table">
          <thead><tr><th>Name</th><th>Recipients</th><th>Schedule</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {configs.length === 0 ? (
              <tr class="empty-row"><td colSpan={5}>No email reports configured</td></tr>
            ) : configs.map((c) => (
              <tr
                key={c.id ?? c.name}
                style="cursor:pointer;"
                hx-get={`/api/admin/modal/email-reports?view=edit&id=${c.id}`}
                hx-target="#email-reports-modal-content"
                hx-swap="innerHTML"
              >
                <td style="font-weight:600;color:var(--text-bright);">{c.name ?? "Untitled"}</td>
                <td class="mono" style="font-size:10px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{c.recipients?.join(", ") ?? "\u2014"}</td>
                <td>{c.schedule ?? "\u2014"}</td>
                <td><span class={`pill pill-${c.enabled !== false ? "green" : "red"}`}>{c.enabled !== false ? "Active" : "Off"}</span></td>
                <td>
                  <button class="sf-btn ghost" style="font-size:9px;padding:2px 6px;" hx-post={`/api/admin/modal/email-reports/send-now?id=${c.id}`} hx-target="#er-list-msg" hx-swap="innerHTML" onClick={(e: Event) => e.stopPropagation()}>Send</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <span id="er-list-msg" style="font-size:11px;margin-top:8px;display:block;"></span>

        <div style="border-top:1px solid var(--border);margin-top:16px;padding-top:12px;text-align:center;">
          <a href="/admin/weekly-builder" style="font-size:11px;color:var(--text-muted);text-decoration:none;">Build Weekly Reports &rarr;</a>
        </div>
      </div>
    );
  return new Response(html, { headers: { "content-type": "text/html" } });
}

export const handler = define.handlers({
  GET(ctx) {
    const url = new URL(ctx.req.url);
    return renderReportsModal(ctx.req, {
      view: (url.searchParams.get("view") as "list" | "edit") ?? "list",
      editId: url.searchParams.get("id") ?? undefined,
    });
  },
});
