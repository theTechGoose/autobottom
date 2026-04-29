/** HTMX fragment — manager audit-history table + stats + pagination.
 *
 *  The page at `routes/manager/audits.tsx` calls `renderAuditHistoryTable` to
 *  render the initial SSR view; HTMX hits this route on every filter change
 *  and gets back the same fragment with new data. */
import { define } from "../../../lib/define.ts";
import { apiFetch } from "../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import { timeAgo } from "../../../lib/format.ts";

export interface AuditHistoryItem {
  findingId: string;
  ts: number;
  score: number;
  recordId?: string;
  isPackage?: boolean;
  voName?: string;
  owner?: string;
  department?: string;
  shift?: string;
  startedAt?: number;
  durationMs?: number;
  reason?: string;
  reviewed?: boolean;
  appealStatus?: string | null;
}

export interface AuditHistoryData {
  items: AuditHistoryItem[];
  total: number;
  pages: number;
  page: number;
  owners: string[];
  shifts: string[];
  departments: string[];
}

function pillColor(score: number | null | undefined): string {
  if (score == null) return "blue";
  if (score >= 90) return "green";
  if (score >= 70) return "yellow";
  return "red";
}

function ownerLabel(item: AuditHistoryItem): string {
  if (item.voName) return item.voName;
  if (item.owner && item.owner !== "api") return item.owner.split("@")[0];
  return "\u2014";
}

function reviewedBadge(item: AuditHistoryItem) {
  if (item.reason === "perfect_score") return <span class="pill pill-green">Auto</span>;
  if (item.reason === "invalid_genie") return <span class="pill pill-blue">Invalid Genie</span>;
  if (item.reviewed) return <span class="pill pill-green">Reviewed</span>;
  return <span style="color:var(--text-dim);font-size:11px;">\u2014</span>;
}

function appealBadge(item: AuditHistoryItem) {
  if (item.appealStatus === "pending") return <span class="pill pill-yellow">Pending</span>;
  if (item.appealStatus === "complete") return <span class="pill pill-blue">Complete</span>;
  return <span style="color:var(--text-dim);font-size:11px;">\u2014</span>;
}

/** Render the table + stats + pagination. Used both for SSR (page initial
 *  load) and for HTMX swap on filter change. */
export function renderAuditHistoryTable(data: AuditHistoryData) {
  const { items, total, pages, page } = data;
  const filtered = items.length;
  return (
    <div>
      <div class="stat-grid" style="margin-bottom:12px;">
        <div class="stat-card">
          <div class="stat-card-value">{total}</div>
          <div class="stat-card-label">Total in window</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-value">{filtered}</div>
          <div class="stat-card-label">On this page</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-value">{page} / {pages}</div>
          <div class="stat-card-label">Page</div>
        </div>
      </div>
      <div class="tbl">
        <table class="data-table">
          <thead>
            <tr>
              <th>Finding</th>
              <th>Agent</th>
              <th>Office / Dept</th>
              <th>Shift</th>
              <th>Score</th>
              <th>Reviewed</th>
              <th>Appeal</th>
              <th>Started</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr class="empty-row"><td colSpan={8}>No audits match the current filters</td></tr>
            ) : items.map((item) => (
              <tr key={item.findingId}>
                <td>
                  <a class="mono" style="color:var(--accent);text-decoration:none;" href={`/audit/report?id=${encodeURIComponent(item.findingId)}`}>
                    {item.findingId.slice(0, 10)}\u2026
                  </a>
                </td>
                <td>{ownerLabel(item)}</td>
                <td class="mono" style="font-size:11px;color:var(--text-muted);">{item.department ?? "\u2014"}</td>
                <td class="mono" style="font-size:11px;color:var(--text-muted);">{item.shift ?? "\u2014"}</td>
                <td>{item.score != null ? <span class={`pill pill-${pillColor(item.score)}`}>{item.score}%</span> : "\u2014"}</td>
                <td>{reviewedBadge(item)}</td>
                <td>{appealBadge(item)}</td>
                <td class="time-ago">{item.startedAt ? timeAgo(item.startedAt) : timeAgo(item.ts)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div style="display:flex;align-items:center;justify-content:center;gap:12px;margin-top:14px;">
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            disabled={page <= 1}
            hx-on--click={`(()=>{const p=document.getElementById('ah-page');if(!p)return;p.value=String(Math.max(1,Number(p.value)-1));htmx.trigger('#audit-history-filters','change');})()`}
          >&larr; Prev</button>
          <span style="font-size:12px;color:var(--text-muted);">Page {page} of {pages}</span>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            disabled={page >= pages}
            hx-on--click={`(()=>{const p=document.getElementById('ah-page');if(!p)return;p.value=String(Math.min(${pages},Number(p.value)+1));htmx.trigger('#audit-history-filters','change');})()`}
          >Next &rarr;</button>
        </div>
      )}
    </div>
  );
}

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const params = new URLSearchParams();
    for (const k of ["since", "until", "owner", "department", "shift", "reviewed", "scoreMin", "scoreMax", "page", "limit"]) {
      const v = url.searchParams.get(k);
      if (v != null && v !== "") params.set(k, v);
    }
    let data: AuditHistoryData;
    try {
      data = await apiFetch<AuditHistoryData>(`/manager/api/audit-history?${params}`, ctx.req);
    } catch (e) {
      const msg = (e as Error).message;
      return new Response(
        renderToString(<div class="empty-row" style="padding:40px;color:var(--red);">Failed to load: {msg}</div>),
        { headers: { "content-type": "text/html" } },
      );
    }
    const html = renderToString(renderAuditHistoryTable(data));
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
