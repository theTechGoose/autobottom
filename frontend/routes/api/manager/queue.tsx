/** HTMX fragment — refresh manager queue table. The table markup is exported
 *  as `renderQueueTable` (pure) so it can be unit-tested directly, mirroring
 *  `renderAuditHistoryTable` in audit-history.tsx. */
import { define } from "../../../lib/define.ts";
import { apiFetch } from "../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import type { JSX } from "preact";

/** Mirrors the backend `ManagerQueueItem` shape (manager-repository/mod.ts):
 *  the queue carries `owner` + `failedCount`/`totalQuestions`, NOT a precomputed
 *  agentEmail/score. Derive the displayed score here. */
export interface QueueItem {
  findingId: string;
  owner?: string;
  voName?: string;
  /** QuickBase employee id. Present only on items queued since 2026-08-10 —
   *  older rows render an unlinked name rather than guessing from it. */
  employeeId?: string;
  status?: string;
  addedAt?: number;
  completedAt?: number;
  failedCount?: number;
  totalQuestions?: number;
  failedQuestions?: string[];
  wgs?: boolean;
  mcc?: boolean;
  department?: string;
  shift?: string;
  isPackage?: boolean;
  remediatedBy?: string;
  remediatedAt?: number;
  notes?: string;
}

/** Team member display name: enriched voName first, then a real owner email's
 *  local-part — never the "api" placeholder the pipeline writes for API audits. */
function teamMemberLabel(item: QueueItem): string {
  if (item.voName) return item.voName;
  if (item.owner && item.owner !== "api") return item.owner.split("@")[0];
  return "—";
}

function pillColor(score: number | null) {
  if (score == null) return "blue";
  if (score >= 90) return "green";
  if (score >= 70) return "yellow";
  return "red";
}

/** Pass-rate from failed/total. Returns null when total is unknown so the
 *  cell falls back to a "N failed" label instead of a misleading 0%/100%. */
function scoreOf(item: QueueItem): number | null {
  if (item.totalQuestions == null || item.totalQuestions <= 0) return null;
  const failed = item.failedCount ?? 0;
  // Clamp to [0,100] so a backend that ever reports failed > total (or a
  // stray negative) can't render a -10% / 110% pill.
  return Math.max(0, Math.min(100, Math.round((1 - failed / item.totalQuestions) * 100)));
}

const fmtWhen = (ms?: number) =>
  ms ? new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

/** Best available "audit time" for a queue row: the audit's review-completion
 *  time (completedAt), falling back to when it entered the queue (addedAt) for
 *  the newest rows that don't carry completedAt yet — the same convention the
 *  repository uses. No per-row hydration, so no extra reads. */
export function queueTimestamp(it: QueueItem): number {
  return it.completedAt ?? it.addedAt ?? 0;
}

/** Date + time in US Eastern (auto-handles EST/EDT), labeled ET. */
const fmtTsEastern = (ms?: number) =>
  ms
    ? new Date(ms).toLocaleString("en-US", {
      timeZone: "America/New_York", month: "short", day: "numeric",
      year: "numeric", hour: "numeric", minute: "2-digit",
    }) + " ET"
    : "—";

/** Pure render of the queue table. Team Member = enriched voName (never the
 *  raw "api" owner token); Failed Questions = first two + a "+N more" hint;
 *  Score = derived pass-rate (or a "N failed" fallback when totals are unknown).
 *  `completed` mode (the Completed tab) swaps Status/Action for who
 *  remediated the item and when. */
export function renderQueueTable(items: QueueItem[], opts: { completed?: boolean } = {}): JSX.Element {
  const completed = !!opts.completed;
  return (
    <table class="data-table">
      <thead><tr><th>Finding</th><th>Team Member</th><th>Dept / Shift</th><th>Failed Questions</th><th>Sale</th><th>Score</th>{completed ? <><th>Remediated By</th><th>When</th><th>Notes</th></> : <><th>Timestamp</th><th>Status</th><th>Action</th></>}</tr></thead>
      <tbody>
        {items.length === 0 ? (
          <tr class="empty-row"><td colSpan={completed ? 9 : 9}>{completed ? "No completed remediations" : "No items in queue"}</td></tr>
        ) : items.map((item) => {
          const score = scoreOf(item);
          // Name the three Score states (derived pass-rate / 'N failed' / em-dash)
          // instead of nesting a two-level ternary inside the <td>.
          const scoreCell = score != null
            ? <span class={`pill pill-${pillColor(score)}`}>{score}%</span>
            : item.failedCount != null
              ? <span class="pill pill-red">{item.failedCount} failed</span>
              : "\u2014";
          const fails = item.failedQuestions ?? [];
          const failsCell = fails.length === 0
            ? <span style="color:var(--text-dim);font-size:11px;">\u2014</span>
            : (
              <div style="font-size:11px;color:var(--text-muted);max-width:420px;">
                {fails.slice(0, 2).map((q) => (
                  <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{q}</div>
                ))}
                {fails.length > 2 && <div style="color:var(--text-dim);">+{fails.length - 2} more</div>}
              </div>
            );
          // WGS/MCC sale tags; dim dash for none-sold or not-yet-enriched rows.
          const saleTags = [
            ...(item.wgs ? ["WGS"] : []),
            ...(item.mcc ? ["MCC"] : []),
          ];
          const saleCell = saleTags.length === 0
            ? <span style="color:var(--text-dim);font-size:11px;">—</span>
            : <span>{saleTags.map((t) => <span class={`pill pill-${t === "WGS" ? "green" : "blue"}`} style="margin-right:4px;">{t}</span>)}</span>;
          return (
          <tr
            key={item.findingId}
            style="cursor:pointer;"
            data-finding-id={item.findingId}
            title="Open remediation detail"
            {...{ "hx-on:click": "var a=new URLSearchParams(location.search).get('as');location.href='/manager/remediate/'+encodeURIComponent(this.dataset.findingId)+(a?('?as='+encodeURIComponent(a)):'')" }}
          >
            <td class="mono">{item.findingId?.slice(0, 8)}</td>
            {/* The row itself navigates to the remediation detail, so the name
                link must stopPropagation or a click would fire both. Unlinked
                when the item has no employee id — a name-built link would open
                whichever person happens to share that name. */}
            <td>
              {item.employeeId
                ? (
                  <a
                    href={`/manager/team/${encodeURIComponent(item.employeeId)}`}
                    title={`See every audit for ${teamMemberLabel(item)}`}
                    style="color:var(--accent);text-decoration:none;"
                    {...{ "hx-on:click": "event.stopPropagation()" }}
                  >{teamMemberLabel(item)}</a>
                )
                : teamMemberLabel(item)}
            </td>
            <td style="font-size:11px;color:var(--text-muted);white-space:nowrap;">
              {item.department || "—"}{item.shift ? ` · ${item.shift}` : ""}
            </td>
            <td>{failsCell}</td>
            <td>{saleCell}</td>
            <td>{scoreCell}</td>
            {completed ? <>
              <td style="font-size:12px;">{item.remediatedBy || "\u2014"}</td>
              <td style="font-size:12px;color:var(--text-muted);white-space:nowrap;">{fmtWhen(item.remediatedAt)}</td>
              {/* What the manager actually DID about the failure. Until now it
                  was written into a required textarea and then readable
                  nowhere in the app but a title-attribute tooltip on the detail
                  page. One clamped line here, a bigger clamped popout on hover,
                  and the row click (already wired) opens the full note on the
                  detail page \u2014 CSS only, because this fragment is HTMX-swapped
                  and an island in it would never hydrate (CLAUDE.md Gotcha #1). */}
              <td class="rem-note-cell">
                {item.notes
                  ? <>
                    <span class="rem-note-line">{item.notes}</span>
                    <span class="rem-note-pop" role="tooltip">{item.notes}</span>
                  </>
                  : <span style="color:var(--text-dim);font-size:11px;">&mdash;</span>}
              </td>
            </> : <>
            <td style="font-size:12px;color:var(--text-muted);white-space:nowrap;">{fmtTsEastern(queueTimestamp(item))}</td>
            <td><span class={`pill pill-${item.status === "remediated" ? "green" : "yellow"}`}>{item.status ?? "pending"}</span></td>
            <td {...{ "hx-on:click": "event.stopPropagation()" }}>
              {/* Carry the id on a data-attribute (Preact attribute-escapes it)
                  and read it via this.dataset \u2014 never inline it into the JS
                  string, where a `'` would break out of the literal. */}
              <button
                class="btn btn-ghost btn-sm"
                data-finding-id={item.findingId}
                {...{ "hx-on:click": "event.stopPropagation();document.getElementById('remediate-modal')?.classList.add('open');document.getElementById('rem-findingId').value=this.dataset.findingId" }}
              >Remediate</button>
            </td>
            </>}
          </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Filtering / sorting (all in-memory over the already-loaded queue) ─────────
// Every field these touch (team member, failed questions, WGS/MCC, fail counts,
// addedAt) is already on each queue row, so filtering/sorting adds ZERO extra
// Firestore/KV reads — it's pure work on the single list the queue loads anyway.

const DAY_MS = 86_400_000;
export const DEFAULT_WINDOW_DAYS = 7;

export interface QueueFilterParams {
  member?: string;
  q?: string;
  wgs?: boolean;
  mcc?: boolean;
  sort?: string; // "recent" (default) | "oldest" | "failpct"
  since?: number; // window start (ms); rows are kept by queueTimestamp()
  until?: number; // window end (ms)
  /** Single-department narrowing for the Operations Portal's department rail.
   *  Empty = every department in the caller's scope (the manager default).
   *  This is a NARROWING filter over an already scope-filtered list — the
   *  backend has stripped out-of-scope rows before we ever see them, so it
   *  can't be used to reach another team's queue. */
  dept?: string;
}

/** Read the queue filter/sort selections off a query string. Shared by the
 *  page (initial render) and this fragment (filter refresh) so both parse
 *  identically. The date window defaults to the last 7 days when absent;
 *  since=0 means "all time" (the All button). */
export function readQueueFilterParams(sp: URLSearchParams): QueueFilterParams {
  const now = Date.now();
  const ms = (v: string | null): number | undefined => {
    if (v == null || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    member: sp.get("member") ?? "",
    q: sp.get("q") ?? "",
    wgs: sp.get("wgs") === "1",
    mcc: sp.get("mcc") === "1",
    sort: sp.get("sort") ?? "recent",
    since: ms(sp.get("since")) ?? (now - DEFAULT_WINDOW_DAYS * DAY_MS),
    until: ms(sp.get("until")) ?? now,
    dept: sp.get("dept") ?? "",
  };
}

/** Distinct team-member labels + failed-question texts present in the queue,
 *  used to populate the filter bar's autosuggest + question dropdown. Derived
 *  from the loaded list — no extra reads. */
export function queueFacets(items: QueueItem[]): { members: string[]; questions: string[] } {
  const members = new Set<string>();
  const questions = new Set<string>();
  for (const it of items) {
    const label = teamMemberLabel(it);
    if (label && label !== "—") members.add(label);
    for (const q of it.failedQuestions ?? []) if (q) questions.add(q);
  }
  return {
    members: [...members].sort((a, b) => a.localeCompare(b)),
    questions: [...questions].sort((a, b) => a.localeCompare(b)),
  };
}

/** Percentage of questions failed (failed ÷ total). Rows with an unknown total
 *  return -1 so they sink to the bottom of a "highest % failed" sort instead of
 *  masquerading as 0% or 100%. */
function failPct(it: QueueItem): number {
  if (it.totalQuestions == null || it.totalQuestions <= 0) return -1;
  return (it.failedCount ?? 0) / it.totalQuestions;
}

export function filterAndSortQueue(items: QueueItem[], params: QueueFilterParams): QueueItem[] {
  const member = (params.member ?? "").trim().toLowerCase();
  const q = (params.q ?? "").trim();
  const wgs = !!params.wgs;
  const mcc = !!params.mcc;
  const sort = params.sort || "recent";
  const since = typeof params.since === "number" ? params.since : undefined;
  const until = typeof params.until === "number" ? params.until : undefined;
  const dept = (params.dept ?? "").trim();

  const out = items.filter((it) => {
    // Exact department match — department names are stored whole ("ODS WFH"
    // is one department, not dept+shift), so no substring matching here.
    if (dept && (it.department ?? "") !== dept) return false;
    // Date window over the audit time (queueTimestamp). since=0 keeps everything.
    if (since != null || until != null) {
      const ts = queueTimestamp(it);
      if (since != null && ts < since) return false;
      if (until != null && ts > until) return false;
    }
    if (member && !teamMemberLabel(it).toLowerCase().includes(member)) return false;
    if (q && !(it.failedQuestions ?? []).includes(q)) return false;
    // Sale union: no box checked → no restriction; otherwise keep a row that
    // sold ANY of the checked sale types (WGS and/or MCC).
    if ((wgs || mcc) && !((wgs && it.wgs) || (mcc && it.mcc))) return false;
    return true;
  });

  if (sort === "failpct") out.sort((a, b) => failPct(b) - failPct(a));
  else if (sort === "oldest") out.sort((a, b) => queueTimestamp(a) - queueTimestamp(b));
  else out.sort((a, b) => queueTimestamp(b) - queueTimestamp(a)); // recent (default)
  return out;
}

/** One button per team member with work in the CURRENT view, newest filter
 *  state applied — except the member filter itself, so every name stays
 *  visible and you can switch straight from one person to another instead of
 *  clearing first.
 *
 *  This replaced a free-text "Search name…" box. Counts are the point: a
 *  manager opens this page to see who needs attention, and the old box made
 *  you already know the name before it could tell you anything.
 *
 *  Filtering is by NAME, not employee id, on purpose. Items queued before
 *  2026-08-10 carry no id, so an id-based filter would hide most of the
 *  existing queue. The trade-off is that two people sharing a name share a
 *  button — the row's name link is id-based and stays exact.
 *
 *  The leading "All" chip is not decoration. The first cut relied on clicking
 *  the selected name a second time to un-filter, which works but is invisible —
 *  a manager who picked a person had no way to see that, and the only visible
 *  exit was the Clear link, which also throws away their window and sort. "All"
 *  makes going back a thing you can SEE. The toggle still works too. */
export function renderMemberButtons(
  items: QueueItem[],
  params: QueueFilterParams,
): JSX.Element {
  // Everything except the member filter, so the buttons don't filter themselves
  // down to the one person already selected.
  const inView = filterAndSortQueue(items, { ...params, member: "" });
  const counts = new Map<string, number>();
  for (const it of inView) {
    const label = teamMemberLabel(it);
    if (!label || label === "—") continue;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  // Busiest first — that's the coaching order. Name breaks ties so the row
  // doesn't reshuffle between refreshes.
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const selected = (params.member ?? "").trim();

  if (ranked.length === 0) {
    return <div style="font-size:11px;color:var(--text-dim);margin-bottom:10px;">No team members with open items in this range.</div>;
  }

  // Shared by the "All" chip and every name chip: write the member filter and
  // refresh the table. `source` makes htmx serialize the whole filter form, so
  // the window / question / sale / sort selections all survive.
  const setMemberJs = (expr: string) =>
    `(()=>{const m=document.getElementById('q-member');if(!m)return;m.value=${expr};`
    + `htmx.ajax('GET','/api/manager/queue',{source:'#queue-filters',target:'#manager-queue-table',swap:'innerHTML'});})()`;

  return (
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
      <button
        type="button"
        class={`btn btn-sm ${selected ? "btn-ghost" : ""}`}
        title="Show every team member"
        {...{ "hx-on:click": setMemberJs("''") }}
      >
        All
        <span style="margin-left:6px;opacity:0.7;font-variant-numeric:tabular-nums;">{inView.length}</span>
      </button>
      {ranked.map(([name, count]) => {
        const active = selected.toLowerCase() === name.toLowerCase();
        // Clicking the active chip also clears — kept as a convenience, but
        // "All" above is the discoverable way back.
        const js = setMemberJs(
          `(m.value.toLowerCase()===${JSON.stringify(name.toLowerCase())})?'':${JSON.stringify(name)}`,
        );
        return (
          <button
            key={name}
            type="button"
            class={`btn btn-sm ${active ? "" : "btn-ghost"}`}
            title={active ? `Showing only ${name} — click for everyone` : `Show only ${name}`}
            {...{ "hx-on:click": js }}
          >
            {name}
            <span style={`margin-left:6px;opacity:0.7;font-variant-numeric:tabular-nums;`}>{count}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The queue table plus a small "window total" caption above it. Rendered by
 *  both the page (initial) and the fragment (filter refresh) so the count and
 *  table always swap together and agree. */
export function renderQueueResults(rows: QueueItem[]): JSX.Element {
  return (
    <>
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;">
        Window total:{" "}
        <strong style="color:var(--text-muted);">{rows.length}</strong>{" "}
        {rows.length === 1 ? "failure" : "failures"} in the selected date range
      </div>
      <div style="overflow-x:auto;">{renderQueueTable(rows)}</div>
    </>
  );
}

export const handler = define.handlers({
  async GET(ctx) {
    try {
      const url = new URL(ctx.req.url);
      // Forward `as` so an admin impersonating a manager (?as=<email>) gets
      // that manager's scoped queue — same convention as audit-history.
      const asEmail = url.searchParams.get("as");
      const qs = asEmail ? `?as=${encodeURIComponent(asEmail)}` : "";
      const { items } = await apiFetch<{ items: QueueItem[] }>(`/manager/api/queue${qs}`, ctx.req);
      // The Queue tab shows open work only — completed (remediated) items
      // live on the /manager/completed tab.
      const pending = (items ?? []).filter((i) => i.status !== "remediated");
      const params = readQueueFilterParams(url.searchParams);
      const rows = filterAndSortQueue(pending, params);
      // The member buttons live OUTSIDE the swapped table (they'd filter
      // themselves down to one name if they were inside it), so they ride
      // along as an out-of-band swap. Without this their counts would keep
      // whatever the page first loaded with while the table moved on.
      //
      // Gated on `members=1`, which only the Manager Portal's form sends.
      // /operations posts to this same endpoint with the same #queue-filters
      // form id but has no button row — an unconditional OOB block would throw
      // htmx:oobErrorNoTarget on every filter change over there.
      const withMembers = url.searchParams.get("members") === "1";
      const html = renderToString(
        <>
          {renderQueueResults(rows)}
          {withMembers && (
            <div id="queue-member-buttons" hx-swap-oob="true">
              {renderMemberButtons(pending, params)}
            </div>
          )}
        </>,
      );
      return new Response(html, { headers: { "content-type": "text/html" } });
    } catch {
      return new Response(
        `<div class="placeholder-card">Failed to load queue</div>`,
        { headers: { "content-type": "text/html" } },
      );
    }
  },
});
