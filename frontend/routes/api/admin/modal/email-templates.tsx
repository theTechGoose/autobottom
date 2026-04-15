/** Modal content: Email Templates — 3-panel IDE layout matching production. */
import { define } from "../../../../lib/define.ts";
import { apiFetch } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

interface Template { id?: string; name?: string; subject?: string; html?: string; }

const VARIABLES = [
  "agentName", "score", "reportUrl", "recordingUrl", "appealUrl",
  "feedbackText", "recordId", "guestName", "missedQuestions", "missedCount",
  "totalQuestions", "crmUrl", "scoreVerbiage", "teamMember", "teamMemberFirst",
];

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const activeId = url.searchParams.get("id");
    const isNew = url.searchParams.get("new") === "1";

    let templates: Template[] = [];
    try {
      const d = await apiFetch<unknown>("/admin/email-templates", ctx.req);
      templates = Array.isArray(d) ? d : [];
    } catch {}

    const active = activeId ? templates.find(t => t.id === activeId) : null;
    const showEditor = isNew || !!active;

    const html = renderToString(
      <div style="display:flex;flex-direction:column;height:100%;">
        {/* Header */}
        <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 24px 14px;border-bottom:1px solid var(--border);flex-shrink:0;">
          <div>
            <div class="modal-title" style="margin-bottom:2px;">Email Templates</div>
            <div class="modal-sub" style="margin-bottom:0;">Build and preview audit notification emails</div>
          </div>
          <button class="sf-btn ghost" data-close-modal="email-templates-modal" style="font-size:11px;">Close</button>
        </div>

        {/* Body — 3 panels */}
        <div style="display:flex;flex:1;overflow:hidden;min-height:0;">
          {/* Template list sidebar */}
          <div style="width:190px;min-width:190px;border-right:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden;">
            <div style="padding:10px 12px;border-bottom:1px solid var(--border);flex-shrink:0;">
              <button
                class="sf-btn primary"
                style="width:100%;font-size:11px;"
                hx-get="/api/admin/modal/email-templates?new=1"
                hx-target="#email-templates-modal-content"
                hx-swap="innerHTML"
              >+ New Template</button>
            </div>
            <div style="flex:1;overflow-y:auto;padding:6px;">
              {templates.length === 0 ? (
                <div style="color:var(--text-dim);font-size:10px;padding:8px 4px;">No templates yet</div>
              ) : templates.map(t => (
                <div
                  key={t.id}
                  style={`padding:8px 10px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;color:${t.id === activeId ? "var(--text-bright)" : "var(--text-muted)"};background:${t.id === activeId ? "var(--bg-surface)" : "transparent"};margin-bottom:2px;transition:all 0.1s;`}
                  hx-get={`/api/admin/modal/email-templates?id=${t.id}`}
                  hx-target="#email-templates-modal-content"
                  hx-swap="innerHTML"
                >{t.name ?? "Untitled"}</div>
              ))}
            </div>
          </div>

          {/* Editor */}
          <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;border-right:1px solid var(--border);min-width:0;">
            {showEditor ? (
              <>
                <form
                  hx-post="/api/admin/modal/email-templates/save"
                  hx-target="#email-templates-modal-content"
                  hx-swap="innerHTML"
                  style="display:flex;flex-direction:column;flex:1;overflow:hidden;"
                >
                  {active?.id && <input type="hidden" name="id" value={active.id} />}

                  <div style="padding:10px 14px;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:center;flex-shrink:0;">
                    <input class="sf-input" type="text" name="name" placeholder="Template name..." style="width:160px;flex-shrink:0;" value={active?.name ?? ""} />
                    <input class="sf-input" type="text" name="subject" placeholder="Email subject line..." style="flex:1;" value={active?.subject ?? ""} />
                    <button class="sf-btn primary" type="submit" style="font-size:11px;white-space:nowrap;flex-shrink:0;">Save</button>
                    {active?.id && (
                      <button
                        class="sf-btn danger" type="button" style="font-size:11px;flex-shrink:0;"
                        hx-post={`/api/admin/modal/email-templates/delete?id=${active.id}`}
                        hx-target="#email-templates-modal-content"
                        hx-swap="innerHTML"
                        hx-confirm={`Delete "${active.name}"?`}
                      >Delete</button>
                    )}
                  </div>

                  {/* Variable reference bar */}
                  <div style="padding:5px 12px;background:var(--bg);border-bottom:1px solid var(--border);font-size:10px;color:var(--text-dim);flex-shrink:0;line-height:1.8;">
                    <span style="color:var(--text-muted);font-weight:600;">Variables: </span>
                    {VARIABLES.map(v => (
                      <code key={v} style="margin:0 3px;padding:1px 4px;background:var(--bg-surface);border-radius:3px;">{`{{${v}}}`}</code>
                    ))}
                  </div>

                  {/* Template ID info */}
                  {active?.id && (
                    <div style="padding:8px 12px;background:var(--bg);border-bottom:1px solid var(--border);flex-shrink:0;">
                      <div style="display:flex;align-items:center;gap:6px;">
                        <span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);white-space:nowrap;">Template ID</span>
                        <code style="font-size:10px;color:var(--cyan);background:var(--cyan-bg);padding:2px 7px;border-radius:4px;font-family:var(--mono);">{active.id}</code>
                      </div>
                    </div>
                  )}

                  {/* HTML textarea */}
                  <textarea
                    name="html"
                    style="flex:1;resize:none;background:var(--bg);color:var(--text);border:none;outline:none;padding:14px 16px;font-family:var(--mono);font-size:12px;line-height:1.6;"
                    placeholder="Paste or type HTML here..."
                  >{active?.html ?? ""}</textarea>
                </form>
              </>
            ) : (
              <div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--text-dim);font-size:12px;">
                Select a template or create a new one
              </div>
            )}
          </div>

          {/* Preview panel */}
          <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0;">
            <div style="padding:10px 14px;border-bottom:1px solid var(--border);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);flex-shrink:0;">
              Live Preview
            </div>
            {showEditor ? (
              <div style="flex:1;overflow:auto;padding:0;">
                {active?.html ? (
                  <iframe
                    srcDoc={active.html}
                    style="width:100%;height:100%;border:none;background:#fff;"
                    sandbox="allow-same-origin"
                  ></iframe>
                ) : (
                  <div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-dim);font-size:11px;">
                    {isNew ? "Preview will appear after saving" : "No HTML content"}
                  </div>
                )}
              </div>
            ) : (
              <div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--text-dim);font-size:11px;">
                Select a template to preview
              </div>
            )}
          </div>
        </div>
      </div>
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
