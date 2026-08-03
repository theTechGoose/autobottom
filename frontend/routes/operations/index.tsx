/** Operations Portal — the operations manager's home.
 *
 *  An operations manager sits over SEVERAL department managers. The app's
 *  sidebar becomes the department switcher (cards, not nav links — see
 *  `depts` on Layout/Sidebar), and the whole main area is whichever
 *  department is selected:
 *
 *    - a department  → three tabs: Outstanding Remediation / Completed /
 *                      Audit History, each the manager view for that one team
 *    - All departments → a roll-up comparing every department they own
 *                      (pending, oldest waiting item, average score)
 *
 *  Everything is server-rendered; departments and tabs are plain links, so
 *  there is no island here (see frontend/CLAUDE.md — islands only when the UI
 *  physically can't work without client JS).
 *
 *  Data cost is deliberately flat. ONE queue read serves the sidebar counts,
 *  the header, the Outstanding tab and the Completed tab. The roll-up and the
 *  Audit History tab each add ONE audit-history read — never a read per
 *  department (the backend buckets by department in the same pass it already
 *  makes; see `deptRollup` in manager/domain/business/audit-history). That
 *  restraint is the no-hydration-on-dashboard-paths lesson.
 *
 *  Scope safety: `/manager/api/queue` and `/manager/api/audit-history` filter
 *  to the caller's own scope on the BACKEND before this page sees anything.
 *  The `dept` selection here only narrows further — it can never widen, so a
 *  hand-typed department outside the ops manager's scope returns nothing. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import type { SbDept } from "../../components/Sidebar.tsx";
import { apiFetch } from "../../lib/api.ts";
import {
  renderQueueResults, renderQueueTable, queueFacets, filterAndSortQueue,
  readQueueFilterParams, queueTimestamp, type QueueItem,
} from "../api/manager/queue.tsx";
import { renderAuditHistoryTable, renderFilterSelect, type AuditHistoryData, type DeptRollup } from "../api/manager/audit-history.tsx";

interface ManagerScope {
  departments: string[];
  shifts: string[];
}

/** Per-department queue rollup for the sidebar cards and the overview. */
export interface DeptStat {
  name: string;
  pending: number;
  remediated: number;
  /** Timestamp of the OLDEST pending item, or 0 when the department is clear. */
  oldestPendingTs: number;
}

const DAY_MS = 86_400_000;
const TABS = ["outstanding", "completed", "audits"] as const;
type Tab = typeof TABS[number];

/** Compact "how long has this been sitting" label — 45m / 6h / 9d. */
export function shortAge(ms: number): string {
  const delta = Date.now() - ms;
  if (!Number.isFinite(delta) || delta < 0) return "—";
  const mins = Math.floor(delta / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

/** Age colour: a queue nobody has touched in two weeks should look wrong. */
export function ageColor(ms: number): string {
  const days = (Date.now() - ms) / DAY_MS;
  if (days >= 14) return "var(--red)";
  if (days >= 7) return "var(--yellow)";
  return "var(--text-dim)";
}

function scorePillColor(score: number | null): string {
  if (score == null) return "blue";
  if (score >= 90) return "green";
  if (score >= 70) return "yellow";
  return "red";
}

/** Roll the (already scope-filtered) queue up per department. Pure in-memory
 *  work over the one list the page loads anyway — zero extra reads. */
export function deptStats(items: QueueItem[], deptNames: string[]): DeptStat[] {
  const byName = new Map<string, DeptStat>();
  for (const name of deptNames) {
    byName.set(name, { name, pending: 0, remediated: 0, oldestPendingTs: 0 });
  }
  for (const item of items) {
    const name = item.department ?? "";
    const stat = byName.get(name);
    if (!stat) continue;
    if (item.status === "remediated") {
      stat.remediated += 1;
      continue;
    }
    stat.pending += 1;
    const ts = queueTimestamp(item);
    if (ts > 0 && (stat.oldestPendingTs === 0 || ts < stat.oldestPendingTs)) {
      stat.oldestPendingTs = ts;
    }
  }
  // Busiest first, so the department needing attention is at the top; ties
  // fall back to alphabetical for a stable order across refreshes.
  return [...byName.values()].sort((a, b) => b.pending - a.pending || a.name.localeCompare(b.name));
}

/** Page-scoped CSS. Exported so a rendering test can mount OverviewCard with
 *  the same styles the page uses. */
export const OPS_STYLES = `
  .ops-tab{ display:inline-block; padding:8px 16px; text-decoration:none; font-size:13px;
    font-weight:600; color:var(--text-muted); border:1px solid var(--border);
    border-bottom:none; border-radius:8px 8px 0 0; background:var(--bg-card); }
  .ops-tab.is-active{ color:var(--text-bright); border-color:var(--accent); background:var(--accent-bg); }
  /* Overview: one department per row, full width. */
  .ops-cards{ display:grid; grid-template-columns:1fr; gap:14px; }
  .ops-card{ display:block; padding:14px 16px; text-decoration:none; color:inherit;
    transition:border-color .12s, background .12s; }
  .ops-card:hover{ border-color:var(--accent); background:var(--accent-bg); }
  .ops-card-head{ display:flex; align-items:center; justify-content:space-between;
    gap:12px; padding-bottom:10px; border-bottom:1px solid var(--border); margin-bottom:10px; }
  .ops-card-name{ font-size:15px; font-weight:700; color:var(--text-bright);
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .ops-card-stats{ display:flex; align-items:center; gap:6px; flex-wrap:wrap;
    font-size:12px; color:var(--text-muted); margin-bottom:12px; }
  .ops-dot{ color:var(--text-dim); }
  .ops-card-detail{ display:flex; gap:10px; font-size:12px; margin-top:8px; }
  .ops-card-label{ width:74px; flex-shrink:0; font-size:10px; font-weight:700;
    letter-spacing:.06em; text-transform:uppercase; color:var(--text-dim); padding-top:2px; }
  /* Capped so the miss count stays beside its question instead of being
     flung to the far edge of a full-width card. */
  .ops-miss{ display:flex; align-items:center; gap:6px; margin-bottom:3px; max-width:820px; }
  .ops-miss-text{ flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis;
    white-space:nowrap; color:var(--text-muted); }
  .ah-update .ah-update-spin{ display:none; }
  .ah-update.is-loading .ah-update-text{ display:none; }
  .ah-update.is-loading .ah-update-spin{ display:inline-block; }
  .ah-update:disabled{ opacity:0.4; cursor:default; box-shadow:none; }
  .ah-update.is-dirty{ opacity:1; box-shadow:0 0 0 2px rgba(129,140,248,0.55); }
`;

/** One department's card in the all-departments overview: live queue state in
 *  the header, then the window's audit numbers, weakest auditee, and the
 *  three questions this department misses most.
 *
 *  Exported (and pure) so its populated states are testable — locally the
 *  queue is always empty, so the rich version never renders in dev. */
export function OverviewCard(
  { stat, audit, href }: { stat: DeptStat; audit: DeptRollup | null; href: string },
) {
  const scored = audit ? audit.passed + audit.failed : 0;
  return (
    <a href={href} class="card ops-card" title={`Open ${stat.name}`}>
      <div class="ops-card-head">
        <div class="ops-card-name">{stat.name}</div>
        <div style="display:flex;align-items:center;gap:8px;white-space:nowrap;">
          <span class={`pill pill-${stat.pending > 0 ? "yellow" : "green"}`}>{stat.pending} pending</span>
          {stat.oldestPendingTs > 0
            ? <span style={`font-size:11px;color:${ageColor(stat.oldestPendingTs)};`}>&#9201; {shortAge(stat.oldestPendingTs)}</span>
            : <span style="font-size:11px;color:var(--text-dim);">clear</span>}
        </div>
      </div>

      {/* Headline numbers. An unscored window shows a plain sentence rather
          than zeros — "no audits yet" must not read as "0% fail". */}
      <div class="ops-card-stats">
        <span><strong>{audit?.count ?? 0}</strong> audits</span>
        <span class="ops-dot">·</span>
        {audit && scored > 0 ? (
          <>
            <span><strong style="color:var(--green);">{audit.passed}</strong> pass</span>
            <span class="ops-dot">/</span>
            <span><strong style="color:var(--red);">{audit.failed}</strong> fail</span>
            <span class="ops-dot">·</span>
            <span class={`pill pill-${(audit.failPct ?? 0) >= 30 ? "red" : (audit.failPct ?? 0) >= 10 ? "yellow" : "green"}`}>
              {audit.failPct}% fail
            </span>
            <span class="ops-dot">·</span>
            <span>
              avg{" "}
              {audit.avgScore != null
                ? <span class={`pill pill-${scorePillColor(audit.avgScore)}`}>{audit.avgScore}%</span>
                : <span style="color:var(--text-dim);">—</span>}
            </span>
          </>
        ) : (
          <span style="color:var(--text-dim);">no scored audits in this window</span>
        )}
      </div>

      <div class="ops-card-detail">
        <div class="ops-card-label">Weakest</div>
        <div>
          {audit?.worstMember
            ? (
              <>
                <span style="color:var(--text-bright);font-weight:600;">{audit.worstMember.name}</span>
                {" — "}
                <span class={`pill pill-${scorePillColor(audit.worstMember.avgScore)}`}>{audit.worstMember.avgScore}%</span>
                {/* Audit count is shown so a single bad call isn't mistaken
                    for a persistent problem. */}
                <span style="color:var(--text-dim);font-size:11px;">
                  {" "}({audit.worstMember.audits} {audit.worstMember.audits === 1 ? "audit" : "audits"})
                </span>
              </>
            )
            : <span style="color:var(--text-dim);">—</span>}
        </div>
      </div>

      <div class="ops-card-detail">
        <div class="ops-card-label">Top misses</div>
        <div style="flex:1;min-width:0;">
          {audit && audit.topMissed.length > 0
            ? audit.topMissed.map((m, i) => (
              <div key={m.header} class="ops-miss">
                <span class="mono" style="color:var(--text-dim);width:14px;flex-shrink:0;">{i + 1}.</span>
                <span class="ops-miss-text" title={m.header}>{m.header}</span>
                <span class="pill pill-red" style="flex-shrink:0;">{m.count}</span>
              </div>
            ))
            : <span style="color:var(--text-dim);">No failed questions in this window</span>}
        </div>
      </div>
    </a>
  );
}

function safeMs(v: string | null, dflt: number): number {
  if (v == null || v === "") return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Inline click handler for a queue window preset: set the hidden since/until
 *  (ms) + the calendar display, then refetch just the table. n=0 → all time.
 *  Mirrors the same helper on /manager — the queue fragment reads the same
 *  ids, so the markup has to agree. */
function queueWinHandler(n: number): string {
  const sExpr = n === 0 ? "0" : `u-${n}*86400000`;
  const sDisp = n === 0 ? "''" : "f(s)";
  return `(()=>{var u=Date.now(),s=${sExpr};` +
    `document.getElementById('q-since').value=s;document.getElementById('q-until').value=u;` +
    `var sd=document.getElementById('q-since-display'),ud=document.getElementById('q-until-display');` +
    `var p=function(x){return String(x).padStart(2,'0')},f=function(m){var d=new Date(m);return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+':'+p(d.getMinutes())};` +
    `if(sd)sd.value=${sDisp};if(ud)ud.value=f(u);` +
    `htmx.ajax('GET','/api/manager/queue',{source:'#queue-filters',target:'#manager-queue-table',swap:'innerHTML'});})()`;
}

/** Audit-history window preset. Same contract as /manager/audits: set the
 *  hidden ms inputs then refresh the table through the shared fragment. */
function auditWinHandler(days: number): string {
  const refresh = `htmx.ajax('GET','/api/manager/audit-history',{source:'#audit-history-filters',target:'#audit-history-table',swap:'innerHTML'})`;
  if (days === 0) {
    return `(()=>{document.getElementById('ah-since').value='0';document.getElementById('ah-until').value=Date.now();document.getElementById('ah-page').value='1';${refresh};})()`;
  }
  return `(()=>{var u=Date.now(),s=u-${days}*86400000;` +
    `document.getElementById('ah-since').value=s;document.getElementById('ah-until').value=u;` +
    `var p=function(x){return String(x).padStart(2,'0')},f=function(m){var d=new Date(m);return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+':'+p(d.getMinutes())};` +
    `document.getElementById('ah-since-display').value=f(s);document.getElementById('ah-until-display').value=f(u);` +
    `document.getElementById('ah-page').value='1';${refresh};})()`;
}

export default define.page(async function OperationsPortalPage(ctx) {
  const user = ctx.state.user!;
  const url = new URL(ctx.req.url);
  const asEmail = url.searchParams.get("as") ?? "";
  const asQs = asEmail ? `?as=${encodeURIComponent(asEmail)}` : "";
  const rawTab = url.searchParams.get("tab") ?? "";
  const tab: Tab = (TABS as readonly string[]).includes(rawTab) ? rawTab as Tab : "outstanding";
  const requestedDept = url.searchParams.get("dept") ?? "";

  // ── Audit-history query params (URL-only — no dependency on scope/queue) ──
  const ahSinceMs = safeMs(url.searchParams.get("since"), Date.now() - 7 * DAY_MS);
  const ahUntilMs = safeMs(url.searchParams.get("until"), Date.now());
  const ahOwner = url.searchParams.get("owner") ?? "";
  const ahShift = url.searchParams.get("shift") ?? "";
  const ahReviewed = url.searchParams.get("reviewed") ?? "";
  const ahSale = url.searchParams.get("sale") ?? "";
  const ahSort = url.searchParams.get("sort") ?? "";
  const ahScoreMin = url.searchParams.get("scoreMin") ?? "0";
  const ahScoreMax = url.searchParams.get("scoreMax") ?? "100";
  const ahPage = url.searchParams.get("page") ?? "1";

  const auditHistoryQs = (deptValue: string, overview: boolean): string => {
    const qsInit: Record<string, string> = {
      since: String(ahSinceMs), until: String(ahUntilMs), owner: ahOwner,
      department: deptValue, shift: ahShift, reviewed: ahReviewed, sale: ahSale,
      sort: ahSort, scoreMin: ahScoreMin, scoreMax: ahScoreMax, page: ahPage,
      // The overview only needs the backend's per-department aggregate, not a
      // page of rows — ask for the smallest page the API allows.
      limit: overview ? "10" : "50",
    };
    if (asEmail) qsInit.as = asEmail;
    return new URLSearchParams(qsInit).toString();
  };

  // Audit history is by far the slowest read on this page, and it used to run
  // AFTER scope+queue finished — so the two waits stacked and an ops manager's
  // login sat on a blank page for both.
  //
  // With no `dept` in the URL — the default landing case, i.e. exactly what
  // you hit right after logging in — every input to this query is already
  // known: `dept` can only resolve to "" (deptNames never contains an empty
  // string), so isOverview is true and the limit is 10. Nothing below can
  // change that, so start the fetch NOW and let it run alongside scope+queue.
  //
  // When a dept IS requested we can't presume: it's only valid once checked
  // against the manager's scope, and an unrecognised one falls back to the
  // overview with a different limit. That path stays sequential — it's a
  // sidebar click, not a login.
  const presumeOverview = requestedDept === "";
  const earlyAuditData = presumeOverview
    ? apiFetch<AuditHistoryData>(`/manager/api/audit-history?${auditHistoryQs("", true)}`, ctx.req)
      .catch((e) => {
        console.error("Operations audit-history load error:", e);
        return null;
      })
    : null;

  // Scope and queue in parallel — both soft-fail so one bad read degrades the
  // page instead of 500ing it.
  const [scope, allItems] = await Promise.all([
    apiFetch<ManagerScope>(`/manager/api/scope${asQs}`, ctx.req)
      .catch((e) => {
        console.error("Operations scope load error:", e);
        return { departments: [], shifts: [] } as ManagerScope;
      }),
    apiFetch<{ items: QueueItem[] }>(`/manager/api/queue${asQs}`, ctx.req)
      .then((r) => r.items ?? [])
      .catch((e) => {
        console.error("Operations queue load error:", e);
        return [] as QueueItem[];
      }),
  ]);

  // The rail lists every department the ops manager owns — including ones with
  // an empty queue, which is exactly the state you want to SEE. Departments
  // present in the queue but missing from the scope config are unioned in so a
  // half-configured scope still shows real work rather than hiding it.
  const deptNames = [...new Set([
    ...(scope.departments ?? []).filter(Boolean),
    ...allItems.map((i) => i.department ?? "").filter(Boolean),
  ])].sort((a, b) => a.localeCompare(b));

  // Ignore a dept that isn't theirs so the sidebar never paints a phantom
  // selection. (Backend scoping already makes it return nothing.)
  const dept = deptNames.includes(requestedDept) ? requestedDept : "";
  const isOverview = dept === "";
  const stats = deptStats(allItems, deptNames);
  const allPending = stats.reduce((n, s) => n + s.pending, 0);
  const allOldest = stats.reduce(
    (min, s) => (s.oldestPendingTs > 0 && (min === 0 || s.oldestPendingTs < min) ? s.oldestPendingTs : min),
    0,
  );
  const selected = dept ? stats.find((s) => s.name === dept) : undefined;
  const shownPending = selected ? selected.pending : allPending;
  const shownRemediated = selected ? selected.remediated : stats.reduce((n, s) => n + s.remediated, 0);
  const shownOldest = selected ? selected.oldestPendingTs : allOldest;

  const hrefFor = (name: string, t: Tab) => {
    const p = new URLSearchParams();
    if (name) p.set("dept", name);
    if (name && t !== "outstanding") p.set("tab", t);
    if (asEmail) p.set("as", asEmail);
    const qs = p.toString();
    return `/operations${qs ? `?${qs}` : ""}`;
  };
  const tabHref = (t: Tab) => hrefFor(dept, t);
  // Keep the open tab when switching departments — an ops manager comparing
  // audit history across teams shouldn't be thrown back to the queue each time.
  const deptHref = (name: string) => hrefFor(name, tab);

  // ── Sidebar department cards ─────────────────────────────────────────────
  const sidebarDepts: SbDept[] = [
    {
      name: "All Departments",
      href: deptHref(""),
      pending: allPending,
      oldestLabel: allOldest > 0 ? shortAge(allOldest) : null,
      oldestColor: allOldest > 0 ? ageColor(allOldest) : undefined,
      active: isOverview,
      isAll: true,
    },
    ...stats.map((s) => ({
      name: s.name,
      href: deptHref(s.name),
      pending: s.pending,
      oldestLabel: s.oldestPendingTs > 0 ? shortAge(s.oldestPendingTs) : null,
      oldestColor: s.oldestPendingTs > 0 ? ageColor(s.oldestPendingTs) : undefined,
      active: dept === s.name,
    })),
  ];

  // ── Queue-derived tabs (in-memory over the already-loaded list) ───────────
  const queueParams = { ...readQueueFilterParams(url.searchParams), dept };
  const inDept = (i: QueueItem) => !dept || (i.department ?? "") === dept;
  const pending = allItems.filter((i) => i.status !== "remediated");
  const facets = queueFacets(pending.filter(inDept));
  const queueRows = filterAndSortQueue(pending, queueParams);
  const completedRows = allItems
    .filter((i) => i.status === "remediated" && inDept(i))
    .sort((a, b) => (b.remediatedAt ?? 0) - (a.remediatedAt ?? 0));
  const qSinceDisplay = queueParams.since && queueParams.since > 0 ? toLocalInput(queueParams.since) : "";
  const qUntilDisplay = queueParams.until ? toLocalInput(queueParams.until) : "";

  // ── Audit-history read (overview roll-up, or the Audit History tab) ───────
  // Params + query-string builder are hoisted to the top of the handler so the
  // no-dept case can start this fetch before scope/queue resolve.
  let auditData: AuditHistoryData = {
    items: [], total: 0, pages: 1, page: 1, owners: [], shifts: [], departments: [],
  };
  const needsAudits = isOverview || tab === "audits";
  if (needsAudits) {
    // `earlyAuditData` is only non-null when no dept was requested, which
    // forces dept="" and isOverview=true — the exact query it was fired with.
    // Awaiting it here is a no-op wait: it has been in flight the whole time
    // scope+queue were loading.
    const result = earlyAuditData
      ? await earlyAuditData
      : await apiFetch<AuditHistoryData>(
        `/manager/api/audit-history?${auditHistoryQs(dept, isOverview)}`, ctx.req,
      ).catch((e) => {
        console.error("Operations audit-history load error:", e);
        return null;
      });
    if (result) auditData = result;
  }

  // Overview cards: live queue numbers (pending / oldest / remediated) joined
  // to the audit-side aggregates for the window. A department with no audits
  // in the window still gets a card — it just has nothing to report yet.
  const rollupByDept = new Map((auditData.deptRollup ?? []).map((r) => [r.department, r]));
  const overviewRows = stats.map((s) => ({ stat: s, audit: rollupByDept.get(s.name) ?? null }));

  const heading = dept || "All Departments";

  return (
    <Layout
      title="Operations Portal"
      section="operations"
      user={user}
      gameState={ctx.state.gameState}
      pathname={url.pathname}
      depts={deptNames.length > 0 ? sidebarDepts : undefined}
    >
      <style>{OPS_STYLES}</style>

      {deptNames.length === 0 ? (
        <>
          <div class="page-header">
            <h1>Operations Portal</h1>
            <p class="page-sub">No departments assigned yet</p>
          </div>
          <div class="card" style="padding:28px;text-align:center;">
            <div style="font-size:14px;color:var(--text-bright);margin-bottom:6px;">Nothing to oversee yet</div>
            <div style="font-size:12px;color:var(--text-muted);">
              An admin sets which departments you oversee in Admin &rarr; Users &rarr; your account &rarr; Scope.
            </div>
          </div>
        </>
      ) : (
        <>
          <div class="page-header" style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;">
            <div>
              <h1>{heading}</h1>
              <p class="page-sub">
                {isOverview
                  ? `${deptNames.length === 1 ? "1 department" : `${deptNames.length} departments`} under your oversight`
                  : "Remediation and audit history for this department"}
              </p>
            </div>
            <div style="font-size:12px;color:var(--text-muted);white-space:nowrap;padding-top:6px;">
              <strong style="color:var(--text-bright);">{shownPending}</strong> pending
              <span style="color:var(--text-dim);"> · </span>
              <strong style="color:var(--text-bright);">{shownRemediated}</strong> remediated
              {shownOldest > 0 && (
                <>
                  <span style="color:var(--text-dim);"> · oldest </span>
                  <strong style={`color:${ageColor(shownOldest)};`}>{shortAge(shownOldest)}</strong>
                </>
              )}
            </div>
          </div>

          {isOverview ? (
            /* ── All-departments roll-up: one card per department ───────── */
            <>
              <div style="font-size:11px;color:var(--text-dim);margin-bottom:12px;">
                Pending work is live; audits, scores and misses cover the last 7 days.
                An audit counts as passed only at 100%. Click a card to open that department.
              </div>
              <div class="ops-cards">
                {overviewRows.map(({ stat, audit }) => (
                  <OverviewCard
                    key={stat.name}
                    stat={stat}
                    audit={audit}
                    href={hrefFor(stat.name, "outstanding")}
                  />
                ))}
              </div>
            </>
          ) : (
            /* ── One department: three tabs ────────────────────────────── */
            <>
              <div style="display:flex;gap:4px;">
                <a href={tabHref("outstanding")} class={`ops-tab${tab === "outstanding" ? " is-active" : ""}`}>
                  Outstanding Remediation
                  {shownPending > 0 && <span class="pill pill-yellow" style="margin-left:6px;">{shownPending}</span>}
                </a>
                <a href={tabHref("completed")} class={`ops-tab${tab === "completed" ? " is-active" : ""}`}>Completed</a>
                <a href={tabHref("audits")} class={`ops-tab${tab === "audits" ? " is-active" : ""}`}>Audit History</a>
              </div>

              <div class="card" style="padding:14px 18px;border-radius:0 8px 8px 8px;">
                {tab === "outstanding" && (
                  <>
                    <form
                      id="queue-filters"
                      style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin-bottom:12px;"
                      hx-get="/api/manager/queue"
                      hx-target="#manager-queue-table"
                      hx-swap="innerHTML"
                      hx-trigger="change, keyup changed delay:350ms, submit"
                    >
                      <div class="form-group" style="margin-bottom:0;">
                        <label>Window</label>
                        <div style="display:flex;gap:4px;flex-wrap:wrap;">
                          {[7, 14, 30, 60, 90].map((n) => (
                            <button key={n} type="button" class="btn btn-ghost btn-sm" {...{ "hx-on:click": queueWinHandler(n) }}>{n}D</button>
                          ))}
                          <button type="button" class="btn btn-ghost btn-sm" {...{ "hx-on:click": queueWinHandler(0) }}>All</button>
                        </div>
                      </div>
                      <div class="form-group" style="margin-bottom:0;">
                        <label>Since</label>
                        <input type="datetime-local" id="q-since-display" value={qSinceDisplay} {...{ "hx-on:change": "document.getElementById('q-since').value=(this.value?new Date(this.value).getTime():0)" }} />
                        <input type="hidden" name="since" id="q-since" value={String(queueParams.since)} />
                      </div>
                      <div class="form-group" style="margin-bottom:0;">
                        <label>Until</label>
                        <input type="datetime-local" id="q-until-display" value={qUntilDisplay} {...{ "hx-on:change": "document.getElementById('q-until').value=(this.value?new Date(this.value).getTime():Date.now())" }} />
                        <input type="hidden" name="until" id="q-until" value={String(queueParams.until)} />
                      </div>
                      <div class="form-group" style="margin-bottom:0;">
                        <label>Team Member</label>
                        <input type="text" name="member" list="queue-members" value={queueParams.member} placeholder="Search name…" autocomplete="off" />
                        <datalist id="queue-members">{facets.members.map((m) => <option key={m} value={m} />)}</datalist>
                      </div>
                      <div class="form-group" style="margin-bottom:0;">
                        <label>Failed Question</label>
                        <select name="q">
                          <option value="">All questions</option>
                          {facets.questions.map((q) => <option key={q} value={q} selected={q === queueParams.q}>{q}</option>)}
                        </select>
                      </div>
                      <div class="form-group" style="margin-bottom:0;">
                        <label>Sale</label>
                        <div style="display:flex;gap:12px;align-items:center;height:34px;">
                          <label style="display:flex;gap:5px;align-items:center;font-size:12px;cursor:pointer;">
                            <input type="checkbox" name="wgs" value="1" checked={queueParams.wgs} /> WGS
                          </label>
                          <label style="display:flex;gap:5px;align-items:center;font-size:12px;cursor:pointer;">
                            <input type="checkbox" name="mcc" value="1" checked={queueParams.mcc} /> MCC
                          </label>
                        </div>
                      </div>
                      <div class="form-group" style="margin-bottom:0;">
                        <label>Sort</label>
                        <select name="sort">
                          <option value="recent" selected={queueParams.sort === "recent"}>Newest first</option>
                          <option value="oldest" selected={queueParams.sort === "oldest"}>Oldest first</option>
                          <option value="failpct" selected={queueParams.sort === "failpct"}>Highest % failed</option>
                        </select>
                      </div>
                      {/* The sidebar is the department control — carry the
                          selection through every HTMX filter refresh, and
                          through the replaceState below, so a filter change
                          can't silently widen the table to all departments. */}
                      <input type="hidden" name="dept" value={dept} />
                      <input type="hidden" name="tab" value="outstanding" />
                      {asEmail && <input type="hidden" name="as" value={asEmail} />}
                      <a href={tabHref("outstanding")} class="btn btn-ghost btn-sm">Clear</a>
                    </form>

                    <div
                      id="manager-queue-table"
                      {...{ "hx-on::after-swap": "history.replaceState(null,'','/operations?'+new URLSearchParams(new FormData(document.getElementById('queue-filters'))).toString())" }}
                    >
                      {renderQueueResults(queueRows)}
                    </div>
                  </>
                )}

                {tab === "completed" && (
                  <>
                    <div class="tbl-title" style="margin-bottom:4px;">Completed Remediations</div>
                    <div style="font-size:11px;color:var(--text-dim);margin-bottom:10px;">
                      Failures already addressed with the agent — who handled each one, and when. Newest first.
                    </div>
                    <div style="overflow-x:auto;">{renderQueueTable(completedRows, { completed: true })}</div>
                  </>
                )}

                {tab === "audits" && (
                  <>
                    <form
                      id="audit-history-filters"
                      style="display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap;margin-bottom:14px;"
                      hx-get="/api/manager/audit-history"
                      hx-target="#audit-history-table"
                      hx-swap="innerHTML"
                      hx-include="closest form"
                      {...{
                        "hx-on:change": "var b=document.getElementById('ah-update'); if(b){b.disabled=false; b.classList.add('is-dirty');}",
                        "hx-on:htmx:before-request": "var b=document.getElementById('ah-update'); if(b){b.classList.add('is-loading'); b.disabled=true;}",
                        "hx-on:htmx:after-request": "var b=document.getElementById('ah-update'); if(b){b.classList.remove('is-loading','is-dirty'); b.disabled=true;}",
                      }}
                    >
                      <div class="form-group" style="margin-bottom:0;">
                        <label>Since</label>
                        <input
                          type="datetime-local" name="since-display" id="ah-since-display"
                          value={toLocalInput(ahSinceMs)}
                          {...{ "hx-on:change": "(()=>{const t=new Date(this.value).getTime();document.getElementById('ah-since').value=Number.isFinite(t)?t:'0';})()" }}
                        />
                        <input type="hidden" name="since" id="ah-since" value={String(ahSinceMs)} />
                      </div>
                      <div class="form-group" style="margin-bottom:0;">
                        <label>Until</label>
                        <input
                          type="datetime-local" name="until-display" id="ah-until-display"
                          value={toLocalInput(ahUntilMs)}
                          {...{ "hx-on:change": "(()=>{const t=new Date(this.value).getTime();document.getElementById('ah-until').value=Number.isFinite(t)?t:String(Date.now());})()" }}
                        />
                        <input type="hidden" name="until" id="ah-until" value={String(ahUntilMs)} />
                      </div>
                      <div class="form-group" style="margin-bottom:0;">
                        <label>Quick</label>
                        <div style="display:flex;gap:4px;">
                          <button type="button" class="btn btn-ghost btn-sm" {...{ "hx-on:click": auditWinHandler(7) }}>7D</button>
                          <button type="button" class="btn btn-ghost btn-sm" {...{ "hx-on:click": auditWinHandler(30) }}>30D</button>
                          <button type="button" class="btn btn-ghost btn-sm" {...{ "hx-on:click": auditWinHandler(90) }}>90D</button>
                          <button type="button" class="btn btn-ghost btn-sm" {...{ "hx-on:click": auditWinHandler(0) }}>All</button>
                        </div>
                      </div>
                      <div class="form-group" style="margin-bottom:0;">
                        <label>Team Member</label>
                        {renderFilterSelect({ name: "owner", values: auditData.owners, selected: ahOwner })}
                      </div>
                      <div class="form-group" style="margin-bottom:0;">
                        <label>Shift</label>
                        {renderFilterSelect({ name: "shift", values: auditData.shifts, selected: ahShift })}
                      </div>
                      <div class="form-group" style="margin-bottom:0;">
                        <label>Reviewed</label>
                        <select name="reviewed">
                          <option value="" selected={ahReviewed === ""}>Any</option>
                          <option value="yes" selected={ahReviewed === "yes"}>Reviewed</option>
                          <option value="no" selected={ahReviewed === "no"}>Not reviewed</option>
                          <option value="auto" selected={ahReviewed === "auto"}>Auto-pass</option>
                          <option value="invalid_genie" selected={ahReviewed === "invalid_genie"}>Invalid Genie</option>
                        </select>
                      </div>
                      <div class="form-group" style="margin-bottom:0;">
                        <label>Sale</label>
                        <select name="sale">
                          <option value="" selected={ahSale === ""}>Any</option>
                          <option value="wgs" selected={ahSale === "wgs"}>WGS</option>
                          <option value="mcc" selected={ahSale === "mcc"}>MCC</option>
                          <option value="none" selected={ahSale === "none"}>Neither</option>
                        </select>
                      </div>
                      <div class="form-group" style="margin-bottom:0;">
                        <label>Sort</label>
                        <select name="sort">
                          <option value="" selected={ahSort === ""}>Most recent</option>
                          <option value="fails" selected={ahSort === "fails"}>Lowest score first</option>
                        </select>
                      </div>
                      <div class="form-group" style="margin-bottom:0;">
                        <label>Min Score %</label>
                        <input type="number" name="scoreMin" value={ahScoreMin} min="0" max="100" style="width:80px;" />
                      </div>
                      <div class="form-group" style="margin-bottom:0;">
                        <label>Max Score %</label>
                        <input type="number" name="scoreMax" value={ahScoreMax} min="0" max="100" style="width:80px;" />
                      </div>
                      {/* Department comes from the sidebar, not a dropdown —
                          the fragment forwards `department` to the backend. */}
                      <input type="hidden" name="department" value={dept} />
                      <input type="hidden" name="page" value={ahPage} id="ah-page" />
                      <input type="hidden" name="limit" value="50" />
                      {/* No Department select here — the sidebar is the switcher. */}
                      <input type="hidden" name="oob" value="owner,shift" />
                      {asEmail && <input type="hidden" name="as" value={asEmail} />}
                      <button type="submit" id="ah-update" class="btn btn-primary btn-sm ah-update" disabled>
                        <span class="ah-update-text">Update</span>
                        <span class="ah-update-spin qlab-spinner"></span>
                      </button>
                      <a href={tabHref("audits")} class="btn btn-ghost btn-sm">Clear</a>
                    </form>

                    <div id="audit-history-table">
                      {renderAuditHistoryTable(auditData, { since: ahSinceMs, until: ahUntilMs })}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* Remediate modal shell — plain HTML, NOT an island. The queue table's
          inline handler toggles `.open` and fills #rem-findingId, so the shell
          has to be in this page's initial SSR (frontend/CLAUDE.md Gotcha #1). */}
      <div id="remediate-modal" class="modal-overlay">
        <div class="modal" style="width:min(520px,92vw);">
          <div class="modal-title">Remediate Failure</div>
          <div class="modal-sub" style="margin-bottom:14px;">Record how this failure was addressed with the agent.</div>
          <form hx-post="/api/manager/remediate" hx-swap="none">
            <input type="hidden" id="rem-findingId" name="findingId" value="" />
            <input type="hidden" name="username" value={user.email} />
            {/* Come back to THIS department's queue after submitting, instead
                of the manager portal's org-wide default. */}
            <input type="hidden" name="returnTo" value={tabHref("outstanding")} />
            <div class="form-group">
              <label>Remediation notes</label>
              <textarea name="notes" rows={5} required placeholder="What was discussed / corrected with the agent…"></textarea>
            </div>
            <div class="modal-actions">
              <button
                type="button"
                class="btn btn-ghost"
                {...{ "hx-on:click": "this.closest('.modal-overlay').classList.remove('open')" }}
              >Cancel</button>
              <button type="submit" class="btn btn-primary">Submit</button>
            </div>
          </form>
        </div>
      </div>

      {/* Appeal detail — same plain modal shell as /manager/audits; the audit
          history fragment's APPEAL pill targets it by id. */}
      <div id="appeal-detail-modal" class="modal-overlay">
        <div class="modal" style="width:min(760px,92vw);max-height:88vh;overflow-y:auto;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <div class="modal-title">Appeal Result</div>
            <button
              class="btn btn-ghost btn-sm"
              {...{ "hx-on:click": "this.closest('.modal-overlay').classList.remove('open')" }}
            >&times;</button>
          </div>
          <div id="appeal-detail-content">
            <div class="placeholder-card">Loading…</div>
          </div>
        </div>
      </div>
    </Layout>
  );
});
