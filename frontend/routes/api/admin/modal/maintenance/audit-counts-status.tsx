/** Status-polling fragment for an audit-counts background job. The kick-off
 *  panel in [audit-counts.tsx] embeds this with hx-trigger="every 4s" until
 *  the job's status flips to complete or error. Self-disables polling on
 *  terminal states so we don't keep hammering the endpoint forever. */

import { define } from "../../../../../lib/define.ts";
import { apiFetch } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

interface StatusResp {
  ok?: boolean;
  error?: string;
  id?: string;
  email?: string;
  status?: "running" | "complete" | "error";
  ticks?: number;
  rowsScanned?: number;
  chunkZeroSeen?: number;
  packagesUnique?: number;
  dateLegsUnique?: number;
  startedAt?: number;
  completedAt?: number;
}

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const jobId = url.searchParams.get("jobId") ?? "";
    if (!jobId) {
      return new Response(
        renderToString(
          <div style="font-size:11px;color:var(--red);">missing jobId</div>,
        ),
        { headers: { "content-type": "text/html" } },
      );
    }
    let r: StatusResp;
    try {
      r = await apiFetch<StatusResp>(`/admin/audit-counts/status?jobId=${encodeURIComponent(jobId)}`, ctx.req);
    } catch (e) {
      return new Response(
        renderToString(
          <div
            id={`acj-status-${jobId}`}
            style="font-size:11px;color:var(--red);padding:8px;background:var(--bg-2);border:1px solid var(--red);border-radius:5px;"
          >
            Status check failed: {String((e as Error).message ?? e)}
          </div>,
        ),
        { headers: { "content-type": "text/html" } },
      );
    }

    const fmt = (n: number | undefined) => (n == null ? "—" : n.toLocaleString());
    const elapsedSec = r.startedAt
      ? Math.round(((r.completedAt ?? Date.now()) - r.startedAt) / 1000)
      : 0;

    // Terminal states stop the polling by NOT including hx-trigger.
    if (r.status === "complete") {
      return new Response(
        renderToString(
          <div
            id={`acj-status-${jobId}`}
            style="font-size:11px;color:var(--text);padding:8px;background:rgba(46,160,67,0.1);border:1px solid var(--green);border-radius:5px;"
          >
            <div style="font-weight:700;color:var(--green);margin-bottom:4px;">✓ Deep scan complete</div>
            <div>
              {fmt(r.packagesUnique)} packages · {fmt(r.dateLegsUnique)} date-legs
              · {fmt((r.packagesUnique ?? 0) + (r.dateLegsUnique ?? 0))} total
            </div>
            <div style="color:var(--text-dim);margin-top:4px;">
              Walked {fmt(r.rowsScanned)} keys ({fmt(r.chunkZeroSeen)} chunk-0 bodies decoded)
              across {r.ticks ?? 0} ticks in {elapsedSec}s. Email sent to {r.email ?? "(unknown)"}.
            </div>
          </div>,
        ),
        { headers: { "content-type": "text/html" } },
      );
    }

    if (r.status === "error") {
      return new Response(
        renderToString(
          <div
            id={`acj-status-${jobId}`}
            style="font-size:11px;color:var(--text);padding:8px;background:rgba(248,81,73,0.1);border:1px solid var(--red);border-radius:5px;"
          >
            <div style="font-weight:700;color:var(--red);margin-bottom:4px;">✗ Deep scan failed</div>
            <div style="color:var(--text-dim);">
              Failed after {r.ticks ?? 0} ticks. An error email was attempted to {r.email ?? "(unknown)"}.
            </div>
          </div>,
        ),
        { headers: { "content-type": "text/html" } },
      );
    }

    // Running — keep polling.
    return new Response(
      renderToString(
        <div
          id={`acj-status-${jobId}`}
          hx-get={`/api/admin/modal/maintenance/audit-counts-status?jobId=${encodeURIComponent(jobId)}`}
          hx-trigger="every 4s"
          hx-swap="outerHTML"
          style="font-size:11px;color:var(--text-dim);padding:8px;background:var(--bg-2);border:1px solid var(--border);border-radius:5px;"
        >
          <div>
            Status: <span style="color:var(--yellow);">running</span> · tick {r.ticks ?? 0} · {elapsedSec}s elapsed
          </div>
          <div style="margin-top:3px;">
            So far: {fmt(r.packagesUnique)} packages · {fmt(r.dateLegsUnique)} date-legs ·
            {" "}{fmt(r.rowsScanned)} keys walked
          </div>
        </div>,
      ),
      { headers: { "content-type": "text/html" } },
    );
  },
});
