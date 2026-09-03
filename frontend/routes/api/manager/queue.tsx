/** HTMX fragment — refresh manager queue table. The table markup is exported
 *  as `renderQueueTable` (pure) so it can be unit-tested directly, mirroring
 *  `renderAuditHistoryTable` in audit-history.tsx. */
import { define } from "../../../lib/define.ts";
import { apiFetch } from "../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import type { JSX } from "preact";
// Shared with the audit-history table so both surfaces agree on what a ticked
// box means — and so the "no email sent yet" state can't drift apart.
import { emailOpenedCell } from "./audit-history.tsx";

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
  /** Audit-result email tracking, denormalized onto the queue row. Undefined
   *  `emailSentAt` = no email sent yet. */
  emailSentAt?: number;
  emailOpenedAt?: number;
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
  /** Out for appeal — a judge appeal ("appealed") or a re-audit with new audio
   *  ("re-audited"). Either way the audit's result is being contested, so it is
   *  not something to coach on yet: the row leaves the queue and shows on the
   *  Completed side under its own flag. Mirrors ManagerQueueItem. */
  appealState?: "appealed" | "re-audited";
  appealedAt?: number;
  appealedBy?: string;
  appealNote?: string;
  /** The appeal was decided and the failure stood, so the row came BACK to the
   *  queue. Shown on the row so it doesn't read as a brand-new failure. */
  appealDeniedAt?: number;
  /** The bot never got usable audio, so there is no graded question to coach —
   *  but the call not recording is itself the thing to follow up. Badged, and
   *  its 0% score suppressed as an artefact. */
  invalidGenie?: boolean;
  /** Score straight off audit-done-idx. Derived rows usually have no stored
   *  row behind them, so totalQuestions/failedCount are unknown — without this
   *  the Score column would be an em-dash on most of them. */
  score?: number;
  skippedBy?: string;
  skippedAt?: number;
}

/** Open work — still needs a manager. Mirrors isOpenQueueItem in
 *  manager-repository/mod.ts; the two must agree or a row lands in neither
 *  pane, or in both. */
export function isOpenItem(it: QueueItem): boolean {
  return it.status !== "remediated" && it.status !== "skipped" && !it.appealState;
}

/** Human label for the appeal flag. */
export function appealLabel(it: QueueItem): string {
  return it.appealState === "re-audited" ? "Re-Audited" : "Appealed";
}

/** When a row was closed out, whichever way it happened. Drives the Completed
 *  side's date window and sort, so an appealed row is ordered by when it was
 *  appealed and a remediated one by when it was written up. */
export function closedOutAt(it: QueueItem): number {
  return Math.max(it.remediatedAt ?? 0, it.appealedAt ?? 0, it.skippedAt ?? 0);
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
  // An explicit score wins: it is the audit's real, judged score off the
  // index, whereas the fallback below only re-derives one from counts.
  if (typeof item.score === "number") return Math.max(0, Math.min(100, Math.round(item.score)));
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

/** Short date + time in US Eastern for the half-width split panes. Drops the
 *  year and the ET suffix: the filter bar already states the window, both
 *  panes are the same timezone, and the full form was the widest low-value
 *  column — it pushed the Action buttons off the edge of the pane. */
const fmtTsEasternShort = (ms?: number) =>
  ms
    ? new Date(ms).toLocaleString("en-US", {
      timeZone: "America/New_York", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit",
    })
    : "—";

/** Date + time in US Eastern (auto-handles EST/EDT), labeled ET. */
const fmtTsEastern = (ms?: number) =>
  ms
    ? new Date(ms).toLocaleString("en-US", {
      timeZone: "America/New_York", month: "short", day: "numeric",
      year: "numeric", hour: "numeric", minute: "2-digit",
    }) + " ET"
    : "—";

/** Row click → the full-page remediation detail.
 *
 *  `back` carries the view you left — path AND query string — so submitting a
 *  remediation returns you to the exact filtered queue you were working
 *  (member chip, date window, sort), not a default-windowed dashboard. Before
 *  this, every submit dropped you on a bare /manager and you lost your place;
 *  that was the whole "I get lost on repeated remediations" complaint. The
 *  detail page re-checks it is a same-origin absolute path before using it.
 *
 *  Read the id off `this.dataset` — never inline it into the JS string, where
 *  a `'` would break out of the literal. */
const ROW_OPEN_JS =
  "var q=new URLSearchParams();"
  + "q.set('back',location.pathname+location.search);"
  + "var a=new URLSearchParams(location.search).get('as');if(a)q.set('as',a);"
  + "location.href='/manager/remediate/'+encodeURIComponent(this.dataset.findingId)+'?'+q.toString()";

/** Pure render of the queue table. Team Member = enriched voName (never the
 *  raw "api" owner token); Failed Questions = first two + a "+N more" hint;
 *  Score = derived pass-rate (or a "N failed" fallback when totals are unknown).
 *  `completed` mode swaps Status/Action for who remediated the item and when.
 *
 *  `compact` mode is for the Manager Portal's side-by-side split, where each
 *  table gets half the page. It drops the columns a manager doesn't read while
 *  working their own queue — Finding id, Dept/Shift (their queue is already
 *  their team), Sale, Email Opened, and the Status pill (redundant once the two
 *  states are separate tables). Compact-completed also drops Failed Questions
 *  and Score: on that side the NOTE is what you came to read, and it needs the
 *  room. Full-width surfaces (/operations, /manager/completed) are unchanged —
 *  they pass no `compact` and still get all ten columns. */
export function renderQueueTable(
  items: QueueItem[],
  opts: { completed?: boolean; compact?: boolean } = {},
): JSX.Element {
  const completed = !!opts.completed;
  const compact = !!opts.compact;
  const showFails = !(compact && completed);
  const showScore = !(compact && completed);
  const colCount = compact ? 5 : (completed ? 11 : 10);
  return (
    <table class="data-table">
      <thead>
        <tr>
          {!compact && <th>Finding</th>}
          <th>Team Member</th>
          {!compact && <th>Dept / Shift</th>}
          {showFails && <th>Failed Questions</th>}
          {!compact && <th>Sale</th>}
          {showScore && <th>Score</th>}
          {!compact && <th>Email Opened</th>}
          {completed
            ? <><th>Outcome</th><th>By</th><th>When</th><th>Notes</th></>
            : <><th>Timestamp</th>{!compact && <th>Status</th>}<th>Action</th></>}
        </tr>
      </thead>
      <tbody>
        {items.length === 0 ? (
          <tr class="empty-row"><td colSpan={colCount}>{completed ? "No completed remediations" : "No items in queue"}</td></tr>
        ) : items.map((item) => {
          const score = scoreOf(item);
          // Name the three Score states (derived pass-rate / 'N failed' / em-dash)
          // instead of nesting a two-level ternary inside the <td>.
          // An invalid-genie audit was never graded — the 0% the pipeline
          // stores is an artefact of "no audio", not a result, and showing it
          // as a red 0% pill reads as a catastrophic call.
          const scoreCell = item.invalidGenie
            ? <span style="color:var(--text-dim);font-size:11px;white-space:nowrap;">not graded</span>
            : score != null
            ? <span class={`pill pill-${pillColor(score)}`}>{score}%</span>
            : item.failedCount != null
              ? <span class="pill pill-red">{item.failedCount} failed</span>
              : "—";
          const fails = item.failedQuestions ?? [];
          const failsCell = item.invalidGenie && fails.length === 0
            ? <span style="color:var(--text-dim);font-size:11px;white-space:nowrap;">no audio to grade</span>
            : fails.length === 0
            ? <span style="color:var(--text-dim);font-size:11px;">—</span>
            : (
              <div style={`font-size:11px;color:var(--text-muted);max-width:${compact ? "220px" : "420px"};`}>
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
            {...{ "hx-on:click": ROW_OPEN_JS }}
          >
            {!compact && <td class="mono">{item.findingId?.slice(0, 8)}</td>}
            {/* The row itself navigates to the remediation detail, so the name
                link must stopPropagation or a click would fire both. Unlinked
                when the item has no employee id — a name-built link would open
                whichever person happens to share that name. */}
            <td>
              {/* Name + badges on one centred line — see .tm-cell. */}
              <div class="tm-cell">
                {item.employeeId
                  ? (
                    <a
                      href={`/manager/team/${encodeURIComponent(item.employeeId)}`}
                      title={`See every audit for ${teamMemberLabel(item)}`}
                      class="tm-link"
                      {...{ "hx-on:click": "event.stopPropagation()" }}
                    >{teamMemberLabel(item)}</a>
                  )
                  : <span>{teamMemberLabel(item)}</span>}
                {/* This row LEFT the queue when it was appealed and came back
                    when the judge let the failure stand. Without a marker it
                    reads as a brand-new failure, and a manager who already saw
                    it go would reasonably think the queue was glitching.
                    Pending side only — on the Completed side the Outcome
                    column carries the story. */}
                {!completed && item.appealDeniedAt && (
                  <span
                    class="pill pill-red"
                    style="font-size:9px;"
                    title="Appealed, but the judge let the failure stand — it still needs coaching"
                  >Appeal denied</span>
                )}
                {/* No usable audio, so nothing was graded. The row is still
                    real work — the call did not record and someone has to find
                    out why — but a manager needs to know that BEFORE opening
                    it, or they go looking for a failed question that isn't
                    there. */}
                {item.invalidGenie && (
                  <span
                    class="pill pill-purple"
                    style="font-size:9px;"
                    title="The recording was missing or unusable, so the bot could not grade this call"
                  >Invalid genie</span>
                )}
              </div>
            </td>
            {!compact && (
              <td style="font-size:11px;color:var(--text-muted);white-space:nowrap;">
                {item.department || "—"}{item.shift ? ` · ${item.shift}` : ""}
              </td>
            )}
            {showFails && <td>{failsCell}</td>}
            {!compact && <td>{saleCell}</td>}
            {showScore && <td>{scoreCell}</td>}
            {!compact && <td>{emailOpenedCell(item)}</td>}
            {completed ? <>
              {/* How this audit left the queue. A row can carry BOTH marks —
                  appealing does not stop a manager coaching it as well — so
                  these are two independent pills, not one either/or label. */}
              <td>
                <div class="outcome-cell">
                  {item.status === "remediated" && <span class="pill pill-green">Remediated</span>}
                  {item.status === "skipped" && <span class="pill pill-muted" title="Closed out without a remediation note">Skipped</span>}
                  {item.invalidGenie && <span class="pill pill-purple">Invalid genie</span>}
                  {item.appealState && (
                    <span class={`pill pill-${item.appealState === "re-audited" ? "blue" : "yellow"}`}>
                      {appealLabel(item)}
                    </span>
                  )}
                </div>
              </td>
              <td style="font-size:12px;">{item.remediatedBy || item.skippedBy || item.appealedBy || "—"}</td>
              <td style="font-size:12px;color:var(--text-muted);white-space:nowrap;">{fmtWhen(closedOutAt(item) || undefined)}</td>
              {/* What the manager actually DID about the failure. Until now it
                  was written into a required textarea and then readable
                  nowhere in the app but a title-attribute tooltip on the detail
                  page. One clamped line here, a bigger clamped popout on hover,
                  and the row click (already wired) opens the full note on the
                  detail page — CSS only, because this fragment is HTMX-swapped
                  and an island in it would never hydrate (CLAUDE.md Gotcha #1). */}
              <td class="rem-note-cell">
                {/* The remediation write-up when there is one; otherwise the
                    comment left when the audit was appealed, which is the only
                    thing written about the row on that path. The Outcome pill
                    says which of the two you are reading. */}
                {(item.notes || item.appealNote)
                  ? <>
                    <span class="rem-note-line">{item.notes || item.appealNote}</span>
                    <span class="rem-note-pop" role="tooltip">{item.notes || item.appealNote}</span>
                  </>
                  : <span style="color:var(--text-dim);font-size:11px;">&mdash;</span>}
              </td>
            </> : <>
            <td style="font-size:12px;color:var(--text-muted);white-space:nowrap;">
              {compact ? fmtTsEasternShort(queueTimestamp(item)) : fmtTsEastern(queueTimestamp(item))}
            </td>
            {!compact && <td><span class={`pill pill-${item.status === "remediated" ? "green" : "yellow"}`}>{item.status ?? "pending"}</span></td>}
            <td {...{ "hx-on:click": "event.stopPropagation()" }}>
              {/* Side by side with real spacing — see .row-actions. */}
              <div class="row-actions">
              {/* Carry the id on a data-attribute (Preact attribute-escapes it)
                  and read it via this.dataset — never inline it into the JS
                  string, where a `'` would break out of the literal. */}
              <button
                class="btn btn-ghost btn-sm"
                data-finding-id={item.findingId}
                {...{ "hx-on:click": "event.stopPropagation();document.getElementById('remediate-modal')?.classList.add('open');document.getElementById('rem-findingId').value=this.dataset.findingId;var rt=document.getElementById('rem-returnTo');if(rt)rt.value=location.pathname+location.search" }}
              >Remediate</button>
              {/* Skip closes the row with no write-up. It posts through the
                  page's hidden skip form rather than carrying its own, so the
                  username comes from the server-rendered value and can't be
                  spoofed by editing the row. Confirmed because it is
                  one-click and otherwise indistinguishable from a misclick. */}
              <button
                class="btn btn-ghost btn-sm"
                style="opacity:0.75;"
                data-finding-id={item.findingId}
                title="Close this out without recording a remediation"
                {...{ "hx-on:click": "event.stopPropagation();if(!confirm('Skip this audit? It closes without a remediation note.'))return;var f=document.getElementById('skip-form');if(!f)return;document.getElementById('skip-findingId').value=this.dataset.findingId;var rt=document.getElementById('skip-returnTo');if(rt)rt.value=location.pathname+location.search;htmx.trigger(f,'skip-now')" }}
              >Skip</button>
              </div>
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
export function renderQueueResults(rows: QueueItem[], opts: { compact?: boolean } = {}): JSX.Element {
  return (
    <>
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;">
        Window total:{" "}
        <strong style="color:var(--text-muted);">{rows.length}</strong>{" "}
        {rows.length === 1 ? "failure" : "failures"} in the selected date range
      </div>
      <div style="overflow-x:auto;">{renderQueueTable(rows, { compact: !!opts.compact })}</div>
    </>
  );
}

/** The Completed side of the Manager Portal's split view.
 *
 *  Shares the member / failed-question / sale / department filters with the
 *  queue — that's the point of the split: pick "Natalia Reyes" once and see
 *  what's left for her next to what you've already closed out.
 *
 *  Two deliberate differences from `filterAndSortQueue`:
 *
 *  1. The date window is applied to `remediatedAt` (WHEN YOU CLOSED IT OUT),
 *     not `queueTimestamp` (when the audit happened). Remediating a three-week-
 *     old audit has to show up in a "last 7 days" view, or the row you just
 *     submitted disappears from both panes and you're left wondering whether it
 *     saved at all.
 *  2. Only `since` is applied — the window is open-ended at the top. Every
 *     open-ended preset (Today / This week / 7D / 30D / All time) freezes
 *     `until` at the moment it was clicked, so honoring it would hide a
 *     remediation submitted after the page first loaded — precisely the row the
 *     manager is looking for. The pane header states the range it's showing.
 *
 *  Always newest-remediation-first; the queue's sort control is about triage
 *  order and doesn't apply to a history list. */
export function filterCompleted(items: QueueItem[], params: QueueFilterParams): QueueItem[] {
  const member = (params.member ?? "").trim().toLowerCase();
  const q = (params.q ?? "").trim();
  const wgs = !!params.wgs;
  const mcc = !!params.mcc;
  const since = typeof params.since === "number" ? params.since : undefined;
  const dept = (params.dept ?? "").trim();

  return items
    // Anything closed out, however it closed: written up, or taken off the
    // table by an appeal. An audit under appeal is not open work.
    .filter((it) => !isOpenItem(it))
    .filter((it) => {
      if (dept && (it.department ?? "") !== dept) return false;
      // since=0 is the All-time preset — keep everything.
      if (since != null && since > 0 && closedOutAt(it) < since) return false;
      if (member && !teamMemberLabel(it).toLowerCase().includes(member)) return false;
      if (q && !(it.failedQuestions ?? []).includes(q)) return false;
      if ((wgs || mcc) && !((wgs && it.wgs) || (mcc && it.mcc))) return false;
      return true;
    })
    .sort((a, b) => closedOutAt(b) - closedOutAt(a));
}

/** Completed-side caption + compact table, the mirror of `renderQueueResults`.
 *  The caption spells out the window because this side ignores `until` (see
 *  `filterCompleted`) — a manager should never have to guess which dates a
 *  count covers. */
export function renderCompletedResults(rows: QueueItem[], params: QueueFilterParams): JSX.Element {
  const appealed = rows.filter((r) => !!r.appealState).length;
  const since = typeof params.since === "number" ? params.since : 0;
  const sinceLabel = since > 0
    ? new Date(since).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" })
    : "";
  return (
    <>
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;">
        <strong style="color:var(--text-muted);">{rows.length}</strong>{" "}
        {rows.length === 1 ? "audit" : "audits"}{" "}
        {sinceLabel ? <>closed out since {sinceLabel}</> : <>closed out, all time</>}
        {appealed > 0 && <> · <strong style="color:var(--text-muted);">{appealed}</strong> under appeal</>}
      </div>
      <div style="overflow-x:auto;">{renderQueueTable(rows, { completed: true, compact: true })}</div>
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
      // The queue side shows open work only. Anything closed out — remediated,
      // or taken off the table by an appeal — goes to the Completed side of the
      // split (below), or on /operations and the standalone /manager/completed
      // page, to their own tab.
      const pending = (items ?? []).filter(isOpenItem);
      const params = readQueueFilterParams(url.searchParams);
      const rows = filterAndSortQueue(pending, params);
      // Manager Portal only: the two states sit side by side on one page, so a
      // filter change has to refresh BOTH. Gated on `split=1` (only that form
      // sends it) for the same reason `members=1` is — /operations posts to
      // this endpoint from a form with the same id and has no such target, and
      // an unconditional OOB block throws htmx:oobErrorNoTarget over there.
      const withSplit = url.searchParams.get("split") === "1";
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
          {renderQueueResults(rows, { compact: withSplit })}
          {withMembers && (
            <div id="queue-member-buttons" hx-swap-oob="true">
              {renderMemberButtons(pending, params)}
            </div>
          )}
          {withSplit && (
            <div id="manager-completed-table" hx-swap-oob="true">
              {renderCompletedResults(filterCompleted(items ?? [], params), params)}
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
