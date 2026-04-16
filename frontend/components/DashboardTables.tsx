/** Shared dashboard tables — Recently Completed, Active Pipeline, Errors.
 *  Rendered by both the dashboard SSR and /api/admin/dashboard/refresh HTMX fragment. */
import { timeAgo } from "../lib/format.ts";

export interface ActiveItem { findingId: string; recordId?: string; step: string; ts: number; }
export interface ErrorItem { findingId: string; step: string; error: string; ts: number; }
export interface CompletedItem { findingId: string; recordId?: string; score?: number; completedAt: number; startedAt?: number; type?: string; }

interface Props {
  recent: CompletedItem[];
  active: ActiveItem[];
  errors: ErrorItem[];
}

export function DashboardTables({ recent, active, errors }: Props) {
  return (
    <>
      {/* Recently Completed (24h) */}
      <div class="tbl" style="margin-top:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div class="tbl-title" style="margin-bottom:0;">Recently Completed (24h)</div>
          <a href="/admin/audits" class="tbl-link" style="font-size:11px;">View All &rarr;</a>
        </div>
        <table class="data-table">
          <thead><tr><th>Finding ID</th><th>QB Record</th><th>Score</th><th>Started</th><th>Finished</th><th>Duration</th></tr></thead>
          <tbody>
            {recent.length === 0 ? (
              <tr class="empty-row"><td colSpan={6}>No recent audits</td></tr>
            ) : recent.map((a) => {
              const dur = a.startedAt && a.completedAt ? Math.round((a.completedAt - a.startedAt) / 1000) : null;
              const durStr = dur != null ? (dur >= 60 ? `${Math.floor(dur / 60)}m ${dur % 60}s` : `${dur}s`) : "\u2014";
              return (
                <tr key={a.findingId}>
                  <td><a href={`/admin/audits?findingId=${a.findingId}`} class="tbl-link mono">{a.findingId?.slice(0, 20)}</a></td>
                  <td class="mono">{a.recordId ?? "\u2014"}</td>
                  <td>{a.score != null ? <span style={`color:${a.score === 100 ? "var(--green)" : a.score >= 80 ? "var(--cyan)" : "var(--red)"};font-weight:700;font-variant-numeric:tabular-nums;`}>{a.score}%</span> : "\u2014"}</td>
                  <td class="time-ago">{a.startedAt ? timeAgo(a.startedAt) : "\u2014"}</td>
                  <td class="time-ago">{timeAgo(a.completedAt)}</td>
                  <td class="mono" style="color:var(--yellow);font-variant-numeric:tabular-nums;">{durStr}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Active Pipeline */}
      {active.length > 0 && (
        <div class="tbl">
          <div class="tbl-title">Active Pipeline ({active.length})</div>
          <table class="data-table">
            <thead><tr><th>Finding</th><th>QB Record</th><th>Step</th><th>Started</th><th>Duration</th></tr></thead>
            <tbody>
              {active.map((a) => {
                const dur = a.ts ? Math.round((Date.now() - a.ts) / 1000) : null;
                return (
                  <tr key={a.findingId}>
                    <td class="mono">{a.findingId?.slice(0, 8)}</td>
                    <td class="mono">{a.recordId ?? "\u2014"}</td>
                    <td><span class="step-badge">{a.step}</span></td>
                    <td class="time-ago">{timeAgo(a.ts)}</td>
                    <td class="mono" style="color:var(--yellow);">{dur != null ? `${dur}s` : "\u2014"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Errors */}
      {errors.length > 0 && (
        <div class="tbl">
          <div class="tbl-title">Errors ({errors.length})</div>
          <table class="data-table">
            <thead><tr><th>Finding</th><th>Step</th><th>Error</th><th>When</th><th>Action</th></tr></thead>
            <tbody>
              {errors.map((e) => (
                <tr key={e.findingId}>
                  <td class="mono">{e.findingId?.slice(0, 8)}</td>
                  <td><span class="step-badge">{e.step}</span></td>
                  <td class="error-msg">{e.error}</td>
                  <td class="time-ago">{timeAgo(e.ts)}</td>
                  <td><button class="btn btn-ghost" style="padding:3px 8px;font-size:10px;" hx-get={`/api/admin/retry?findingId=${e.findingId}&step=${e.step}`} hx-swap="none">Retry</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
