/** HTMX fragment: manually drive one tick on a running migration job.
 *  Fallback for when Deno Deploy's cron scheduler isn't reliably firing
 *  our migration-tick. Each click = one tick = ~10s of work. Returns
 *  the refreshed status fragment so the operator sees progress immediately. */
import { define } from "../../../../lib/define.ts";
import { apiPost } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

export const handler = define.handlers({
  async POST(ctx) {
    let jobId: string | undefined;
    const ct = ctx.req.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const body = await ctx.req.json().catch(() => ({}));
      jobId = (body as Record<string, unknown>)?.jobId as string | undefined;
    } else {
      const form = await ctx.req.formData().catch(() => null);
      jobId = form?.get("jobId")?.toString();
    }
    if (!jobId) {
      return new Response(`<div class="error-text">missing jobId</div>`, { headers: { "content-type": "text/html" } });
    }
    try {
      await apiPost("/admin/migration/tick-now", ctx.req, { jobId });
    } catch (e) {
      return new Response(`<div class="error-text">tick-now failed: ${String(e)}</div>`, { headers: { "content-type": "text/html" } });
    }
    // Re-fetch the status fragment so the user sees the post-tick state.
    return new Response(
      renderToString(
        <div
          id={`mig-job-${jobId}`}
          hx-get={`/api/admin/migration/status?jobId=${encodeURIComponent(jobId)}`}
          hx-trigger="load"
          hx-swap="outerHTML"
          style="border:1px solid var(--border);border-radius:6px;padding:10px;background:var(--bg);font-size:11px;color:var(--text-dim);"
        >
          tick complete — refreshing…
        </div>,
      ),
      { headers: { "content-type": "text/html" } },
    );
  },
});
