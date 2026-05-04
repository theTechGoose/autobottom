/** HTMX fragment: re-arm an errored migration job. Returns a status fragment
 *  that re-polls so the operator sees the running state come back. */
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
      await apiPost("/admin/migration/resume", ctx.req, { jobId });
    } catch (e) {
      return new Response(`<div class="error-text">resume failed: ${String(e)}</div>`, { headers: { "content-type": "text/html" } });
    }
    return new Response(
      renderToString(
        <div
          id={`mig-job-${jobId}`}
          hx-get={`/api/admin/migration/status?jobId=${encodeURIComponent(jobId)}`}
          hx-trigger="load delay:500ms"
          hx-swap="outerHTML"
          style="border:1px solid var(--border);border-radius:6px;padding:10px;background:var(--bg);font-size:11px;color:var(--text-dim);"
        >
          resumed — waiting for first tick…
        </div>,
      ),
      { headers: { "content-type": "text/html" } },
    );
  },
});
