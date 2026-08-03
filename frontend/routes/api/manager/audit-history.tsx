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
  reviewedBy?: string;
  appealStatus?: string | null;
  /** WGS/MCC sale flags; undefined = legacy row not yet backfilled. */
  wgs?: boolean;
  mcc?: boolean;
}

/** Mirrors `DeptRollupRow` in src/manager/domain/business/audit-history/mod.ts.
 *  An audit counts as passed only at a perfect 100 — this app's rule
 *  everywhere. Unscored audits land in `count` but in neither passed nor
 *  failed, so `failPct` is null (not 0) when nothing is scored yet. */
export interface DeptRollup {
  department: string;
  count: number;
  passed: number;
  failed: number;
  failPct: number | null;
  avgScore: number | null;
  worstMember: { name: string; avgScore: number; audits: number } | null;
  topMissed: Array<{ header: string; count: number }>;
}

export interface AuditHistoryData {
  items: AuditHistoryItem[];
  total: number;
  /** Average score across all filtered audits in the window (backend-computed;
   *  null/absent when no audit has a score). */
  avgScore?: number | null;
  /** WGS / MCC sale counts across all filtered audits in the window. */
  wgsCount?: number;
  mccCount?: number;
  saleUnknownCount?: number;
  /** Most-missed questions across the filtered window (top 3). */
  topMissed?: Array<{ header: string; count: number }>;
  pages: number;
  page: number;
  owners: string[];
  shifts: string[];
  departments: string[];
  /** Per-department aggregates over the filtered window — backend-computed
   *  in one pass (see audit-history/mod.ts). Feeds the Operations Portal's
   *  all-departments overview. Absent on older responses. */
  deptRollup?: DeptRollup[];
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
  // Either signal counts as reviewed — review-done sentinel and audit-done-idx
  // reviewedBy can disagree on legacy rows; renderer tolerates both states.
  if (item.reviewed || item.reviewedBy) return <span class="pill pill-green">Reviewed</span>;
  return <span style="color:var(--text-dim);font-size:11px;">—</span>;
}

function appealBadge(item: AuditHistoryItem) {
  if (item.appealStatus === "pending") return <span class="pill pill-yellow">Pending</span>;
  if (item.appealStatus === "complete") return <span class="pill pill-blue">Complete</span>;
  return <span style="color:var(--text-dim);font-size:11px;">—</span>;
}

/** WGS/MCC tags. Legacy rows without backfilled flags render a dim dash —
 *  they fill in as the lazy backfill converges. */
function saleTags(item: AuditHistoryItem) {
  if (item.wgs === undefined) return <span style="color:var(--text-dim);font-size:11px;">—</span>;
  const tags = [
    ...(item.wgs ? ["WGS"] : []),
    ...(item.mcc ? ["MCC"] : []),
  ];
  if (tags.length === 0) return <span style="color:var(--text-dim);font-size:11px;">—</span>;
  return <span>{tags.map((t) => <span class={`pill pill-${t === "WGS" ? "green" : "blue"}`} style="margin-right:4px;">{t}</span>)}</span>;
}

/** Render the table + stats + pagination. Used both for SSR (page initial
 *  load) and for HTMX swap on filter change. */
export function renderAuditHistoryTable(data: AuditHistoryData) {
  const { items, total, avgScore, wgsCount, mccCount, saleUnknownCount, topMissed, pages, page } = data;
  const filtered = items.length;
  const saleHint = (saleUnknownCount ?? 0) > 0 ? `${saleUnknownCount} pending` : null;
  const missed = topMissed ?? [];
  return (
    <div>
      <div class="stat-grid" style="margin-bottom:12px;">
        <div class="stat-card">
          <div class="stat-card-value">{total}</div>
          <div class="stat-card-label">Total in window</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-value" style={avgScore != null ? `color:var(--${pillColor(avgScore)})` : undefined}>
            {avgScore != null ? `${avgScore}%` : "—"}
          </div>
          <div class="stat-card-label">Avg score in window</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-value">{wgsCount ?? "—"}</div>
          <div class="stat-card-label">WGS sales{saleHint ? ` (${saleHint})` : ""}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-value">{mccCount ?? "—"}</div>
          <div class="stat-card-label">MCC sales{saleHint ? ` (${saleHint})` : ""}</div>
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
      {missed.length > 0 && (
        <div class="card" style="margin-bottom:12px;padding:12px 16px;">
          <div class="tbl-title" style="margin-bottom:8px;">Most Missed Questions (filtered window)</div>
          <div style="display:flex;flex-direction:column;gap:6px;">
            {missed.map((m, i) => (
              <div key={m.header} style="display:flex;align-items:center;gap:10px;font-size:13px;">
                <span class="mono" style="color:var(--text-muted);width:18px;">{i + 1}.</span>
                <span style="flex:1;">{m.header}</span>
                <span class="pill pill-red">{m.count} {m.count === 1 ? "miss" : "misses"}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div class="tbl">
        <table class="data-table">
          <thead>
            <tr>
              <th>Finding</th>
              <th>Team Member</th>
              <th>Office / Dept</th>
              <th>Shift</th>
              <th>Score</th>
              <th>Sale</th>
              <th>Reviewed</th>
              <th>Appeal</th>
              <th>Started</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr class="empty-row"><td colSpan={9}>No audits match the current filters</td></tr>
            ) : items.map((item) => (
              <tr key={item.findingId}>
                <td>
                  <a class="mono" style="color:var(--accent);text-decoration:none;" href={`/audit/report?id=${encodeURIComponent(item.findingId)}`}>
                    {item.findingId.slice(0, 10)}…
                  </a>
                </td>
                <td>{ownerLabel(item)}</td>
                <td class="mono" style="font-size:11px;color:var(--text-muted);">{item.department ?? "\u2014"}</td>
                <td class="mono" style="font-size:11px;color:var(--text-muted);">{item.shift ?? "\u2014"}</td>
                <td>{item.score != null ? <span class={`pill pill-${pillColor(item.score)}`}>{item.score}%</span> : "\u2014"}</td>
                <td>{saleTags(item)}</td>
                <td>{reviewedBadge(item)}</td>
                <td>{appealBadge(item)}</td>
                <td class="time-ago">{item.startedAt ? timeAgo(item.startedAt) : timeAgo(item.ts)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (() => {
        // Same Preact hx-on--click strip workaround + htmx.ajax-vs-trigger
        // gotcha as /admin/audits and the form buttons above.
        const refresh = `htmx.ajax('GET','/api/manager/audit-history',{source:'#audit-history-filters',target:'#audit-history-table',swap:'innerHTML'})`;
        const prevJs = `(()=>{const p=document.getElementById('ah-page');if(!p)return;p.value=String(Math.max(1,Number(p.value)-1));${refresh};})()`;
        const nextJs = `(()=>{const p=document.getElementById('ah-page');if(!p)return;p.value=String(Math.min(${pages},Number(p.value)+1));${refresh};})()`;
        return (
          <div style="display:flex;align-items:center;justify-content:center;gap:12px;margin-top:14px;">
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              disabled={page <= 1}
              {...{ "hx-on:click": prevJs }}
            >&larr; Prev</button>
            <span style="font-size:12px;color:var(--text-muted);">Page {page} of {pages}</span>
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              disabled={page >= pages}
              {...{ "hx-on:click": nextJs }}
            >Next &rarr;</button>
          </div>
        );
      })()}
    </div>
  );
}

/** The three filter dropdowns, re-rendered from the CURRENT window.
 *
 *  They live in the filter form, outside the swapped table, so without this
 *  they'd keep whatever options the page was first loaded with — a team member
 *  who only has audits in the newly-chosen window would be missing from the
 *  Team Member list even while their rows show in the table below.
 *
 *  `hx-swap-oob` replaces each <select> by id wherever it sits in the DOM.
 *  A selection that no longer exists in the window is kept as an option (and
 *  stays selected) so the filter the user is looking at doesn't silently reset. */
export const FILTER_SELECT_IDS = { owner: "ah-owner", department: "ah-department", shift: "ah-shift" } as const;

export function renderFilterSelect(
  props: { name: "owner" | "department" | "shift"; values: string[]; selected: string; oob?: boolean },
) {
  const { name, values, selected, oob } = props;
  // Keep a selection that no longer exists in the window as an option, so the
  // filter the user is looking at doesn't silently reset under them.
  const options = selected && !values.includes(selected) ? [selected, ...values] : values;
  return (
    <select name={name} id={FILTER_SELECT_IDS[name]} {...(oob ? { "hx-swap-oob": "true" } : {})}>
      <option value="">All</option>
      {options.map((v) => <option key={v} value={v} selected={v === selected}>{v}</option>)}
    </select>
  );
}

/** Which selects to send back, named by the form's hidden `oob` input — an
 *  out-of-band swap whose id isn't on the page just raises an htmx error, and
 *  the Operations portal has no Department select (its sidebar is the switcher).
 *  Absent/blank means all three. */
export function parseOobSelects(raw: string | null): Array<"owner" | "department" | "shift"> {
  const all = ["owner", "department", "shift"] as const;
  const asked = (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (asked.length === 0) return [...all];
  return all.filter((n) => asked.includes(n));
}

export function renderFilterSelects(
  data: AuditHistoryData,
  current: { owner: string; department: string; shift: string },
  opts: { oob?: boolean; only?: Array<"owner" | "department" | "shift"> } = {},
) {
  const only = opts.only ?? ["owner", "department", "shift"];
  const values = { owner: data.owners ?? [], department: data.departments ?? [], shift: data.shifts ?? [] };
  return (
    <>
      {only.map((name) => renderFilterSelect({ name, values: values[name], selected: current[name], oob: opts.oob }))}
    </>
  );
}

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const params = new URLSearchParams();
    // Include `as` so backend manager-scope lookup uses the impersonated
    // manager's email when an admin is viewing via ?as=<email>. Without
    // this the backend would default to the admin's email (empty scope).
    for (const k of ["since", "until", "owner", "department", "shift", "reviewed", "sale", "sort", "scoreMin", "scoreMax", "page", "limit", "as"]) {
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
    const current = {
      owner: url.searchParams.get("owner") ?? "",
      department: url.searchParams.get("department") ?? "",
      shift: url.searchParams.get("shift") ?? "",
    };
    const html = renderToString(
      <>
        {renderAuditHistoryTable(data)}
        {renderFilterSelects(data, current, { oob: true, only: parseOobSelects(url.searchParams.get("oob")) })}
      </>,
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
