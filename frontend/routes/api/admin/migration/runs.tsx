/** HTMX fragment: persistent list of recent migration jobs.
 *
 *  GET /api/admin/migration/runs → renders <div id="mig-runs"> with the
 *  last 24h of migration jobs (newest first), each as a fully-rendered
 *  JobView card. Running jobs self-poll their /status every 2s; done /
 *  cancelled / errored jobs render their final state statically. The outer
 *  div fetches itself on `load` (panel-open) only — running jobs handle
 *  their own live updates via the existing /status polling. */
import { define } from "../../../../lib/define.ts";
import { apiFetch } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import type { VNode } from "preact";
import { JobView } from "./status.tsx";
import type { JobView as JobViewT } from "./status.tsx";

interface JobsResponse {
  ok: boolean;
  jobs?: JobViewT[];
  error?: string;
}

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export const handler = define.handlers({
  async GET(ctx) {
    let r: JobsResponse;
    try {
      r = await apiFetch<JobsResponse>("/admin/migration/jobs", ctx.req);
    } catch (e) {
      return html(
        <div id="mig-runs" style="padding:10px;border:1px dashed var(--border);border-radius:6px;color:var(--text-dim);font-size:11px;">
          jobs fetch failed: {String(e)}
        </div>,
      );
    }
    if (!r.ok || !r.jobs) {
      return html(
        <div id="mig-runs" style="padding:10px;border:1px dashed var(--border);border-radius:6px;color:var(--text-dim);font-size:11px;">
          jobs fetch error: {r.error ?? "unknown"}
        </div>,
      );
    }

    const cutoff = Date.now() - TWENTY_FOUR_HOURS_MS;
    const recent = r.jobs.filter((j) => j.startedAt >= cutoff);

    return html(
      <div
        id="mig-runs"
        hx-get="/api/admin/migration/runs"
        hx-trigger="every 30s"
        hx-swap="outerHTML"
        style="display:flex;flex-direction:column;gap:10px;margin-top:10px;"
      >
        {recent.length === 0 && (
          <div style="padding:10px;border:1px dashed var(--border);border-radius:6px;color:var(--text-dim);font-size:11px;text-align:center;">
            no migration jobs in the last 24h
          </div>
        )}
        {recent.map((j) => <JobView j={j} />)}
      </div>,
    );
  },
});

function html(el: VNode): Response {
  return new Response(renderToString(el), { headers: { "content-type": "text/html" } });
}
