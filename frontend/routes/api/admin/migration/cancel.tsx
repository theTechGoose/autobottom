/** HTMX fragment: request job cancellation; replies with status fragment. */
import { define } from "../../../../lib/define.ts";
import { apiPost } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

export const handler = define.handlers({
  async POST(ctx) {
    const body = await ctx.req.json().catch(() => ({}));
    const jobId = body?.jobId as string | undefined;
    if (!jobId) {
      return new Response(`<div class="error-text">missing jobId</div>`, { headers: { "content-type": "text/html" } });
    }
    try {
      await apiPost("/admin/migration/cancel", ctx.req, { jobId });
    } catch (e) {
      return new Response(`<div class="error-text">cancel failed: ${String(e)}</div>`, { headers: { "content-type": "text/html" } });
    }
    // Re-render status; it'll show "cancelled" on next poll.
    return new Response(
      renderToString(
        <div
          id={`mig-job-${jobId}`}
          hx-get={`/api/admin/migration/status?jobId=${encodeURIComponent(jobId)}`}
          hx-trigger="load delay:500ms"
          hx-swap="outerHTML"
          style="border:1px solid var(--border);border-radius:6px;padding:10px;background:var(--bg);font-size:11px;color:var(--text-dim);"
        >
          cancellation requested…
        </div>,
      ),
      { headers: { "content-type": "text/html" } },
    );
  },
});
