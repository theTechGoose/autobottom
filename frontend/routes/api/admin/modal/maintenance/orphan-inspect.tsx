/** HTMX fragment: inspect a single audit-finding to see if it looks like
 *  migration debris. Calls /admin/debug/orphan-inspect (header-only read,
 *  doesn't trigger the chunked-read wedge) and renders a compact summary
 *  panel inline in the bulk-flip view. */
import { define } from "../../../../../lib/define.ts";
import { apiFetch } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import type { VNode } from "preact";

interface InspectResp {
  findingId?: string;
  headerExists?: boolean;
  verdict?: string;
  flags?: string[];
  findingStatus?: string;
  completedAt?: number;
  completedAtIso?: string | null;
  reviewedAt?: string;
  reviewScore?: number;
  owner?: string;
  recordFieldCount?: number;
  answeredQuestionsCount?: number;
  transcriptInline?: boolean;
  transcriptChunked?: boolean;
  recordSample?: Record<string, unknown> | null;
  inReviewDone?: boolean;
  reviewDoneAt?: string | null;
  error?: string;
  detail?: string;
}

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const id = url.searchParams.get("id")?.trim() ?? "";
    if (!id) {
      return html(<div class="error-text" style="font-size:11px;">Missing id parameter.</div>);
    }
    let r: InspectResp;
    try {
      r = await apiFetch<InspectResp>(`/admin/debug/orphan-inspect?id=${encodeURIComponent(id)}`, ctx.req);
    } catch (e) {
      return html(<div class="error-text" style="font-size:11px;">Inspect failed: {String(e)}</div>);
    }
    if (r.error) {
      return html(
        <div style="font-size:11px;color:var(--red);padding:10px;border:1px solid rgba(248,81,73,0.3);background:rgba(248,81,73,0.05);border-radius:6px;">
          <div style="font-weight:700;margin-bottom:4px;">Inspect error for {id}</div>
          <div style="color:var(--text-dim);">{r.error}{r.detail ? `: ${r.detail}` : ""}</div>
        </div>
      );
    }
    return html(<InspectPanel r={r} />);
  },
});

function InspectPanel({ r }: { r: InspectResp }) {
  const verdictColor = r.verdict === "LOOKS NORMAL"
    ? "var(--green)"
    : r.verdict === "LIKELY MIGRATION CASUALTY"
      ? "var(--red)"
      : "var(--yellow)";
  const fieldStyle = "padding:2px 6px;font-size:11px;color:var(--text-dim);";
  const valStyle = "padding:2px 6px;font-size:11px;color:var(--text-bright);font-family:var(--mono);";
  return (
    <div style={`padding:12px 14px;border:1px solid var(--border);background:var(--bg-raised);border-radius:6px;`}>
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
        <div style="font-size:12px;color:var(--text-dim);">
          Inspect <code style="color:var(--text-bright);">{r.findingId}</code>
        </div>
        <div style={`font-size:11px;font-weight:700;color:${verdictColor};text-transform:uppercase;letter-spacing:0.5px;`}>
          {r.verdict}
        </div>
      </div>

      {r.flags && r.flags.length > 0 && (
        <div style="margin-bottom:10px;padding:8px 10px;background:rgba(248,81,73,0.04);border-left:2px solid var(--red);border-radius:3px;">
          <div style="font-size:10px;font-weight:700;color:var(--red);text-transform:uppercase;margin-bottom:4px;">Issues</div>
          {r.flags.map((f) => (
            <div style="font-size:11px;color:var(--text-bright);">• {f}</div>
          ))}
        </div>
      )}

      <table style="width:100%;border-collapse:collapse;">
        <tbody>
          <tr><td style={fieldStyle}>Status</td><td style={valStyle}>{r.findingStatus ?? "—"}</td></tr>
          <tr><td style={fieldStyle}>Completed</td><td style={valStyle}>{r.completedAtIso ?? "—"}</td></tr>
          <tr><td style={fieldStyle}>Reviewed at</td><td style={valStyle}>{r.reviewedAt ?? "—"}</td></tr>
          <tr><td style={fieldStyle}>Review score</td><td style={valStyle}>{r.reviewScore ?? "—"}</td></tr>
          <tr><td style={fieldStyle}>Owner</td><td style={valStyle}>{r.owner ?? "—"}</td></tr>
          <tr><td style={fieldStyle}>Record fields</td><td style={valStyle}>{r.recordFieldCount ?? 0}</td></tr>
          <tr><td style={fieldStyle}>Answered Qs</td><td style={valStyle}>{r.answeredQuestionsCount ?? 0}</td></tr>
          <tr><td style={fieldStyle}>Transcript</td><td style={valStyle}>{r.transcriptInline ? "inline" : r.transcriptChunked ? "chunked" : "MISSING"}</td></tr>
          <tr><td style={fieldStyle}>In review-done?</td><td style={valStyle}>{r.inReviewDone ? "yes" : "no"}</td></tr>
          {r.recordSample && (
            <tr>
              <td style={fieldStyle}>Record sample</td>
              <td style={valStyle}>
                {Object.entries(r.recordSample)
                  .filter(([_, v]) => v != null && v !== "")
                  .map(([k, v]) => `${k}=${String(v)}`)
                  .join(", ") || <span style="color:var(--text-dim);">(empty)</span>}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function html(el: VNode): Response {
  return new Response(renderToString(el), { headers: { "content-type": "text/html" } });
}
