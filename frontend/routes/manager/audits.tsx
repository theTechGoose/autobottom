/** Manager audit history — historical audits scoped to the manager's team.
 *
 *  Filter row + stats + table + pagination. Filter changes refetch the table
 *  via HTMX (`hx-get="/api/manager/audit-history"`); the wrapper at
 *  `routes/api/manager/audit-history.tsx` returns the table fragment. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { GameStateRow } from "../../components/GameStateRow.tsx";
import { apiFetch } from "../../lib/api.ts";
import { renderAuditHistoryTable, renderFilterSelect, type AuditHistoryData } from "../api/manager/audit-history.tsx";
import DateRangePicker from "../../islands/DateRangePicker.tsx";

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

export default define.page(async function ManagerAuditsPage(ctx) {
  const user = ctx.state.user!;
  // Gamification (XP / streak / badges) is only for the gamified roles
  // (reviewers, judges, team members). Managers, super-managers, and admins
  // viewing this page don't earn XP — hide the box (and skip its fetch).
  const showGameStats = user.role === "reviewer" || user.role === "judge" || user.role === "user";
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
  const sale = url.searchParams.get("sale") ?? "";
  const sort = url.searchParams.get("sort") ?? "";
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
    since, until, owner, department, shift, reviewed, sale, sort, scoreMin, scoreMax, page, limit: "50",
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
  if (showGameStats) {
    try { myState = await apiFetch<MyStateResp>(`/gamification/api/my-state?email=${encodeURIComponent(user.email)}`, ctx.req); }
    catch (e) { console.error("My-state error:", e); }
  }

  return (
    <Layout title="Audit History" section="manager" user={user} gameState={ctx.state.gameState} pathname={url.pathname}>
      <style>{`
        .ah-update .ah-update-spin{ display:none; }
        .ah-update.is-loading .ah-update-text{ display:none; }
        .ah-update.is-loading .ah-update-spin{ display:inline-block; }
        .ah-update:disabled{ opacity:0.4; cursor:default; box-shadow:none; }
        .ah-update.is-dirty{ opacity:1; box-shadow:0 0 0 2px rgba(88,166,255,0.55); }
        .ah-loading{ display:none; }
        .ah-loading.htmx-request{ display:flex; gap:10px; align-items:center; justify-content:center; position:absolute; inset:0; z-index:5; background:rgba(13,17,23,0.55); border-radius:8px; }
        .ah-loading-spinner{ width:20px; height:20px; border-width:3px; }
        .ah-loading-text{ color:var(--text-bright); font-size:13px; font-weight:600; }

        /* Window control (DateRangePicker island). */
        .drp{ position:relative; display:flex; flex-direction:column; gap:6px; }
        .drp-presets{ display:flex; gap:4px; flex-wrap:wrap; }
        .drp-preset-on{ background:var(--accent); color:#0b0f15; font-weight:700; border-color:var(--accent); }
        .drp-trigger{
          display:flex; align-items:center; gap:8px; min-width:260px;
          background:var(--bg); border:1px solid var(--border); border-radius:8px;
          color:var(--text-bright); font-size:13px; padding:8px 12px; cursor:pointer;
          font-variant-numeric:tabular-nums;
        }
        .drp-trigger:hover{ border-color:var(--border-hover); }
        .drp-pop{
          position:absolute; top:100%; left:0; margin-top:6px; z-index:200;
          background:var(--bg-surface); border:1px solid var(--border-hover); border-radius:12px;
          padding:14px 16px; box-shadow:0 16px 40px rgba(0,0,0,0.7);
        }
        .drp-head{ display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:10px; }
        .drp-hint{ font-size:11px; color:var(--text-muted); }
        .drp-nav{ display:flex; gap:4px; }
        .drp-months{ display:flex; gap:24px; }
        .drp-month-title{ font-size:12px; font-weight:700; color:var(--text-bright); text-align:center; margin-bottom:8px; }
        .drp-grid{ display:grid; grid-template-columns:repeat(7, 32px); gap:2px; }
        .drp-dow{ font-size:10px; color:var(--text-dim); text-align:center; padding-bottom:4px; }
        .drp-day{
          height:30px; border:0; border-radius:6px; background:transparent;
          color:var(--text); font-size:12px; cursor:pointer; font-variant-numeric:tabular-nums;
        }
        .drp-day:hover{ background:var(--border-hover); color:var(--text-bright); }
        .drp-day.in-range{ background:var(--accent-bg); color:var(--text-bright); }
        .drp-day.edge{ background:var(--accent); color:#0b0f15; font-weight:700; }
        .drp-day.today{ box-shadow:inset 0 0 0 1px var(--border-hover); }
      `}</style>
      <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;gap:16px;">
        <div>
          <h1>Audit History</h1>
          <p class="page-sub">Historical audits scoped to your team</p>
        </div>
        {/* Super-manager has no queue page to go back to — hide the link. */}
        {user.role !== "super-manager" && (
          <a href={asEmail ? `/manager?as=${encodeURIComponent(asEmail)}` : "/manager"} class="btn btn-ghost btn-sm">&larr; Manager</a>
        )}
      </div>

      {showGameStats && (
        <GameStateRow
          role="manager"
          totalXp={myState.gameState?.totalXp ?? 0}
          level={myState.gameState?.level ?? 0}
          dayStreak={myState.gameState?.dayStreak ?? 0}
          earnedBadgeCount={myState.earnedBadgeCount ?? 0}
          accent="#bc8cff"
        />
      )}


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
        hx-swap="innerHTML"
        hx-include="closest form"
        hx-indicator="#ah-loading"
        {...{
          // Changing any filter no longer auto-loads — it lights up the Update
          // button so the refresh is an explicit, visible action.
          "hx-on:change": "var b=document.getElementById('ah-update'); if(b){b.disabled=false; b.classList.add('is-dirty');}",
          // While the request is in flight, the button shows a spinner (the
          // table also gets the #ah-loading overlay via hx-indicator).
          "hx-on:htmx:before-request": "var b=document.getElementById('ah-update'); if(b){b.classList.add('is-loading'); b.disabled=true;}",
          // Done — clear the spinner + the dirty highlight, lock the button
          // again until the next change.
          "hx-on:htmx:after-request": "var b=document.getElementById('ah-update'); if(b){b.classList.remove('is-loading','is-dirty'); b.disabled=true;}",
        }}
      >
        {/* Window control — one calendar for both ends of the range, plus the
            preset row. Writes epoch-ms into the hidden inputs below, which are
            what actually get submitted. */}
        <div class="form-group" style="margin-bottom:0;">
          <label>Window</label>
          <DateRangePicker since={sinceMs} until={untilMs} />
        </div>
        <input type="hidden" name="since" id="ah-since" value={since} />
        <input type="hidden" name="until" id="ah-until" value={until} />
        <div class="form-group" style="margin-bottom:0;">
          <label>Team Member</label>
          {renderFilterSelect({ name: "owner", values: data.owners, selected: owner })}
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label>Department</label>
          {renderFilterSelect({ name: "department", values: data.departments, selected: department })}
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label>Shift</label>
          {renderFilterSelect({ name: "shift", values: data.shifts, selected: shift })}
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
          <label>Sale</label>
          <select name="sale">
            <option value="" selected={sale === ""}>Any</option>
            <option value="wgs" selected={sale === "wgs"}>WGS</option>
            <option value="mcc" selected={sale === "mcc"}>MCC</option>
            <option value="none" selected={sale === "none"}>Neither</option>
          </select>
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label>Sort</label>
          <select name="sort">
            <option value="" selected={sort === ""}>Most recent</option>
            <option value="fails" selected={sort === "fails"}>Lowest score first</option>
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
        {/* Which filter dropdowns the fragment should refresh out-of-band. */}
        <input type="hidden" name="oob" value="owner,department,shift" />
        {/* Propagate ?as=<email> through filter refreshes so backend
            scope lookup uses the impersonated manager's email, not the
            admin's. Without this hidden field, HTMX filter changes drop
            the impersonation context and scope reverts to admin's. */}
        {asEmail && <input type="hidden" name="as" value={asEmail} />}
        {/* Update lights up (enabled + glow) on any filter change, then spins
            until the new report loads. type=submit fires the form's hx-get. */}
        <button type="submit" id="ah-update" class="btn btn-primary btn-sm ah-update" disabled>
          <span class="ah-update-text">Update</span>
          <span class="ah-update-spin qlab-spinner"></span>
        </button>
        <a href={asEmail ? `/manager/audits?as=${encodeURIComponent(asEmail)}` : "/manager/audits"} class="btn btn-ghost btn-sm">Clear</a>
      </form>

      {/* Table region — initial server-rendered, swapped on filter change.
          Wrapped relative so the #ah-loading overlay can cover it; the overlay
          shows whenever an HTMX refresh is in flight (hx-indicator target). */}
      <div style="position:relative;">
        <div id="ah-loading" class="ah-loading" aria-hidden="true">
          <span class="qlab-spinner ah-loading-spinner"></span>
          <span class="ah-loading-text">Loading…</span>
        </div>
        <div id="audit-history-table">
          {renderAuditHistoryTable(data, { since: sinceMs, until: untilMs })}
        </div>
      </div>
    </Layout>
  );
});
