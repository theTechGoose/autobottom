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

// Default logo used only in preview render so {{logoUrl}} isn't a broken image.
// Stored HTML keeps the {{logoUrl}} placeholder — webhook/email engine substitutes at send time.
const PREVIEW_LOGO_DATA_URI =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30"><rect width="30" height="30" rx="6" fill="#1f6feb"/><text x="15" y="20" font-family="system-ui,sans-serif" font-size="14" font-weight="700" fill="#fff" text-anchor="middle">AB</text></svg>`,
  );

function injectPreviewDefaults(html: string): string {
  // Substitute placeholders with sensible preview values so the iframe renders cleanly.
  return html
    .replaceAll("{{logoUrl}}", PREVIEW_LOGO_DATA_URI)
    .replaceAll("{{teamMemberFirst}}", "Alex")
    .replaceAll("{{teamMember}}", "Alex Johnson")
    .replaceAll("{{agentName}}", "Alex Johnson")
    .replaceAll("{{guestName}}", "Jamie Smith")
    .replaceAll("{{score}}", "92")
    .replaceAll("{{originalScore}}", "78")
    .replaceAll("{{finalScore}}", "92")
    .replaceAll("{{overturns}}", "3")
    .replaceAll("{{totalQuestions}}", "15")
    .replaceAll("{{missedCount}}", "2")
    .replaceAll("{{missedQuestions}}", "Q1, Q7")
    .replaceAll("{{recordId}}", "123456")
    .replaceAll("{{findingId}}", "f-abc123")
    .replaceAll("{{reportUrl}}", "#")
    .replaceAll("{{recordingUrl}}", "#")
    .replaceAll("{{appealUrl}}", "#")
    .replaceAll("{{crmUrl}}", "#")
    .replaceAll("{{feedbackText}}", "Great call overall!")
    .replaceAll("{{scoreVerbiage}}", "excellent")
    .replaceAll("{{supervisorEmail}}", "supervisor@example.com")
    .replaceAll("{{judgedBy}}", "judge@example.com");
}

function buildTemplateUrls(origin: string, orgId: string, templateId: string) {
  const base = `${origin}/webhooks/audit-complete?org=${encodeURIComponent(orgId)}&template=${encodeURIComponent(templateId)}`;
  return { live: base, test: `${base}&test=YOUR_EMAIL` };
}

export async function renderTemplatesModal(
  req: Request,
  opts: { activeId?: string; isNew?: boolean } = {},
): Promise<Response> {
  const { activeId, isNew } = opts;

  let templates: Template[] = [];
  try {
    const d = await apiFetch<{ templates?: Template[] } | Template[]>("/admin/email-templates", req);
    templates = Array.isArray(d) ? d : (d.templates ?? []);
  } catch {}

  const active = activeId ? templates.find(t => t.id === activeId) : null;
  const showEditor = isNew || !!active;

  // Build webhook URLs using request origin. orgId is best-effort; the email
  // engine resolves the real orgId at send time from the `org=` query param.
  const origin = new URL(req.url).origin;
  const urls = active?.id ? buildTemplateUrls(origin, "YOUR_ORG_ID", active.id) : null;

  const previewHtml = active?.html ? injectPreviewDefaults(active.html) : "";

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

                {/* Template ID + Live URL + Test URL info panel (shown after save/load) */}
                {active?.id && urls && (
                  <div style="padding:8px 12px;background:var(--bg);border-bottom:1px solid var(--border);flex-shrink:0;">
                    <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;">
                      <span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);white-space:nowrap;">Template ID</span>
                      <code style="font-size:10px;color:var(--cyan);background:var(--cyan-bg);padding:2px 7px;border-radius:4px;font-family:var(--mono);word-break:break-all;flex:1;">{active.id}</code>
                      <button type="button" data-copy={active.id} style="font-size:9px;padding:2px 8px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--text-muted);cursor:pointer;white-space:nowrap;">Copy ID</button>
                    </div>
                    <div style="display:flex;align-items:flex-start;gap:6px;margin-bottom:4px;">
                      <span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--green);white-space:nowrap;line-height:1.8;">Live URL</span>
                      <code style="font-size:9px;color:var(--text-muted);word-break:break-all;flex:1;line-height:1.6;">{urls.live}</code>
                      <button type="button" data-copy={urls.live} style="font-size:9px;padding:2px 8px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--text-muted);cursor:pointer;white-space:nowrap;">Copy</button>
                    </div>
                    <div style="display:flex;align-items:flex-start;gap:6px;">
                      <span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--yellow);white-space:nowrap;line-height:1.8;">Test URL</span>
                      <code style="font-size:9px;color:var(--text-muted);word-break:break-all;flex:1;line-height:1.6;">{urls.test}</code>
                      <button type="button" data-copy={urls.test} style="font-size:9px;padding:2px 8px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--text-muted);cursor:pointer;white-space:nowrap;">Copy</button>
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
              <div style="flex:1;overflow:auto;padding:0;background:#fff;">
                {previewHtml ? (
                  <iframe
                    srcDoc={previewHtml}
                    style="width:100%;height:100%;border:none;background:#fff;display:block;"
                    sandbox="allow-same-origin"
                  ></iframe>
                ) : (
                  <div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-dim);font-size:11px;background:var(--bg);">
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
}

export const handler = define.handlers({
  GET(ctx) {
    const url = new URL(ctx.req.url);
    return renderTemplatesModal(ctx.req, {
      activeId: url.searchParams.get("id") ?? undefined,
      isNew: url.searchParams.get("new") === "1",
    });
  },
});
