/** Manager audit history — historical audits scoped to the manager's team.
 *
 *  Filter row + stats + table + pagination. Filter changes refetch the table
 *  via HTMX (`hx-get="/api/manager/audit-history"`); the wrapper at
 *  `routes/api/manager/audit-history.tsx` returns the table fragment. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { apiFetch } from "../../lib/api.ts";
import { renderAuditHistoryTable, type AuditHistoryData } from "../api/manager/audit-history.tsx";

function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export default define.page(async function ManagerAuditsPage(ctx) {
  const user = ctx.state.user!;
  const url = new URL(ctx.req.url);
  const since = url.searchParams.get("since") ?? String(startOfTodayMs());
  const until = url.searchParams.get("until") ?? String(Date.now());
  const owner = url.searchParams.get("owner") ?? "";
  const department = url.searchParams.get("department") ?? "";
  const shift = url.searchParams.get("shift") ?? "";
  const reviewed = url.searchParams.get("reviewed") ?? "";
  const scoreMin = url.searchParams.get("scoreMin") ?? "0";
  const scoreMax = url.searchParams.get("scoreMax") ?? "100";
  const page = url.searchParams.get("page") ?? "1";

  const qs = new URLSearchParams({
    since, until, owner, department, shift, reviewed, scoreMin, scoreMax, page, limit: "50",
  });

  let data: AuditHistoryData;
  try {
    data = await apiFetch<AuditHistoryData>(`/manager/api/audit-history?${qs}`, ctx.req);
  } catch (e) {
    console.error("Manager audits load error:", e);
    data = { items: [], total: 0, pages: 1, page: 1, owners: [], shifts: [], departments: [] };
  }

  return (
    <Layout title="Audit History" section="manager" user={user} pathname={url.pathname}>
      <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;gap:16px;">
        <div>
          <h1>Audit History</h1>
          <p class="page-sub">Historical audits scoped to your team</p>
        </div>
        <a href="/manager" class="btn btn-ghost btn-sm">&larr; Manager</a>
      </div>

      {/* Filter form — every input refetches the table via HTMX. The form is
          the source of truth for params; `hx-include="closest form"` on each
          input makes sure ALL filter values get sent on every change. */}
      <form
        id="audit-history-filters"
        class="card"
        style="margin-bottom:16px;padding:14px 18px;display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap;"
        hx-get="/api/manager/audit-history"
        hx-target="#audit-history-table"
        hx-trigger="change from:select, change delay:300ms from:input"
        hx-swap="innerHTML"
        hx-include="closest form"
      >
        <div class="form-group" style="margin-bottom:0;">
          <label>Since</label>
          <input type="datetime-local" name="since-display" id="ah-since-display"
            value={new Date(Number(since)).toISOString().slice(0, 16)}
            hx-on--change={`document.getElementById('ah-since').value = new Date(this.value).getTime();`} />
          <input type="hidden" name="since" id="ah-since" value={since} />
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label>Until</label>
          <input type="datetime-local" name="until-display" id="ah-until-display"
            value={new Date(Number(until)).toISOString().slice(0, 16)}
            hx-on--change={`document.getElementById('ah-until').value = new Date(this.value).getTime();`} />
          <input type="hidden" name="until" id="ah-until" value={until} />
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label>Quick</label>
          <div style="display:flex;gap:4px;">
            <button type="button" class="btn btn-ghost btn-sm" hx-on--click={`(()=>{const d=new Date();d.setHours(0,0,0,0);document.getElementById('ah-since').value=d.getTime();document.getElementById('ah-until').value=Date.now();document.getElementById('ah-since-display').value=new Date(d).toISOString().slice(0,16);document.getElementById('ah-until-display').value=new Date().toISOString().slice(0,16);htmx.trigger('#audit-history-filters','change');})()`}>Today</button>
            <button type="button" class="btn btn-ghost btn-sm" hx-on--click={`(()=>{const u=Date.now();const s=u-7*86400000;document.getElementById('ah-since').value=s;document.getElementById('ah-until').value=u;document.getElementById('ah-since-display').value=new Date(s).toISOString().slice(0,16);document.getElementById('ah-until-display').value=new Date(u).toISOString().slice(0,16);htmx.trigger('#audit-history-filters','change');})()`}>7D</button>
            <button type="button" class="btn btn-ghost btn-sm" hx-on--click={`(()=>{const u=Date.now();const s=u-30*86400000;document.getElementById('ah-since').value=s;document.getElementById('ah-until').value=u;document.getElementById('ah-since-display').value=new Date(s).toISOString().slice(0,16);document.getElementById('ah-until-display').value=new Date(u).toISOString().slice(0,16);htmx.trigger('#audit-history-filters','change');})()`}>30D</button>
            <button type="button" class="btn btn-ghost btn-sm" hx-on--click={`(()=>{document.getElementById('ah-since').value='0';document.getElementById('ah-until').value=Date.now();htmx.trigger('#audit-history-filters','change');})()`}>All</button>
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
        <a href="/manager/audits" class="btn btn-ghost btn-sm">Clear</a>
      </form>

      {/* Table region — initial server-rendered, swapped on filter change. */}
      <div id="audit-history-table">
        {renderAuditHistoryTable(data)}
      </div>
    </Layout>
  );
});
