/** HTMX fragment: kick off a migration run; returns a polling status block. */
import { define } from "../../../../lib/define.ts";
import { apiPost } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import type { VNode } from "preact";

interface RunResponse {
  ok: boolean;
  jobId?: string;
  message?: string;
  error?: string;
  opts?: Record<string, unknown>;
}

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const typesRaw = form.get("types")?.toString().trim() ?? "";
    const types = typesRaw ? typesRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];
    const since = form.get("since")?.toString().trim();
    const until = form.get("until")?.toString().trim();
    const dryRun = form.get("dryRun") === "on" || form.get("dryRun") === "true";
    const sinceVs = form.get("sinceVersionstamp")?.toString().trim();
    const mode = form.get("mode")?.toString().trim();

    const body: Record<string, unknown> = { dryRun };
    if (types.length > 0) body.types = types;
    // Pass date strings (YYYY-MM-DD) through verbatim — backend's
    // parseDateOrMs handles both ms-numbers and ISO dates. Don't Number()
    // a date string; that yields NaN and silently drops the filter.
    if (since) body.since = since;
    if (until) body.until = until;
    if (sinceVs) body.sinceVersionstamp = sinceVs;
    if (mode === "index-driven" || mode === "scan") body.mode = mode;

    let r: RunResponse;
    try {
      r = await apiPost<RunResponse>("/admin/migration/run", ctx.req, body);
    } catch (e) {
      return html(<div class="error-text">Failed to start: {String(e)}</div>);
    }
    if (!r.ok || !r.jobId) {
      return html(<div class="error-text">Cannot start: {r.error ?? "unknown error"}</div>);
    }
    return html(<JobStatusFragment jobId={r.jobId} initial />);
  },
});

export function JobStatusFragment(props: { jobId: string; initial?: boolean }) {
  return (
    <div
      id={`mig-job-${props.jobId}`}
      hx-get={`/api/admin/migration/status?jobId=${encodeURIComponent(props.jobId)}`}
      hx-trigger="load delay:2s"
      hx-swap="outerHTML"
      style="border:1px solid var(--border);border-radius:6px;padding:10px;background:var(--bg);"
    >
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <span style="font-family:monospace;font-size:11px;color:var(--text-dim);">{props.jobId}</span>
          {props.initial && <span style="margin-left:8px;color:var(--blue);font-size:11px;">starting…</span>}
        </div>
        <button
          class="sf-btn ghost"
          style="padding:4px 10px;font-size:11px;"
          hx-post="/api/admin/migration/cancel"
          hx-vals={`{"jobId":"${props.jobId}"}`}
          hx-target={`#mig-job-${props.jobId}`}
          hx-swap="outerHTML"
        >Cancel</button>
      </div>
    </div>
  );
}

function html(el: VNode): Response {
  return new Response(renderToString(el), { headers: { "content-type": "text/html" } });
}
