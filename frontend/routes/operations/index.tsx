/** Operations Portal — the operations manager's home.
 *
 *  An operations manager sits over SEVERAL department managers. This page is
 *  the manager experience repeated per department: a rail of department cards
 *  on the left, and for whichever department is selected, that department's
 *  Remediation Queue and Audit History behind two tabs.
 *
 *  Everything is server-rendered; departments and tabs are plain links, so
 *  there is no island here (see frontend/CLAUDE.md — islands only when the UI
 *  physically can't work without client JS).
 *
 *  Data cost is deliberately flat: ONE queue read serves the rail counts, the
 *  per-department stat strip, and the queue table — the department rail is
 *  computed in memory from that single list, never a read per department (see
 *  the no-hydration-on-dashboard-paths lesson). The Audit History tab pays one
 *  additional read, and only when that tab is open.
 *
 *  Scope safety: `/manager/api/queue` and `/manager/api/audit-history` filter
 *  to the caller's own scope on the BACKEND before this page sees anything.
 *  The `dept` selection here only narrows further — it can never widen, so a
 *  hand-typed department outside the ops manager's scope returns nothing. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { apiFetch } from "../../lib/api.ts";
import {
  renderQueueResults, queueFacets, filterAndSortQueue, readQueueFilterParams,
  queueTimestamp, type QueueItem,
} from "../api/manager/queue.tsx";
import { renderAuditHistoryTable, type AuditHistoryData } from "../api/manager/audit-history.tsx";

interface ManagerScope {
  departments: string[];
  shifts: string[];
}

/** Per-department queue rollup for the left rail. */
export interface DeptStat {
  name: string;
  pending: number;
  remediated: number;
  /** Timestamp of the OLDEST pending item, or 0 when the department is clear. */
  oldestPendingTs: number;
}

const DAY_MS = 86_400_000;

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
function ageColor(ms: number): string {
  const days = (Date.now() - ms) / DAY_MS;
  if (days >= 14) return "var(--red)";
  if (days >= 7) return "var(--yellow)";
  return "var(--text-dim)";
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
  // fall back to alphabetical for a stable rail order across refreshes.
  return [...byName.values()].sort((a, b) => b.pending - a.pending || a.name.localeCompare(b.name));
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
  const tab = url.searchParams.get("tab") === "audits" ? "audits" : "queue";
  const requestedDept = url.searchParams.get("dept") ?? "";

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

  // Ignore a dept that isn't theirs so the rail never paints a phantom
  // selection. (Backend scoping already makes it return nothing.)
  const dept = deptNames.includes(requestedDept) ? requestedDept : "";
  const stats = deptStats(allItems, deptNames);
  const allPending = stats.reduce((n, s) => n + s.pending, 0);
  const allRemediated = stats.reduce((n, s) => n + s.remediated, 0);
  const allOldest = stats.reduce(
    (min, s) => (s.oldestPendingTs > 0 && (min === 0 || s.oldestPendingTs < min) ? s.oldestPendingTs : min),
    0,
  );
  const selected = dept ? stats.find((s) => s.name === dept) : undefined;
  const heading = dept || "All departments";
  const shownPending = selected ? selected.pending : allPending;
  const shownRemediated = selected ? selected.remediated : allRemediated;
  const shownOldest = selected ? selected.oldestPendingTs : allOldest;

  const tabHref = (t: string) => {
    const p = new URLSearchParams();
    if (dept) p.set("dept", dept);
    if (t !== "queue") p.set("tab", t);
    if (asEmail) p.set("as", asEmail);
    const qs = p.toString();
    return `/operations${qs ? `?${qs}` : ""}`;
  };
  const deptHref = (name: string) => {
    const p = new URLSearchParams();
    if (name) p.set("dept", name);
    if (tab !== "queue") p.set("tab", tab);
    if (asEmail) p.set("as", asEmail);
    const qs = p.toString();
    return `/operations${qs ? `?${qs}` : ""}`;
  };

  // ── Queue tab data (in-memory over the already-loaded list) ───────────────
  const queueParams = { ...readQueueFilterParams(url.searchParams), dept };
  const pending = allItems.filter((i) => i.status !== "remediated");
  const facets = queueFacets(dept ? pending.filter((i) => (i.department ?? "") === dept) : pending);
  const queueRows = filterAndSortQueue(pending, queueParams);
  const qSinceDisplay = queueParams.since && queueParams.since > 0 ? toLocalInput(queueParams.since) : "";
  const qUntilDisplay = queueParams.until ? toLocalInput(queueParams.until) : "";

  // ── Audit tab data (one extra read, only when the tab is open) ────────────
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

  let auditData: AuditHistoryData = {
    items: [], total: 0, pages: 1, page: 1, owners: [], shifts: [], departments: [],
  };
  if (tab === "audits") {
    const qsInit: Record<string, string> = {
      since: String(ahSinceMs), until: String(ahUntilMs), owner: ahOwner,
      department: dept, shift: ahShift, reviewed: ahReviewed, sale: ahSale,
      sort: ahSort, scoreMin: ahScoreMin, scoreMax: ahScoreMax, page: ahPage, limit: "50",
    };
    if (asEmail) qsInit.as = asEmail;
    try {
      auditData = await apiFetch<AuditHistoryData>(
        `/manager/api/audit-history?${new URLSearchParams(qsInit)}`, ctx.req,
      );
    } catch (e) {
      console.error("Operations audit-history load error:", e);
    }
  }

  return (
    <Layout title="Operations Portal" section="operations" user={user} gameState={ctx.state.gameState} pathname={url.pathname}>
      <style>{`
        .ops-dept{ display:block; text-decoration:none; color:inherit; padding:10px 12px;
          border:1px solid var(--border); border-left:3px solid transparent; border-radius:8px;
          margin-bottom:6px; background:var(--bg-card); transition:border-color .12s, background .12s; }
        .ops-dept:hover{ border-color:var(--accent); background:var(--accent-bg); }
        .ops-dept.is-active{ border-left-color:var(--accent); background:var(--accent-bg); }
        .ops-dept-name{ font-size:13px; font-weight:600; color:var(--text-bright);
          overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .ops-dept-meta{ display:flex; align-items:center; justify-content:space-between;
          gap:8px; margin-top:5px; font-size:11px; }
        .ops-tab{ display:inline-block; padding:8px 16px; text-decoration:none; font-size:13px;
          font-weight:600; color:var(--text-muted); border:1px solid var(--border);
          border-bottom:none; border-radius:8px 8px 0 0; background:var(--bg-card); }
        .ops-tab.is-active{ color:var(--text-bright); border-color:var(--accent); background:var(--accent-bg); }
        .ah-update .ah-update-spin{ display:none; }
        .ah-update.is-loading .ah-update-text{ display:none; }
        .ah-update.is-loading .ah-update-spin{ display:inline-block; }
        .ah-update:disabled{ opacity:0.4; cursor:default; box-shadow:none; }
        .ah-update.is-dirty{ opacity:1; box-shadow:0 0 0 2px rgba(129,140,248,0.55); }
      `}</style>

      <div class="page-header">
        <h1>Operations Portal</h1>
        <p class="page-sub">
          {deptNames.length === 1 ? "1 department" : `${deptNames.length} departments`} under your oversight
        </p>
      </div>

      {deptNames.length === 0 ? (
        <div class="card" style="padding:28px;text-align:center;">
          <div style="font-size:14px;color:var(--text-bright);margin-bottom:6px;">No departments assigned yet</div>
          <div style="font-size:12px;color:var(--text-muted);">
            An admin sets which departments you oversee in Admin → Users → your account → Scope.
          </div>
        </div>
      ) : (
        <div style="display:flex;gap:18px;align-items:flex-start;">
          {/* ── Department rail ─────────────────────────────────────────── */}
          <aside style="width:250px;flex:0 0 250px;">
            <div style="font-size:11px;font-weight:700;letter-spacing:.06em;color:var(--text-dim);margin-bottom:8px;">
              DEPARTMENTS
            </div>

            <a href={deptHref("")} class={`ops-dept${dept === "" ? " is-active" : ""}`}>
              <div class="ops-dept-name">All departments</div>
              <div class="ops-dept-meta">
                <span class={`pill pill-${allPending > 0 ? "yellow" : "green"}`}>{allPending} pending</span>
                {allOldest > 0
                  ? (
                    <span style={`color:${ageColor(allOldest)};white-space:nowrap;`}>
                      &#9201; {shortAge(allOldest)} old
                    </span>
                  )
                  : <span style="color:var(--text-dim);">clear</span>}
              </div>
            </a>

            <div style="height:8px;"></div>

            {stats.map((s) => (
              <a key={s.name} href={deptHref(s.name)} class={`ops-dept${dept === s.name ? " is-active" : ""}`}>
                <div class="ops-dept-name" title={s.name}>{s.name}</div>
                <div class="ops-dept-meta">
                  <span class={`pill pill-${s.pending > 0 ? "yellow" : "green"}`}>{s.pending} pending</span>
                  {s.oldestPendingTs > 0
                    ? (
                      <span style={`color:${ageColor(s.oldestPendingTs)};white-space:nowrap;`}>
                        &#9201; {shortAge(s.oldestPendingTs)} old
                      </span>
                    )
                    : <span style="color:var(--text-dim);">clear</span>}
                </div>
              </a>
            ))}
          </aside>

          {/* ── Selected department ─────────────────────────────────────── */}
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-bottom:12px;">
              <h2 style="margin:0;font-size:19px;color:var(--text-bright);">{heading}</h2>
              <div style="font-size:12px;color:var(--text-muted);white-space:nowrap;">
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

            <div style="display:flex;gap:4px;">
              <a href={tabHref("queue")} class={`ops-tab${tab === "queue" ? " is-active" : ""}`}>
                Remediation Queue {shownPending > 0 && <span class="pill pill-yellow" style="margin-left:6px;">{shownPending}</span>}
              </a>
              <a href={tabHref("audits")} class={`ops-tab${tab === "audits" ? " is-active" : ""}`}>Audit History</a>
            </div>

            <div class="card" style="padding:14px 18px;border-radius:0 8px 8px 8px;">
              {tab === "queue" ? (
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
                    {/* The rail is the department control — carry the selection
                        through every HTMX filter refresh, and through the
                        replaceState below, so a filter change can't silently
                        widen the table back to all departments. */}
                    <input type="hidden" name="dept" value={dept} />
                    <input type="hidden" name="tab" value="queue" />
                    {asEmail && <input type="hidden" name="as" value={asEmail} />}
                    <a href={deptHref(dept)} class="btn btn-ghost btn-sm">Clear</a>
                  </form>

                  <div
                    id="manager-queue-table"
                    {...{ "hx-on::after-swap": "history.replaceState(null,'','/operations?'+new URLSearchParams(new FormData(document.getElementById('queue-filters'))).toString())" }}
                  >
                    {renderQueueResults(queueRows)}
                  </div>
                </>
              ) : (
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
                      <select name="owner">
                        <option value="">All</option>
                        {auditData.owners.map((o) => <option key={o} value={o} selected={o === ahOwner}>{o}</option>)}
                      </select>
                    </div>
                    <div class="form-group" style="margin-bottom:0;">
                      <label>Shift</label>
                      <select name="shift">
                        <option value="">All</option>
                        {auditData.shifts.map((s) => <option key={s} value={s} selected={s === ahShift}>{s}</option>)}
                      </select>
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
                    {/* Department comes from the rail, not a dropdown — the
                        fragment forwards `department` straight to the backend. */}
                    <input type="hidden" name="department" value={dept} />
                    <input type="hidden" name="page" value={ahPage} id="ah-page" />
                    <input type="hidden" name="limit" value="50" />
                    {asEmail && <input type="hidden" name="as" value={asEmail} />}
                    <button type="submit" id="ah-update" class="btn btn-primary btn-sm ah-update" disabled>
                      <span class="ah-update-text">Update</span>
                      <span class="ah-update-spin qlab-spinner"></span>
                    </button>
                    <a href={tabHref("audits")} class="btn btn-ghost btn-sm">Clear</a>
                  </form>

                  <div id="audit-history-table">
                    {renderAuditHistoryTable(auditData)}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
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
            <input type="hidden" name="returnTo" value={deptHref(dept)} />
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
    </Layout>
  );
});
