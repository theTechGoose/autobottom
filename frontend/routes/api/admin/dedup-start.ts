/** Kick off a dedup job and return the initial progress fragment.
 *  Replaces the dedup panel's previous hit on the generic config-save
 *  endpoint, which kept the HTTP request open for the entire 5-10 minute
 *  dedup duration with no UI feedback. Now the backend returns a jobId
 *  immediately, the modal swaps in a progress fragment, and the fragment
 *  self-polls /api/admin/dedup-progress until the job finishes. */
import { define } from "../../../lib/define.ts";
import { apiPost, parseHtmxBody } from "../../../lib/api.ts";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export const handler = define.handlers({
  async POST(ctx) {
    try {
      const body = await parseHtmxBody(ctx.req);
      const result = await apiPost<{ ok?: boolean; jobId?: string; error?: string; message?: string }>(
        "/admin/deduplicate-findings", ctx.req, body,
      );
      if (!result.ok || !result.jobId) {
        const msg = escapeHtml(result.error ?? "Failed to start dedup");
        return new Response(`<span class="error-text">${msg}</span>`, { headers: { "content-type": "text/html" } });
      }
      // Initial progress fragment — self-polls every 2s until phase=done|error.
      const html = `<div id="maint-progress" hx-get="/api/admin/dedup-progress?jobId=${encodeURIComponent(result.jobId)}" hx-trigger="load delay:1s" hx-swap="outerHTML" style="font-size:12px;color:var(--text-dim);display:grid;gap:6px;">
        <div><strong>${escapeHtml(result.message ?? "Started")}</strong> — scanning…</div>
      </div>`;
      return new Response(html, { headers: { "content-type": "text/html" } });
    } catch (e) {
      return new Response(`<span class="error-text">${escapeHtml(String(e))}</span>`, { headers: { "content-type": "text/html" } });
    }
  },
});
