/** HTMX fragment: poll job status. Self-replacing — re-emits a polling fragment
 *  while running, swaps to a final summary when done/cancelled/error. */
import { define } from "../../../../lib/define.ts";
import { apiFetch } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import type { VNode } from "preact";

interface JobView {
  jobId: string;
  startedAt: number;
  endedAt: number | null;
  status: "running" | "done" | "cancelled" | "error";
  cancelled: boolean;
  scanned: number;
  written: number;
  writtenChunked: number;
  skipped: number;
  errorCount: number;
  errors: string[];
  message: string;
  elapsedMs: number;
  opts: Record<string, unknown>;
}

interface StatusResponse {
  ok: boolean;
  job?: JobView;
  error?: string;
}

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const jobId = url.searchParams.get("jobId") ?? "";
    if (!jobId) return html(<div class="error-text">missing jobId</div>);

    let r: StatusResponse;
    try {
      r = await apiFetch<StatusResponse>(`/admin/migration/status?jobId=${encodeURIComponent(jobId)}`, ctx.req);
    } catch (e) {
      return html(<div class="error-text">status fetch failed: {String(e)}</div>);
    }
    if (!r.ok || !r.job) {
      return html(
        <div id={`mig-job-${jobId}`} class="error-text" style="padding:10px;border:1px solid var(--border);border-radius:6px;">
          job lost: {r.error ?? "unknown"}
        </div>,
      );
    }
    const j = r.job;
    return html(<JobView j={j} />);
  },
});

function statusColor(s: JobView["status"]): string {
  if (s === "done") return "var(--green)";
  if (s === "error") return "var(--red)";
  if (s === "cancelled") return "var(--text-dim)";
  return "var(--blue)";
}

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s - m * 60}s`;
}

function JobView({ j }: { j: JobView }) {
  const isRunning = j.status === "running";
  const id = `mig-job-${j.jobId}`;
  const pollAttrs = isRunning
    ? {
      "hx-get": `/api/admin/migration/status?jobId=${encodeURIComponent(j.jobId)}`,
      "hx-trigger": "load delay:2s",
      "hx-swap": "outerHTML",
    }
    : {};

  return (
    <div
      id={id}
      {...pollAttrs}
      style="border:1px solid var(--border);border-radius:6px;padding:10px;background:var(--bg);"
    >
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <div>
          <span style={`color:${statusColor(j.status)};font-weight:700;font-size:12px;text-transform:uppercase;`}>{j.status}</span>
          <span style="margin-left:10px;font-family:monospace;font-size:11px;color:var(--text-dim);">{j.jobId}</span>
          <span style="margin-left:10px;font-size:11px;color:var(--text-dim);">{fmtElapsed(j.elapsedMs)}</span>
        </div>
        {isRunning && (
          <button
            class="sf-btn ghost"
            style="padding:4px 10px;font-size:11px;"
            hx-post="/api/admin/migration/cancel"
            hx-vals={`{"jobId":"${j.jobId}"}`}
            hx-target={`#${id}`}
            hx-swap="outerHTML"
          >Cancel</button>
        )}
      </div>
      <div style="display:grid;grid-template-columns:repeat(5, 1fr);gap:8px;font-size:11px;margin-bottom:6px;">
        <Stat label="Scanned" v={j.scanned} />
        <Stat label="Written" v={j.written} />
        <Stat label="Chunked" v={j.writtenChunked} />
        <Stat label="Skipped" v={j.skipped} dim />
        <Stat label="Errors" v={j.errorCount} dim={j.errorCount === 0} red={j.errorCount > 0} />
      </div>
      <div style="font-size:11px;color:var(--text-dim);">{j.message}</div>
      {j.errors.length > 0 && (
        <details style="margin-top:6px;">
          <summary style="font-size:11px;color:var(--red);cursor:pointer;">{j.errors.length} recent errors</summary>
          <ul style="font-size:10px;color:var(--text-dim);margin:4px 0 0 14px;font-family:monospace;">
            {j.errors.map((e) => <li>{e}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

function Stat({ label, v, dim, red }: { label: string; v: number; dim?: boolean; red?: boolean }) {
  const c = red ? "var(--red)" : dim ? "var(--text-dim)" : "var(--text-bright)";
  return (
    <div>
      <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;">{label}</div>
      <div style={`font-size:14px;font-weight:700;color:${c};`}>{v.toLocaleString()}</div>
    </div>
  );
}

function html(el: VNode): Response {
  return new Response(renderToString(el), { headers: { "content-type": "text/html" } });
}
