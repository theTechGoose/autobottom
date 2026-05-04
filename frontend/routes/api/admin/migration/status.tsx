/** HTMX fragment: poll job status. Self-replacing — re-emits a polling fragment
 *  while running, swaps to a final summary when done/cancelled/error. */
import { define } from "../../../../lib/define.ts";
import { apiFetch } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import type { VNode } from "preact";

export interface VerifyBucketView {
  type: string;
  org: string;
  prodCount: number;
  fsCount: number;
  isChunked: boolean;
  status: "pending" | "counted" | "sampling" | "sampled" | "verified" | "mismatched" | "repairing" | "repaired" | "error";
  sampled: number;
  matchedSamples: number;
  repairedCount: number;
  matchedCount: number;
  mismatchExamples: string[];
  errors: string[];
}

export interface JobView {
  jobId: string;
  startedAt: number;
  endedAt: number | null;
  status: "running" | "done" | "cancelled" | "error";
  cancelled: boolean;
  phase?: "init" | "scanning" | "index-walk" | "chunked" | "writing" | "done"
        | "prod-count" | "fs-count" | "diff" | "sample" | "repair";
  scanned: number;
  written: number;
  writtenChunked: number;
  skipped: number;
  chunkedQueueSize?: number;
  chunkedQueueProcessed?: number;
  byType?: Record<string, { count: number; chunkedCount: number }>;
  knownOrgs?: string[];
  scanPrefixesTotal?: number;
  scanPrefixIdx?: number;
  errorCount: number;
  errors: string[];
  message: string;
  elapsedMs: number;
  opts: Record<string, unknown>;
  // Verify-repair only:
  verifyBuckets?: Record<string, VerifyBucketView>;
  verifyMatched?: number;
  verifyRepaired?: number;
  prodScanPageNum?: number;
  // Live activity log — newest entries last
  logTail?: string[];
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

export function JobView({ j }: { j: JobView }) {
  const isRunning = j.status === "running";
  const id = `mig-job-${j.jobId}`;
  const pollAttrs = isRunning
    ? {
      "hx-get": `/api/admin/migration/status?jobId=${encodeURIComponent(j.jobId)}`,
      "hx-trigger": "load delay:2s",
      "hx-swap": "outerHTML",
    }
    : {};
  const isVerify = (j.opts?.mode === "verify-repair");

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
          {isVerify && <span style="margin-left:10px;padding:2px 8px;background:rgba(34,197,94,0.12);color:#22c55e;border:1px solid rgba(34,197,94,0.3);border-radius:4px;font-size:10px;font-weight:700;">VERIFY</span>}
        </div>
        {isRunning && (
          <button
            class="sf-btn primary"
            style="padding:4px 10px;font-size:11px;margin-right:6px;"
            hx-post="/api/admin/migration/tick-now"
            hx-vals={`{"jobId":"${j.jobId}"}`}
            hx-target={`#${id}`}
            hx-swap="outerHTML"
            title="Manually drive one tick (~10s of work). Use when cron isn't reliably firing."
          >👆 Tick Now</button>
        )}
        {isRunning && isVerify && j.phase === "prod-count" && (
          <button
            class="sf-btn ghost"
            style="padding:4px 10px;font-size:11px;margin-right:6px;"
            hx-post="/api/admin/migration/skip-phase"
            hx-vals={`{"jobId":"${j.jobId}","phase":"fs-count"}`}
            hx-target={`#${id}`}
            hx-swap="outerHTML"
            hx-confirm="Skip to fs-count? Use this only if all buckets show prod counts and prod-count is wedged."
            title="Manually advance phase to fs-count. Use when prod-count is stuck but all buckets are discovered."
          >⏭ Skip to fs-count</button>
        )}
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
        {j.status === "error" && (
          <button
            class="sf-btn primary"
            style="padding:4px 10px;font-size:11px;"
            hx-post="/api/admin/migration/resume"
            hx-vals={`{"jobId":"${j.jobId}"}`}
            hx-target={`#${id}`}
            hx-swap="outerHTML"
            hx-confirm="Resume this errored job from saved cursor?"
            title="Re-arm this job so the cron picks it up. Cursor + bucket state are preserved — no work is repeated."
          >▶ Resume</button>
        )}
      </div>
      {isVerify ? (
        <VerifyView j={j} />
      ) : (
      <div style="display:grid;grid-template-columns:repeat(5, 1fr);gap:8px;font-size:11px;margin-bottom:6px;">
        <Stat label="Scanned" v={j.scanned} />
        <Stat label="Written" v={j.written} />
        <Stat label="Chunked" v={j.writtenChunked} />
        <Stat label="Skipped" v={j.skipped} dim />
        <Stat label="Errors" v={j.errorCount} dim={j.errorCount === 0} red={j.errorCount > 0} />
      </div>
      )}
      <div style="font-size:11px;color:var(--text-dim);">
        {j.phase && <span style="display:inline-block;padding:1px 6px;background:var(--border);border-radius:3px;color:var(--text-bright);font-family:monospace;font-size:10px;text-transform:uppercase;margin-right:6px;">{j.phase}</span>}
        {typeof j.scanPrefixIdx === "number" && typeof j.scanPrefixesTotal === "number" && j.scanPrefixesTotal > 0 && j.phase === "scanning" && (
          <span style="margin-right:6px;">prefix {j.scanPrefixIdx + 1}/{j.scanPrefixesTotal}</span>
        )}
        {j.phase === "chunked" && typeof j.chunkedQueueProcessed === "number" && typeof j.chunkedQueueSize === "number" && (
          <span style="margin-right:6px;">chunked {j.chunkedQueueProcessed}/{j.chunkedQueueSize}</span>
        )}
        {j.message}
      </div>
      {j.byType && Object.keys(j.byType).length > 0 && (
        <details open style="margin-top:6px;">
          <summary style="font-size:11px;color:var(--text-dim);cursor:pointer;">Per-type counters ({Object.keys(j.byType).length})</summary>
          <table style="width:100%;font-size:10px;font-family:monospace;margin-top:4px;border-collapse:collapse;">
            <thead>
              <tr style="color:var(--text-dim);text-align:left;">
                <th style="padding:2px 6px;">Type</th>
                <th style="padding:2px 6px;text-align:right;">Simple</th>
                <th style="padding:2px 6px;text-align:right;">Chunked</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(j.byType).sort(([, a], [, b]) => (b.count + b.chunkedCount) - (a.count + a.chunkedCount)).map(([type, c]) => (
                <tr style="border-top:1px solid var(--border-soft);">
                  <td style="padding:2px 6px;color:var(--text-bright);">{type}</td>
                  <td style="padding:2px 6px;text-align:right;">{c.count.toLocaleString()}</td>
                  <td style="padding:2px 6px;text-align:right;">{c.chunkedCount.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      {j.logTail && j.logTail.length > 0 && (
        <LogTail lines={j.logTail} open={isRunning} />
      )}
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

/** Rolling activity log — newest 30 lines, monospace, dark scrollable panel.
 *  Scrolls to the bottom on each render so the freshest line stays visible. */
function LogTail({ lines, open }: { lines: string[]; open: boolean }) {
  const recent = lines.slice(-30);
  return (
    <details open={open} style="margin-top:6px;">
      <summary style="font-size:11px;color:var(--text-dim);cursor:pointer;">
        Activity log ({lines.length} lines, showing last {recent.length})
      </summary>
      <div
        style="max-height:240px;overflow-y:auto;background:#0a0e17;border:1px solid var(--border);border-radius:4px;padding:6px 8px;margin-top:4px;font-family:monospace;font-size:10.5px;line-height:1.5;color:var(--text);"
      >
        {recent.map((line) => (
          <div style="white-space:pre-wrap;word-break:break-all;">{line}</div>
        ))}
      </div>
    </details>
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

/** Live grid for verify-repair runs — phase progress + per-bucket table.
 *  Rows sorted by status: in-flight first → pending → done last, so the
 *  active work stays at the top while the operator watches. */
function VerifyView({ j }: { j: JobView }) {
  const buckets = j.verifyBuckets ? Object.values(j.verifyBuckets) : [];
  const total = buckets.length;
  const verified = buckets.filter((b) => b.status === "verified" || b.status === "repaired").length;
  const inFlight = buckets.filter((b) => b.status === "sampling" || b.status === "repairing").length;
  const pending = buckets.filter((b) => b.status === "pending" || b.status === "counted").length;
  const errored = buckets.filter((b) => b.status === "error").length;
  const pct = total > 0 ? Math.round((verified / total) * 100) : 0;

  const sorted = buckets.slice().sort((a, b) => statusRank(a.status) - statusRank(b.status));

  return (
    <>
      <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:8px;font-size:11px;margin-bottom:6px;">
        <Stat label="Buckets" v={total} />
        <Stat label="Verified" v={verified} />
        <Stat label="Matched" v={j.verifyMatched ?? 0} />
        <Stat label="Repaired" v={j.verifyRepaired ?? 0} red={(j.verifyRepaired ?? 0) > 0} />
      </div>
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;">
        {j.phase && <span style="display:inline-block;padding:1px 6px;background:var(--border);border-radius:3px;color:var(--text-bright);font-family:monospace;font-size:10px;text-transform:uppercase;margin-right:6px;">{j.phase}</span>}
        {inFlight > 0 && <span style="margin-right:8px;color:var(--blue);">⏳ {inFlight} in-flight</span>}
        {pending > 0 && <span style="margin-right:8px;">{pending} pending</span>}
        {errored > 0 && <span style="margin-right:8px;color:var(--red);">{errored} errored</span>}
        {j.message}
      </div>
      <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden;margin-bottom:10px;">
        <div style={`height:100%;width:${pct}%;background:var(--green);transition:width 0.3s;`} />
      </div>
      {sorted.length > 0 && (
        <details open style="margin-top:6px;">
          <summary style="font-size:11px;color:var(--text-dim);cursor:pointer;">Buckets ({sorted.length})</summary>
          <div style="max-height:480px;overflow-y:auto;margin-top:4px;">
            <table style="width:100%;font-size:10px;font-family:monospace;border-collapse:collapse;">
              <thead style="position:sticky;top:0;background:var(--bg);">
                <tr style="color:var(--text-dim);text-align:left;border-bottom:1px solid var(--border);">
                  <th style="padding:3px 6px;">Bucket</th>
                  <th style="padding:3px 6px;text-align:right;">Prod</th>
                  <th style="padding:3px 6px;text-align:right;">FS</th>
                  <th style="padding:3px 6px;">Status</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((b) => (
                  <tr key={`${b.type}/${b.org}`} style="border-bottom:1px solid rgba(28,35,51,0.4);">
                    <td style="padding:3px 6px;color:var(--text);">{b.type}/<span style="color:var(--text-dim);">{b.org || "·"}</span></td>
                    <td style="padding:3px 6px;text-align:right;color:var(--text);">{b.prodCount.toLocaleString()}</td>
                    <td style={`padding:3px 6px;text-align:right;color:${b.fsCount === b.prodCount ? "var(--text)" : "var(--yellow)"};`}>{b.fsCount.toLocaleString()}</td>
                    <td style="padding:3px 6px;">{bucketStatusBadge(b)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </>
  );
}

function statusRank(s: VerifyBucketView["status"]): number {
  switch (s) {
    case "sampling":
    case "repairing": return 0;
    case "mismatched": return 1;
    case "pending":
    case "counted": return 2;
    case "sampled": return 3;
    case "verified": return 4;
    case "repaired": return 5;
    case "error": return 6;
    default: return 7;
  }
}

function bucketStatusBadge(b: VerifyBucketView): VNode {
  const s = b.status;
  let bg = "var(--border)", color = "var(--text)", icon = "·", text: string = s;
  if (s === "verified") { bg = "rgba(34,197,94,0.12)"; color = "#22c55e"; icon = "✓"; text = "verified"; }
  else if (s === "repaired") { bg = "rgba(34,197,94,0.12)"; color = "#22c55e"; icon = "✓"; text = `repaired ${b.repairedCount}`; }
  else if (s === "repairing") { bg = "rgba(31,111,235,0.12)"; color = "#58a6ff"; icon = "⚠"; text = `repairing ${b.repairedCount}+`; }
  else if (s === "sampling") { bg = "rgba(31,111,235,0.12)"; color = "#58a6ff"; icon = "⏳"; text = `sampling ${b.sampled}/50`; }
  else if (s === "sampled") { bg = "rgba(34,197,94,0.12)"; color = "#22c55e"; icon = "✓"; text = `sampled ${b.matchedSamples}/${b.sampled}`; }
  else if (s === "mismatched") { bg = "rgba(251,191,36,0.12)"; color = "#fbbf24"; icon = "⚠"; text = "mismatch"; }
  else if (s === "counted") { bg = "rgba(251,191,36,0.08)"; color = "var(--text-muted)"; icon = "⏳"; text = "queued"; }
  else if (s === "pending") { bg = "var(--border)"; color = "var(--text-muted)"; icon = "⏳"; text = "pending"; }
  else if (s === "error") { bg = "rgba(248,81,73,0.12)"; color = "var(--red)"; icon = "✗"; text = `error: ${b.errors[0] ?? ""}`; }
  return (
    <span title={b.mismatchExamples.length > 0 ? `Examples: ${b.mismatchExamples.slice(0, 5).join(", ")}` : undefined}
      style={`display:inline-flex;align-items:center;gap:4px;padding:1px 6px;background:${bg};color:${color};border-radius:3px;font-size:10px;font-weight:600;`}>
      <span>{icon}</span><span>{text}</span>
    </span>
  );
}

function html(el: VNode): Response {
  return new Response(renderToString(el), { headers: { "content-type": "text/html" } });
}
