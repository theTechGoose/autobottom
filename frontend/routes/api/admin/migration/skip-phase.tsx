/** HTMX fragment: manually advance a verify-repair job's phase. Used to
 *  unstick jobs whose phase didn't persist its advance (race / OOM). */
import { define } from "../../../../lib/define.ts";
import { apiPost } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

export const handler = define.handlers({
  async POST(ctx) {
    let jobId: string | undefined;
    let phase: string | undefined;
    const ct = ctx.req.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const body = await ctx.req.json().catch(() => ({}));
      const b = body as Record<string, unknown>;
      jobId = b.jobId as string | undefined;
      phase = b.phase as string | undefined;
    } else {
      const form = await ctx.req.formData().catch(() => null);
      jobId = form?.get("jobId")?.toString();
      phase = form?.get("phase")?.toString();
    }
    if (!jobId || !phase) {
      return new Response(`<div class="error-text">missing jobId or phase</div>`, { headers: { "content-type": "text/html" } });
    }
    try {
      await apiPost("/admin/migration/skip-phase", ctx.req, { jobId, phase });
    } catch (e) {
      return new Response(`<div class="error-text">skip-phase failed: ${String(e)}</div>`, { headers: { "content-type": "text/html" } });
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
          advanced to {phase} — refreshing…
        </div>,
      ),
      { headers: { "content-type": "text/html" } },
    );
  },
});
