/** HTMX fragment — admin audit history table + stats + pagination + cross-filtered dropdowns.
 *
 *  The page at `routes/admin/audits.tsx` calls `renderAuditHistoryAdmin` to
 *  render the initial SSR view; HTMX hits this route on every filter change
 *  and gets back the table/stats/pagination block PLUS out-of-band swaps
 *  for the four dropdowns (owner, department, shift, auditor) so they
 *  cross-filter live as the user narrows the window. */
import { define } from "../../../lib/define.ts";
import { apiFetch } from "../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import { timeAgo } from "../../../lib/format.ts";
import type { VNode } from "preact";

export interface AdminAuditItem {
  findingId: string;
  ts: number;
  completedAt?: number;
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
  reviewedBy?: string;
  appealStatus?: string | null;
}

export interface AdminAuditData {
  items: AdminAuditItem[];
  total: number;
  pages: number;
  page: number;
  owners: string[];
  departments: string[];
  shifts: string[];
  reviewers: string[];
}

export interface AdminAuditFilters {
  since: string;
  until: string;
  type: string;
  owner: string;
  department: string;
  shift: string;
  reviewed: string;
  auditor: string;
  scoreMin: string;
  scoreMax: string;
  page: string;
  limit: string;
}

const QB_DATE_URL = "https://monsterrg.quickbase.com/nav/app/bmhvhc7sk/table/bpb28qsnn/action/dr?rid=";
const QB_PKG_URL = "https://monsterrg.quickbase.com/nav/app/bmhvhc7sk/table/bttffb64u/action/dr?rid=";

function logsBaseFromHost(host: string | null): string | null {
  if (!host) return null;
  const m = host.match(/^([^.]+)\.([^.]+)\.deno\.net$/);
  if (!m) return null;
  return `https://console.deno.com/${m[2]}/${m[1]}/observability/logs?query=`;
}

function fmtDur(ms?: number): string {
  if (!ms) return "\u2014";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}

function scorePill(s: number | null | undefined): VNode | string {
  if (s == null) return "\u2014";
  const cls = s === 100 ? "green" : s >= 80 ? "yellow" : "red";
  return <span class={`pill pill-${cls}`}>{s}%</span>;
}

function typeBadge(isPackage?: boolean): VNode {
  return isPackage
    ? <span class="pill pill-yellow">Partner</span>
    : <span class="pill pill-blue">Internal</span>;
}

function reviewedBadge(item: AdminAuditItem): VNode | string {
  if (item.reason === "perfect_score") return <span class="pill pill-green" title="100% — no review needed">✓ Auto</span>;
  if (item.reason === "invalid_genie") return <span class="pill pill-blue" title="No recording — no review needed">✓ Auto</span>;
  if (item.reviewed) return <span class="pill pill-green">✓ Reviewed</span>;
  return "\u2014";
}

function appealBadge(status: string | null | undefined): VNode | string {
  if (status === "pending") return <span class="pill pill-yellow">Appeal Pending</span>;
  if (status === "complete") return <span class="pill pill-blue">Appeal Complete</span>;
  return "\u2014";
}

function ownerLabel(item: AdminAuditItem): string {
  if (item.voName) return item.voName;
  if (item.owner && item.owner !== "api") return item.owner.split("@")[0];
  return "\u2014";
}

function auditorLabel(item: AdminAuditItem): { text: string; dim: boolean } {
  if (item.reviewedBy) return { text: item.reviewedBy.split("@")[0], dim: false };
  if (item.owner && item.owner !== "api") return { text: item.owner.split("@")[0], dim: true };
  return { text: "api", dim: true };
}

function renderStats(data: AdminAuditData, windowLabel: string): VNode {
  const items = data.items;
  const passes = items.filter((c) => (c.score ?? 0) >= 80).length;
  const pkgs = items.filter((c) => c.isPackage).length;
  const dls = items.filter((c) => !c.isPackage).length;
  const avgScore = items.length
    ? Math.round(items.reduce((a, c) => a + (c.score ?? 0), 0) / items.length)
    : 0;
  return (
    <div class="audits-stats">
      <div class="stat-card"><div class="val">{data.total}</div><div class="lbl">Total ({windowLabel})</div></div>
      <div class="stat-card"><div class="val" style="color:var(--green);">{passes}</div><div class="lbl">≥80% Pass</div></div>
      <div class="stat-card"><div class="val" style="color:var(--red);">{items.length - passes}</div><div class="lbl">&lt;80% Fail</div></div>
      <div class="stat-card"><div class="val" style="color:var(--yellow);">{pkgs}</div><div class="lbl">Partner</div></div>
      <div class="stat-card"><div class="val" style="color:var(--blue);">{dls}</div><div class="lbl">Internal</div></div>
      <div class="stat-card"><div class="val">{avgScore}%</div><div class="lbl">Avg Score (page)</div></div>
    </div>
  );
}

function renderTable(data: AdminAuditData, logsBase: string | null): VNode {
  if (data.items.length === 0) {
    return (
      <div class="audits-tbl-wrap">
        <div class="empty">No audits match the current filters</div>
      </div>
    );
  }
  return (
    <div class="audits-tbl-wrap">
      <table>
        <thead>
          <tr>
            <th>Finding ID</th>
            <th>Logs</th>
            <th>QB Record</th>
            <th>Type</th>
            <th>Team Member</th>
            <th>Auditor</th>
            <th>Score</th>
            <th>Started</th>
            <th>Finished</th>
            <th>Duration</th>
            <th>Reviewed</th>
            <th>Appeal</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((c) => {
            const fid = c.findingId || "\u2014";
            const ts = c.ts ?? c.completedAt ?? 0;
            const aud = auditorLabel(c);
            return (
              <tr key={fid}>
                <td>
                  <a class="mono" style="color:var(--blue);text-decoration:none;font-size:11px;" href={`/audit/report?id=${encodeURIComponent(fid)}`} target="_blank">
                    {fid}
                  </a>
                </td>
                <td>
                  {logsBase
                    ? <a href={`${logsBase}${encodeURIComponent(fid)}&start=now%2Fy&end=now`} target="_blank" class="mono" style="color:var(--blue);text-decoration:none;font-size:11px;">logs</a>
                    : <span style="color:var(--text-dim);">\u2014</span>}
                </td>
                <td>
                  {c.recordId
                    ? <a href={`${c.isPackage ? QB_PKG_URL : QB_DATE_URL}${encodeURIComponent(c.recordId)}`} target="_blank" class="mono" style="color:var(--blue);text-decoration:none;font-size:11px;">{c.recordId}</a>
                    : <span style="color:var(--text-dim);">\u2014</span>}
                </td>
                <td>{typeBadge(c.isPackage)}</td>
                <td><span class="mono" style="font-size:10px;">{ownerLabel(c)}</span></td>
                <td><span class="mono" style={`font-size:10px;color:${aud.dim ? "var(--text-dim)" : "var(--text)"};`}>{aud.text}</span></td>
                <td>{scorePill(c.score)}</td>
                <td><span title={c.startedAt ? new Date(c.startedAt).toLocaleString() : ""}>{c.startedAt ? timeAgo(c.startedAt) : "\u2014"}</span></td>
                <td><span title={ts ? new Date(ts).toLocaleString() : ""}>{ts ? timeAgo(ts) : "\u2014"}</span></td>
                <td style="font-variant-numeric:tabular-nums;">{fmtDur(c.durationMs)}</td>
                <td>{reviewedBadge(c)}</td>
                <td>{appealBadge(c.appealStatus)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function renderPagination(data: AdminAuditData): VNode | null {
  if (data.pages <= 1) return null;
  const refresh = `htmx.ajax('GET','/api/admin/audit-history',{source:'#audit-history-filters',target:'#audit-history-table',swap:'innerHTML'})`;
  return (
    <div style="display:flex;align-items:center;justify-content:center;gap:12px;margin-top:14px;">
      <button
        type="button"
        class="ah-btn ah-btn-ghost"
        disabled={data.page <= 1}
        hx-on--click={`(()=>{const p=document.getElementById('ah-page');if(!p)return;p.value=String(Math.max(1,Number(p.value)-1));${refresh};})()`}
      >&larr; Prev</button>
      <span style="font-size:12px;color:var(--text-muted);">Page {data.page} of {data.pages}</span>
      <button
        type="button"
        class="ah-btn ah-btn-ghost"
        disabled={data.page >= data.pages}
        hx-on--click={`(()=>{const p=document.getElementById('ah-page');if(!p)return;p.value=String(Math.min(${data.pages},Number(p.value)+1));${refresh};})()`}
      >Next &rarr;</button>
    </div>
  );
}

/** Render dropdown <option> list with the current selection preserved. */
function renderOptions(values: string[], selected: string, allLabel: string): VNode {
  return (
    <>
      <option value="" selected={selected === ""}>{allLabel}</option>
      {values.map((v) => <option key={v} value={v} selected={v === selected}>{v}</option>)}
    </>
  );
}

/** Render the main fragment block (stats + table + pagination) — the
 *  primary swap target. Used both for SSR initial render and HTMX swap. */
export function renderAuditHistoryMain(data: AdminAuditData, windowLabel: string, logsBase: string | null): VNode {
  return (
    <div>
      {renderStats(data, windowLabel)}
      {renderTable(data, logsBase)}
      {renderPagination(data)}
    </div>
  );
}

/** Render the four cross-filtered dropdown <option> lists, with `selected`
 *  preserved to whatever the user currently has. The page route uses these
 *  to populate the form on initial SSR. */
export function renderAuditHistoryDropdowns(data: AdminAuditData, filters: AdminAuditFilters) {
  return {
    owner: renderOptions(data.owners, filters.owner, "All Members"),
    department: renderOptions(data.departments, filters.department, "All Departments"),
    shift: renderOptions(data.shifts, filters.shift, "All Shifts"),
    auditor: renderOptions(data.reviewers.map((r) => r.split("@")[0]).sort(), filters.auditor.split("@")[0], "All Auditors"),
  };
}

function windowLabelFromFilters(f: AdminAuditFilters): string {
  const since = parseInt(f.since || "0", 10);
  const until = parseInt(f.until || String(Date.now()), 10);
  if (since === 0) return "all";
  const hours = Math.round((until - since) / 3_600_000);
  if (hours <= 1) return "1h";
  if (hours <= 4) return "4h";
  if (hours <= 12) return "12h";
  if (hours <= 24) return "24h";
  if (hours <= 72) return "3d";
  if (hours <= 168) return "7d";
  return `${Math.round(hours / 24)}d`;
}

/** Reads the same filter set the page exposes. Pure — does no I/O. */
export function readFilters(url: URL): AdminAuditFilters {
  return {
    since: url.searchParams.get("since") ?? "",
    until: url.searchParams.get("until") ?? "",
    type: url.searchParams.get("type") ?? "",
    owner: url.searchParams.get("owner") ?? "",
    department: url.searchParams.get("department") ?? "",
    shift: url.searchParams.get("shift") ?? "",
    reviewed: url.searchParams.get("reviewed") ?? "",
    auditor: url.searchParams.get("auditor") ?? "",
    scoreMin: url.searchParams.get("scoreMin") ?? "0",
    scoreMax: url.searchParams.get("scoreMax") ?? "100",
    page: url.searchParams.get("page") ?? "1",
    limit: url.searchParams.get("limit") ?? "50",
  };
}

/** Build the backend query string from filters. */
export function buildBackendQs(f: AdminAuditFilters): URLSearchParams {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (v != null && v !== "") qs.set(k, v);
  }
  return qs;
}

/** Fetch + render the full fragment (main block + OOB dropdown swaps).
 *  Called by both the page handler (initial SSR) and the HTMX endpoint. */
export async function fetchAndRenderFragment(
  filters: AdminAuditFilters,
  req: Request,
  opts?: { includeOob?: boolean },
): Promise<{ data: AdminAuditData; html: string }> {
  const qs = buildBackendQs(filters);
  const data = await apiFetch<AdminAuditData>(`/admin/audits/data?${qs}`, req);
  const logsBase = logsBaseFromHost(new URL(req.url).host);
  const windowLabel = windowLabelFromFilters(filters);
  const main = renderToString(renderAuditHistoryMain(data, windowLabel, logsBase));

  if (!opts?.includeOob) return { data, html: main };

  // Out-of-band swaps for the cross-filtered dropdowns. HTMX replaces each
  // <select> wholesale via outerHTML, preserving id/name/listeners.
  const dd = renderAuditHistoryDropdowns(data, filters);
  const oob = renderToString(
    <>
      <select id="f-owner" name="owner" hx-swap-oob="true">{dd.owner}</select>
      <select id="f-dept" name="department" hx-swap-oob="true">{dd.department}</select>
      <select id="f-shift" name="shift" hx-swap-oob="true">{dd.shift}</select>
      <select id="f-auditor" name="auditor" hx-swap-oob="true">{dd.auditor}</select>
      <span id="ah-count" hx-swap-oob="true">{data.total} audits in window</span>
      <span id="ah-window" hx-swap-oob="true">({windowLabel})</span>
    </>,
  );
  return { data, html: main + oob };
}

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const filters = readFilters(url);
    try {
      const { html } = await fetchAndRenderFragment(filters, ctx.req, { includeOob: true });
      return new Response(html, { headers: { "content-type": "text/html" } });
    } catch (e) {
      const msg = (e as Error).message;
      return new Response(
        renderToString(<div class="empty-row" style="padding:40px;color:var(--red);">Failed to load: {msg}</div>),
        { headers: { "content-type": "text/html" } },
      );
    }
  },
});
