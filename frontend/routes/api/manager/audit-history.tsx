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
  /** QuickBase employee id — the person key the report page links on. Absent
   *  on audits ingested before 2026-08-07, and on packages (different table),
   *  so the name renders as plain text rather than a link for those. */
  employeeId?: string;
  owner?: string;
  department?: string;
  shift?: string;
  startedAt?: number;
  durationMs?: number;
  reason?: string;
  reviewed?: boolean;
  reviewedBy?: string;
  appealStatus?: string | null;
  /** Audit-result email tracking. `emailSentAt` undefined = no email has gone
   *  out yet (a failing audit waits for a reviewer), which renders blank rather
   *  than as an unticked box. */
  emailSentAt?: number;
  emailOpenedAt?: number;
  /** WGS/MCC sale flags; undefined = legacy row not yet backfilled. */
  wgs?: boolean;
  mcc?: boolean;
}

/** "Email Opened" cell. Three states, because two would lie: an audit whose
 *  email hasn't been sent yet is not the same as one the team member ignored,
 *  and roughly a third of rows are in that state at any moment (failing audits
 *  don't email until a reviewer finishes). Blank = nothing sent; empty box =
 *  delivered, not opened; ticked = the tracking pixel fired.
 *
 *  Exported for tests — the distinction is the whole point of the column. */
export function emailOpenedCell(item: { emailSentAt?: number; emailOpenedAt?: number }) {
  if (!item.emailSentAt) {
    return (
      <span style="color:var(--text-dim);font-size:11px;" title="No result email has been sent for this audit yet">
        &mdash;
      </span>
    );
  }
  if (item.emailOpenedAt) {
    return (
      <span
        style="color:var(--green,#3fb950);font-size:14px;"
        title={`Opened ${new Date(item.emailOpenedAt).toLocaleString()}`}
      >
        &#9745;
      </span>
    );
  }
  return (
    <span
      style="color:var(--text-muted);font-size:14px;"
      title={`Sent ${new Date(item.emailSentAt).toLocaleString()} — not opened yet`}
    >
      &#9744;
    </span>
  );
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
  /** Scored audits in the window and how many were perfect — the summary
   *  line's pass rate counts AUDITS, not points. */
  scoredCount?: number;
  passedCount?: number;
  /** WGS / MCC sale counts across all filtered audits in the window. */
  wgsCount?: number;
  mccCount?: number;
  saleUnknownCount?: number;
  /** Most-missed questions across the filtered window (top 3). */
  topMissed?: Array<{ header: string; count: number }>;
  /** The three team members with the most misses in the window, each with the
   *  single question they miss most. Same filtered set as topMissed. */
  topMissers?: Array<{ member: string; misses: number; worstQuestion: string; worstCount: number }>;
  /** Audits per team member across the filtered window, busiest first — the
   *  one-click member chips. Ignores the member filter so every name stays
   *  visible while one is selected. Absent on older responses. */
  memberCounts?: Array<{ name: string; count: number; employeeId?: string }>;
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

/** The team member's name, linked to their individual report when the row
 *  carries an employee id. Rows without one (audited before 2026-08-07, or
 *  packages) render plain text \u2014 linking them by name would open a report for
 *  whichever person happens to share that name. */
function ownerCell(item: AuditHistoryItem) {
  const label = ownerLabel(item);
  if (!item.employeeId || label === "\u2014") return <>{label}</>;
  return (
    <a
      href={`/manager/team/${encodeURIComponent(item.employeeId)}`}
      title={`See every audit for ${label}`}
      style="color:var(--accent,#58a6ff);text-decoration:none;"
    >{label}</a>
  );
}

function reviewedBadge(item: AuditHistoryItem) {
  if (item.reason === "perfect_score") return <span class="pill pill-green">Auto</span>;
  if (item.reason === "invalid_genie") return <span class="pill pill-blue">Invalid Genie</span>;
  // Either signal counts as reviewed — review-done sentinel and audit-done-idx
  // reviewedBy can disagree on legacy rows; renderer tolerates both states.
  if (item.reviewed || item.reviewedBy) return <span class="pill pill-green">Reviewed</span>;
  return <span style="color:var(--text-dim);font-size:11px;">—</span>;
}

/** A decided appeal is clickable — it opens the appeal-detail modal (what was
 *  appealed, what the judge overturned or upheld, and why). The modal shell
 *  lives on the page, not in this fragment, so it survives every table swap. */
function appealBadge(item: AuditHistoryItem) {
  if (item.appealStatus === "pending") return <span class="pill pill-yellow">Pending</span>;
  if (item.appealStatus === "complete") {
    return (
      <button
        type="button"
        class="pill pill-blue"
        style="border:0;cursor:pointer;font:inherit;"
        title="See what the judge decided"
        hx-get={`/api/manager/appeal?findingId=${encodeURIComponent(item.findingId)}`}
        hx-target="#appeal-detail-content"
        hx-swap="innerHTML"
        {...{ "hx-on:click": "document.getElementById('appeal-detail-modal').classList.add('open')" }}
      >Complete</button>
    );
  }
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
/** Short date for the window summary — no year unless the window crosses one. */
function fmtWindowDay(ms: number, showYear: boolean): string {
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short", day: "numeric", ...(showYear ? { year: "numeric" } : {}),
  });
}

/** "105 audits from Jul 27 to Aug 2 | 61.9% passing - 38.1% failing | 83 WGS - 22 MCC"
 *
 *  One line instead of six stat cards. Pass rate counts audits at a perfect
 *  score (this app's rule everywhere), so passing + failing always sum to 100
 *  over the SCORED audits; anything unscored is in the audit count but neither
 *  rate. Exported for tests. */
export function renderSummaryLine(data: AuditHistoryData, window?: { since: number; until: number }) {
  const { total, scoredCount, passedCount, wgsCount, mccCount, saleUnknownCount } = data;
  const scored = scoredCount ?? 0;
  const passed = passedCount ?? 0;
  const passPct = scored > 0 ? Math.round((passed / scored) * 1000) / 10 : null;
  const failPct = passPct == null ? null : Math.round((100 - passPct) * 10) / 10;
  const crossesYear = window
    ? new Date(window.since).getFullYear() !== new Date(window.until).getFullYear()
    : false;
  const range = window
    ? (window.since === 0
      ? `all time to ${fmtWindowDay(window.until, true)}`
      : `${fmtWindowDay(window.since, crossesYear)} to ${fmtWindowDay(window.until, crossesYear)}`)
    : null;
  const saleHint = (saleUnknownCount ?? 0) > 0 ? ` (${saleUnknownCount} pending)` : "";
  return (
    <div class="ah-summary">
      <span>
        <strong>{total.toLocaleString()}</strong> {total === 1 ? "audit" : "audits"}
        {range ? ` from ${range}` : ""}
      </span>
      <span class="ah-summary-sep">|</span>
      {passPct == null ? <span class="ah-summary-dim">no scored audits</span> : (
        <span>
          <strong style={`color:var(--${pillColor(passPct)});`}>{passPct}%</strong> passing
          {" - "}
          <strong style="color:var(--red);">{failPct}%</strong> failing
        </span>
      )}
      <span class="ah-summary-sep">|</span>
      <span>
        <strong>{wgsCount ?? 0}</strong> WGS <span class="ah-summary-dim">-</span>{" "}
        <strong>{mccCount ?? 0}</strong> MCC{saleHint}
      </span>
    </div>
  );
}

/** How many member chips render before the rest fold into the dropdown. A
 *  window can hold hundreds of people (318 distinct in July alone), and a chip
 *  row that long is worse than no chip row. The overflow is stated on screen —
 *  a silently truncated list reads as "this is everyone". */
const MEMBER_CHIP_LIMIT = 12;

/** One-click team-member chips: the busiest people in the window, each with
 *  their audit count, plus a leading "All" to get back.
 *
 *  Filters by NAME (writing into the existing Team Member <select>, so the two
 *  controls can't disagree) rather than by employee id, because audits from
 *  before 2026-08-07 carry no id and an id-based chip would hide them. The
 *  row's name link is id-based and stays exact. */
export function renderMemberChips(data: AuditHistoryData, selected: string) {
  const counts = data.memberCounts ?? [];
  if (counts.length === 0) return null;
  const shown = counts.slice(0, MEMBER_CHIP_LIMIT);
  const hidden = counts.length - shown.length;
  const total = counts.reduce((sum, m) => sum + m.count, 0);

  // Writes the Team Member <select> then refreshes through the same form every
  // other filter uses, so window / dept / shift / score all survive the click.
  const pick = (name: string) =>
    `(()=>{const s=document.getElementById('ah-owner');if(!s)return;`
    + `if(![...s.options].some(o=>o.value===${JSON.stringify(name)})){const o=document.createElement('option');`
    + `o.value=${JSON.stringify(name)};o.text=${JSON.stringify(name)};s.appendChild(o);}`
    + `s.value=${JSON.stringify(name)};`
    + `var p=document.getElementById('ah-page');if(p)p.value='1';`
    + `htmx.ajax('GET','/api/manager/audit-history',{source:'#audit-history-filters',target:'#audit-history-table',swap:'innerHTML'});})()`;

  return (
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px;">
      <button
        type="button"
        class={`btn btn-sm ${selected ? "btn-ghost" : ""}`}
        title="Show every team member"
        {...{ "hx-on:click": pick("") }}
      >
        All<span style="margin-left:6px;opacity:0.7;font-variant-numeric:tabular-nums;">{total}</span>
      </button>
      {shown.map((m) => {
        const active = selected === m.name;
        return (
          <button
            key={m.name}
            type="button"
            class={`btn btn-sm ${active ? "" : "btn-ghost"}`}
            title={active ? `Showing only ${m.name} — click for everyone` : `Show only ${m.name}`}
            {...{ "hx-on:click": pick(active ? "" : m.name) }}
          >
            {m.name}<span style="margin-left:6px;opacity:0.7;font-variant-numeric:tabular-nums;">{m.count}</span>
          </button>
        );
      })}
      {hidden > 0 && (
        <span style="font-size:11px;color:var(--text-dim);">
          +{hidden} more — use the Team Member filter
        </span>
      )}
    </div>
  );
}

/** Render the summary + table + pagination. Used both for SSR (page initial
 *  load) and for HTMX swap on filter change.
 *
 *  `opts.memberChips` is opt-in: the per-team-member report renders this same
 *  table for ONE person, where a chip row would be a single pointless chip. */
export function renderAuditHistoryTable(
  data: AuditHistoryData,
  window?: { since: number; until: number },
  opts: { memberChips?: boolean; selectedMember?: string } = {},
) {
  const { items, pages, page, topMissed } = data;
  const missed = topMissed ?? [];
  const missers = data.topMissers ?? [];
  return (
    <div>
      {opts.memberChips && renderMemberChips(data, opts.selectedMember ?? "")}
      {renderSummaryLine(data, window)}
      {missed.length > 0 && (
        /* Two halves of the same question: WHAT the team misses (left) and WHO
           misses most, on which question (right). The right half is dropped
           when no audit in the window has a nameable auditee, so the card
           collapses back to the single list rather than showing an empty rail. */
        <div class="card" style="margin-bottom:12px;padding:12px 16px;display:flex;gap:24px;flex-wrap:wrap;">
          <div style="flex:1 1 320px;min-width:0;">
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
          {missers.length > 0 && (
            <div style="flex:1 1 320px;min-width:0;border-left:1px solid var(--border);padding-left:24px;">
              <div class="tbl-title" style="margin-bottom:8px;">Most Misses by Team Member</div>
              <div style="display:flex;flex-direction:column;gap:6px;">
                {missers.map((m, i) => (
                  <div key={m.member} style="display:flex;align-items:center;gap:10px;font-size:13px;">
                    <span class="mono" style="color:var(--text-muted);width:18px;">{i + 1}.</span>
                    <span style="color:var(--text-bright);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:40%;" title={m.member}>{m.member}</span>
                    <span style="color:var(--text-dim);">|</span>
                    <span style="flex:1;min-width:0;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title={m.worstQuestion}>{m.worstQuestion}</span>
                    <span class="pill pill-red">{m.misses} {m.misses === 1 ? "miss" : "misses"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
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
              <th>Email Opened</th>
              <th>Appeal</th>
              <th>Started</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr class="empty-row"><td colSpan={10}>No audits match the current filters</td></tr>
            ) : items.map((item) => (
              <tr key={item.findingId}>
                <td>
                  <a class="mono" style="color:var(--accent);text-decoration:none;" href={`/audit/report?id=${encodeURIComponent(item.findingId)}`}>
                    {item.findingId.slice(0, 10)}…
                  </a>
                </td>
                <td>{ownerCell(item)}</td>
                <td class="mono" style="font-size:11px;color:var(--text-muted);">{item.department ?? "\u2014"}</td>
                <td class="mono" style="font-size:11px;color:var(--text-muted);">{item.shift ?? "\u2014"}</td>
                <td>{item.score != null ? <span class={`pill pill-${pillColor(item.score)}`}>{item.score}%</span> : "\u2014"}</td>
                <td>{saleTags(item)}</td>
                <td>{reviewedBadge(item)}</td>
                <td>{emailOpenedCell(item)}</td>
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
    // `employeeId` is what the per-team-member report pins. Without it in this
    // list, that page's pagination would silently widen to the whole org on
    // page 2 — the filter would be dropped, not error.
    for (const k of ["since", "until", "owner", "employeeId", "department", "shift", "reviewed", "sale", "sort", "scoreMin", "scoreMax", "page", "limit", "as"]) {
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
    const win = {
      since: Number(url.searchParams.get("since") ?? 0) || 0,
      until: Number(url.searchParams.get("until") ?? Date.now()) || Date.now(),
    };
    // Member chips ride inside the swapped table, not out-of-band: their counts
    // deliberately ignore the member filter, so re-rendering them with the
    // table keeps the full roster visible while one person is selected.
    // Gated on `memberChips=1` so only /manager/audits gets them — /operations
    // renders this same fragment and has no chip row.
    const memberChips = url.searchParams.get("memberChips") === "1";
    const html = renderToString(
      <>
        {renderAuditHistoryTable(data, win, { memberChips, selectedMember: current.owner })}
        {renderFilterSelects(data, current, { oob: true, only: parseOobSelects(url.searchParams.get("oob")) })}
      </>,
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
