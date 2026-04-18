/** Shared dashboard tables — Active Audits, Recent Errors, Recently Completed.
 *  Rendered by both the dashboard SSR and /api/admin/dashboard/refresh HTMX fragment.
 *  All three tables are ALWAYS visible with empty-row placeholders — matches production
 *  (git show main:dashboard/page.ts lines 698-728).
 *  Action buttons (Resume/Terminate/Clear) live inline with table titles, not in a
 *  separate Queue Management panel. */
import { timeAgo } from "../lib/format.ts";

export interface ActiveItem { findingId: string; recordId?: string; step: string; ts: number; isPackage?: boolean; startedAt?: number; }
export interface ErrorItem { findingId: string; step: string; error: string; ts: number; }
export interface CompletedItem { findingId: string; recordId?: string; score?: number; completedAt: number; ts?: number; startedAt?: number; durationMs?: number; type?: string; isPackage?: boolean; }

interface Props {
  recent: CompletedItem[];
  active: ActiveItem[];
  errors: ErrorItem[];
  /** Base URL for Deno Deploy observability logs (if host is `{project}.{org}.deno.net`).
   *  Computed server-side from the request's Host header so we don't need client JS. */
  logsBase?: string;
  /** Current queue pause state — drives the Pause/Resume button label. */
  paused?: boolean;
}

const QB_DATE_URL = "https://monsterrg.quickbase.com/nav/app/bmhvhc7sk/table/bpb28qsnn/action/dr?rid=";
const QB_PKG_URL = "https://monsterrg.quickbase.com/nav/app/bmhvhc7sk/table/bttffb64u/action/dr?rid=";
const LOGS_SUFFIX = "&start=now%2Fy&end=now";

function fmtDur(ms?: number): string {
  if (!ms || ms < 0) return "\u2014";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

function qbUrl(recordId: string | undefined, isPackage: boolean | undefined): string | null {
  if (!recordId) return null;
  return (isPackage ? QB_PKG_URL : QB_DATE_URL) + encodeURIComponent(recordId);
}

function logsUrl(findingId: string, logsBase?: string): string | null {
  if (!logsBase || !findingId) return null;
  return `${logsBase}${encodeURIComponent(findingId)}${LOGS_SUFFIX}`;
}

export function DashboardTables({ recent, active, errors, logsBase, paused }: Props) {
  return (
    <>
      {/* Active Audits — ALWAYS visible */}
      <div class="tbl" style="margin-top:16px;">
        <div class="tbl-title" style="display:flex;align-items:center;justify-content:space-between;">
          <span>Active Audits</span>
          <div style="display:flex;gap:6px;align-items:center;">
            {/* Visible status slot fed by queue-action responses; cleared ~2s after success. */}
            <span id="queue-action-status" style="font-size:10px;min-width:80px;text-align:right;"></span>
            <button class="sf-btn"
                    hx-post="/api/admin/queue-action"
                    hx-vals={paused ? '{"action":"resume"}' : '{"action":"pause"}'}
                    hx-target="#queue-action-status"
                    hx-swap="innerHTML"
                    hx-on--after-request="setTimeout(() => { const el = document.getElementById('queue-action-status'); if (el) el.innerHTML = ''; }, 2500); if (event.detail.successful) htmx.trigger('#dashboard-tables', 'refresh');"
                    style={`font-size:9px;padding:3px 10px;${paused ? "background:var(--green-bg);color:var(--green);border-color:rgba(63,185,80,0.3);" : ""}`}>
              {paused ? "Resume Queues" : "Pause Queues"}
            </button>
            <button class="sf-btn danger"
                    hx-post="/api/admin/queue-action"
                    hx-vals='{"action":"terminate-all"}'
                    hx-target="#queue-action-status"
                    hx-swap="innerHTML"
                    hx-confirm="Terminate ALL running audits?"
                    hx-on--after-request="setTimeout(() => { const el = document.getElementById('queue-action-status'); if (el) el.innerHTML = ''; }, 2500); if (event.detail.successful) htmx.trigger('#dashboard-tables', 'refresh');"
                    style="font-size:9px;padding:3px 10px;">Terminate Running</button>
            <button class="sf-btn danger"
                    hx-post="/api/admin/queue-action"
                    hx-vals='{"action":"clear-review"}'
                    hx-target="#queue-action-status"
                    hx-swap="innerHTML"
                    hx-confirm="Clear the review queue?"
                    hx-on--after-request="setTimeout(() => { const el = document.getElementById('queue-action-status'); if (el) el.innerHTML = ''; }, 2500); if (event.detail.successful) htmx.trigger('#dashboard-tables', 'refresh');"
                    style="font-size:9px;padding:3px 10px;">Clear Queue</button>
          </div>
        </div>
        <table class="data-table">
          <thead><tr><th>Finding ID</th><th>QB Record</th><th>Step</th><th>Started</th><th>Duration</th><th>Actions</th></tr></thead>
          <tbody>
            {active.length === 0 ? (
              <tr class="empty-row"><td colSpan={6}>No active audits</td></tr>
            ) : active.map((a) => {
              const fid = a.findingId || "\u2014";
              // Finding ID links to the audit report page instead of Deno Deploy logs
              // (those go stale when the preview deployment hash changes).
              const reportHref = fid !== "\u2014" ? `/audit/report?id=${encodeURIComponent(fid)}` : null;
              const qbHref = qbUrl(a.recordId, a.isPackage);
              const dur = a.ts ? Date.now() - a.ts : null;
              return (
                <tr key={fid}>
                  <td>{reportHref
                    ? <a href={reportHref} target="_blank" rel="noopener" class="tbl-link mono" style="font-size:10px;">{fid}</a>
                    : <span class="mono">{fid}</span>}</td>
                  <td>{qbHref
                    ? <a href={qbHref} target="_blank" rel="noopener" class="tbl-link">{a.recordId}</a>
                    : "\u2014"}</td>
                  <td><span class="step-badge">{a.step ?? "\u2014"}</span></td>
                  <td class="time-ago">{a.startedAt ? timeAgo(a.startedAt) : (a.ts ? timeAgo(a.ts) : "\u2014")}</td>
                  <td class="mono" style="color:var(--yellow);">{dur != null ? fmtDur(dur) : "\u2014"}</td>
                  <td style="display:flex;gap:4px;">
                    <button class="sf-btn"
                            hx-get={`/api/admin/retry?findingId=${encodeURIComponent(fid)}`}
                            hx-swap="none"
                            hx-on--after-request="if (event.detail.successful) htmx.trigger('#dashboard-tables', 'refresh');"
                            style="font-size:10px;padding:3px 8px;">Retry</button>
                    <button class="sf-btn danger"
                            hx-post={`/api/admin/terminate-finding?findingId=${encodeURIComponent(fid)}`}
                            hx-swap="none"
                            hx-confirm="Stop this audit?"
                            hx-on--after-request="if (event.detail.successful) htmx.trigger('#dashboard-tables', 'refresh');"
                            style="font-size:10px;padding:3px 8px;">Stop</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Recent Errors — ALWAYS visible */}
      <div class="tbl" style="margin-top:16px;">
        <div class="tbl-title" style="display:flex;align-items:center;justify-content:space-between;">
          <span>Recent Errors (24h)</span>
          <button class="sf-btn danger" hx-post="/api/admin/queue-action" hx-vals='{"action":"clear-errors"}' hx-swap="none" hx-confirm="Clear all errors?" style="font-size:9px;padding:3px 10px;">Clear Errors</button>
        </div>
        <table class="data-table">
          <thead><tr><th>Finding ID</th><th>Logs</th><th>Step</th><th>Error</th><th>When</th></tr></thead>
          <tbody>
            {errors.length === 0 ? (
              <tr class="empty-row"><td colSpan={5}>No errors</td></tr>
            ) : errors.map((e) => {
              const fid = e.findingId || "\u2014";
              const reportHref = fid !== "\u2014" ? `/audit/report?id=${encodeURIComponent(fid)}` : null;
              const logsHref = logsUrl(e.findingId, logsBase);
              return (
                <tr key={e.findingId}>
                  <td>{reportHref
                    ? <a href={reportHref} target="_blank" rel="noopener" class="tbl-link mono" style="font-size:10px;">{fid.slice(0, 12)}</a>
                    : <span class="mono">{fid.slice(0, 12)}</span>}</td>
                  <td>{logsHref ? <a href={logsHref} target="_blank" rel="noopener" class="tbl-link" style="font-size:10px;">logs</a> : "\u2014"}</td>
                  <td><span class="step-badge">{e.step}</span></td>
                  <td class="error-msg">{e.error}</td>
                  <td class="time-ago">{timeAgo(e.ts)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Recently Completed — ALWAYS visible */}
      <div class="tbl" style="margin-top:16px;">
        <div class="tbl-title" style="display:flex;align-items:center;justify-content:space-between;">
          <span>Recently Completed (24h)</span>
          <a href="/admin/audits" target="_blank" class="tbl-link" style="font-size:10px;">View All &rarr;</a>
        </div>
        <table class="data-table">
          <thead><tr><th>Finding ID</th><th>Logs</th><th>QB Record</th><th>Score</th><th>Started</th><th>Finished</th><th>Duration</th></tr></thead>
          <tbody>
            {recent.length === 0 ? (
              <tr class="empty-row"><td colSpan={7}>No completed audits</td></tr>
            ) : recent.map((c) => {
              const fid = c.findingId || "\u2014";
              const reportHref = `/audit/report?id=${encodeURIComponent(fid)}`;
              const logsHref = logsUrl(fid, logsBase);
              const qbHref = qbUrl(c.recordId, c.isPackage);
              const finishedTs = c.ts ?? c.completedAt;
              // Duration: prefer explicit durationMs, else compute from startedAt and completedAt
              const dur = c.durationMs ?? (c.startedAt && c.completedAt ? c.completedAt - c.startedAt : null);
              const scoreColor = c.score == null ? "var(--text-dim)" : c.score === 100 ? "var(--green)" : c.score >= 80 ? "var(--cyan)" : "var(--red)";
              return (
                <tr key={fid}>
                  <td><a href={reportHref} target="_blank" rel="noopener" class="tbl-link mono">{fid}</a></td>
                  <td>{logsHref ? <a href={logsHref} target="_blank" rel="noopener" class="tbl-link" style="font-size:10px;">logs</a> : "\u2014"}</td>
                  <td>{qbHref ? <a href={qbHref} target="_blank" rel="noopener" class="tbl-link">{c.recordId}</a> : "\u2014"}</td>
                  <td>{c.score != null
                    ? <span style={`color:${scoreColor};font-weight:700;font-variant-numeric:tabular-nums;`}>{c.score}%</span>
                    : "\u2014"}</td>
                  <td class="time-ago">{c.startedAt ? timeAgo(c.startedAt) : "\u2014"}</td>
                  <td class="time-ago">{finishedTs ? timeAgo(finishedTs) : "\u2014"}</td>
                  <td class="mono" style="color:var(--yellow);">{dur != null ? fmtDur(dur) : "\u2014"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Compute the Deno Deploy observability logs base URL from a request URL.
 *  Returns null if the host doesn't match the deno.net pattern (e.g. localhost). */
export function computeLogsBase(requestUrl: string): string | undefined {
  try {
    const host = new URL(requestUrl).hostname;
    const m = host.match(/^([^.]+)\.([^.]+)\.deno\.net$/);
    if (!m) return undefined;
    return `https://console.deno.com/${m[2]}/${m[1]}/observability/logs?query=`;
  } catch {
    return undefined;
  }
}
