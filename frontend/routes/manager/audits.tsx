/** Manager audit history — historical audits scoped to the manager's team.
 *
 *  Filter row + stats + table + pagination. Filter changes refetch the table
 *  via HTMX (`hx-get="/api/manager/audit-history"`); the wrapper at
 *  `routes/api/manager/audit-history.tsx` returns the table fragment. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { GameStateRow } from "../../components/GameStateRow.tsx";
import { apiFetch } from "../../lib/api.ts";
import { renderAuditHistoryTable, type AuditHistoryData } from "../api/manager/audit-history.tsx";

interface MyStateResp {
  gameState?: { totalXp?: number; level?: number; dayStreak?: number } | null;
  earnedBadgeCount?: number;
}

function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Coerce a query-string ms timestamp into a finite number, falling back
 *  to `dflt` for null, empty, NaN, or non-numeric values. Without this,
 *  a bad `?since=` (typo, JS handler that wrote "NaN" into the hidden
 *  input, etc.) propagates into `new Date(NaN).toISOString()` which
 *  THROWS RangeError → 500 on the next page load. */
function safeMs(v: string | null, dflt: number): number {
  if (v == null || v === "") return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

/** Format a ms timestamp as a `YYYY-MM-DDTHH:MM` string in LOCAL time —
 *  what `<input type="datetime-local">` expects. The previous code used
 *  `new Date(ms).toISOString().slice(0,16)` which returns UTC and shifts
 *  the displayed time by the user's offset (~5h in EST). */
function toLocalInputValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default define.page(async function ManagerAuditsPage(ctx) {
  const user = ctx.state.user!;
  const url = new URL(ctx.req.url);
  // All query params get defensive parsing — a bad ?since= (NaN, "undefined",
  // empty string, etc.) would otherwise propagate into `new Date(NaN)` and
  // 500 the whole page. Clear is a plain `<a href="/manager/audits">` so
  // *normally* lands here with no params, but stray params from a browser
  // history nav, a malformed link, or a JS-set hidden-input race can all
  // produce non-numeric values.
  const sinceMs = safeMs(url.searchParams.get("since"), startOfTodayMs());
  const untilMs = safeMs(url.searchParams.get("until"), Date.now());
  const since = String(sinceMs);
  const until = String(untilMs);
  const owner = url.searchParams.get("owner") ?? "";
  const department = url.searchParams.get("department") ?? "";
  const shift = url.searchParams.get("shift") ?? "";
  const reviewed = url.searchParams.get("reviewed") ?? "";
  const scoreMin = url.searchParams.get("scoreMin") ?? "0";
  const scoreMax = url.searchParams.get("scoreMax") ?? "100";
  const page = url.searchParams.get("page") ?? "1";
  // Forward `?as=<email>` so the backend can scope to the impersonated
  // manager's department/shift instead of the admin's empty scope.
  // The middleware swap of ctx.state.user doesn't reach the backend — only
  // the session cookie does, so the backend can't tell impersonation is
  // happening unless we thread it explicitly via the query string.
  const asEmail = url.searchParams.get("as") ?? "";

  const qsInit: Record<string, string> = {
    since, until, owner, department, shift, reviewed, scoreMin, scoreMax, page, limit: "50",
  };
  if (asEmail) qsInit.as = asEmail;
  const qs = new URLSearchParams(qsInit);

  let data: AuditHistoryData;
  try {
    data = await apiFetch<AuditHistoryData>(`/manager/api/audit-history?${qs}`, ctx.req);
  } catch (e) {
    console.error("Manager audits load error:", e);
    data = { items: [], total: 0, pages: 1, page: 1, owners: [], shifts: [], departments: [] };
  }

  let myState: MyStateResp = {};
  try { myState = await apiFetch<MyStateResp>(`/gamification/api/my-state?email=${encodeURIComponent(user.email)}`, ctx.req); }
  catch (e) { console.error("My-state error:", e); }

  return (
    <Layout title="Audit History" section="manager" user={user} gameState={ctx.state.gameState} pathname={url.pathname}>
      <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;gap:16px;">
        <div>
          <h1>Audit History</h1>
          <p class="page-sub">Historical audits scoped to your team</p>
        </div>
        <a href="/manager" class="btn btn-ghost btn-sm">&larr; Manager</a>
      </div>

      <GameStateRow
        role="manager"
        totalXp={myState.gameState?.totalXp ?? 0}
        level={myState.gameState?.level ?? 0}
        dayStreak={myState.gameState?.dayStreak ?? 0}
        earnedBadgeCount={myState.earnedBadgeCount ?? 0}
        accent="#bc8cff"
      />


      {/* Filter form — every input refetches the table via HTMX. The form is
          the source of truth for params; `hx-include="closest form"` on each
          input makes sure ALL filter values get sent on every change.
          NOTE: every `hx-on:*` handler is written with JSX spread syntax
          ({...{"hx-on:click": ...}}) — Preact strips/garbles the double-dash
          `hx-on--click` alias when written as a normal JSX prop in this
          codebase (same workaround used on /admin/audits). Click handlers
          here also refresh via htmx.ajax() rather than htmx.trigger(form,
          'change') — the form's hx-trigger filters by `from:select` /
          `from:input`, so a change event dispatched on the form itself
          doesn't match and the request silently never fires. */}
      <form
        id="audit-history-filters"
        class="card"
        style="margin-bottom:16px;padding:14px 18px;display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap;"
        hx-get="/api/manager/audit-history"
        hx-target="#audit-history-table"
        hx-trigger="change delay:200ms"
        hx-swap="innerHTML"
        hx-include="closest form"
      >
        <div class="form-group" style="margin-bottom:0;">
          <label>Since</label>
          <input
            type="datetime-local" name="since-display" id="ah-since-display"
            value={toLocalInputValue(sinceMs)}
            {...{ "hx-on:change": `(()=>{const t=new Date(this.value).getTime();document.getElementById('ah-since').value=Number.isFinite(t)?t:'0';})()` }}
          />
          <input type="hidden" name="since" id="ah-since" value={since} />
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label>Until</label>
          <input
            type="datetime-local" name="until-display" id="ah-until-display"
            value={toLocalInputValue(untilMs)}
            {...{ "hx-on:change": `(()=>{const t=new Date(this.value).getTime();document.getElementById('ah-until').value=Number.isFinite(t)?t:String(Date.now());})()` }}
          />
          <input type="hidden" name="until" id="ah-until" value={until} />
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label>Quick</label>
          <div style="display:flex;gap:4px;">
            <button type="button" class="btn btn-ghost btn-sm" {...{ "hx-on:click": `(()=>{const d=new Date();d.setHours(0,0,0,0);document.getElementById('ah-since').value=d.getTime();document.getElementById('ah-until').value=Date.now();document.getElementById('ah-since-display').value=new Date(d).toISOString().slice(0,16);document.getElementById('ah-until-display').value=new Date().toISOString().slice(0,16);htmx.ajax('GET','/api/manager/audit-history',{source:'#audit-history-filters',target:'#audit-history-table',swap:'innerHTML'});})()` }}>Today</button>
            <button type="button" class="btn btn-ghost btn-sm" {...{ "hx-on:click": `(()=>{const u=Date.now();const s=u-7*86400000;document.getElementById('ah-since').value=s;document.getElementById('ah-until').value=u;document.getElementById('ah-since-display').value=new Date(s).toISOString().slice(0,16);document.getElementById('ah-until-display').value=new Date(u).toISOString().slice(0,16);htmx.ajax('GET','/api/manager/audit-history',{source:'#audit-history-filters',target:'#audit-history-table',swap:'innerHTML'});})()` }}>7D</button>
            <button type="button" class="btn btn-ghost btn-sm" {...{ "hx-on:click": `(()=>{const u=Date.now();const s=u-30*86400000;document.getElementById('ah-since').value=s;document.getElementById('ah-until').value=u;document.getElementById('ah-since-display').value=new Date(s).toISOString().slice(0,16);document.getElementById('ah-until-display').value=new Date(u).toISOString().slice(0,16);htmx.ajax('GET','/api/manager/audit-history',{source:'#audit-history-filters',target:'#audit-history-table',swap:'innerHTML'});})()` }}>30D</button>
            <button type="button" class="btn btn-ghost btn-sm" {...{ "hx-on:click": `(()=>{document.getElementById('ah-since').value='0';document.getElementById('ah-until').value=Date.now();htmx.ajax('GET','/api/manager/audit-history',{source:'#audit-history-filters',target:'#audit-history-table',swap:'innerHTML'});})()` }}>All</button>
          </div>
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label>Agent</label>
          <select name="owner">
            <option value="">All</option>
            {data.owners.map((o) => <option key={o} value={o} selected={o === owner}>{o}</option>)}
          </select>
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label>Department</label>
          <select name="department">
            <option value="">All</option>
            {data.departments.map((d) => <option key={d} value={d} selected={d === department}>{d}</option>)}
          </select>
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label>Shift</label>
          <select name="shift">
            <option value="">All</option>
            {data.shifts.map((s) => <option key={s} value={s} selected={s === shift}>{s}</option>)}
          </select>
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label>Reviewed</label>
          <select name="reviewed">
            <option value="" selected={reviewed === ""}>Any</option>
            <option value="yes" selected={reviewed === "yes"}>Reviewed</option>
            <option value="no" selected={reviewed === "no"}>Not reviewed</option>
            <option value="auto" selected={reviewed === "auto"}>Auto-pass</option>
            <option value="invalid_genie" selected={reviewed === "invalid_genie"}>Invalid Genie</option>
          </select>
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label>Min Score %</label>
          <input type="number" name="scoreMin" value={scoreMin} min="0" max="100" style="width:80px;" />
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label>Max Score %</label>
          <input type="number" name="scoreMax" value={scoreMax} min="0" max="100" style="width:80px;" />
        </div>
        <input type="hidden" name="page" value={page} id="ah-page" />
        <input type="hidden" name="limit" value="50" />
        {/* Propagate ?as=<email> through filter refreshes so backend
            scope lookup uses the impersonated manager's email, not the
            admin's. Without this hidden field, HTMX filter changes drop
            the impersonation context and scope reverts to admin's. */}
        {asEmail && <input type="hidden" name="as" value={asEmail} />}
        <a href="/manager/audits" class="btn btn-ghost btn-sm">Clear</a>
      </form>

      {/* Table region — initial server-rendered, swapped on filter change. */}
      <div id="audit-history-table">
        {renderAuditHistoryTable(data)}
      </div>
    </Layout>
  );
});
