/** Admin audit history — full-parity port of prod's /admin/audits page.
 *
 *  Filter form drives the table fragment via HTMX; backend re-renders stats,
 *  table, pagination, and cross-filtered dropdowns on every change. URL
 *  params (`?hours=24&type=package&reviewed=no&owner=...`) seed the initial
 *  filters so dashboard drill-down links work. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import {
  fetchAndRenderFragment,
  renderAuditHistoryDropdowns,
  type AdminAuditData,
  type AdminAuditFilters,
} from "../api/admin/audit-history.tsx";
import { renderToString } from "preact-render-to-string";

function defaultSince(hours: number): string {
  return String(Date.now() - hours * 3_600_000);
}

/** Map URL params → backend filter set. Supports both prod-style drill-down
 *  params (`hours`, `type`, `reviewed`, `owner`) and explicit since/until. */
function buildInitialFilters(url: URL): AdminAuditFilters {
  const hoursParam = parseInt(url.searchParams.get("hours") || "", 10);
  const hours = hoursParam > 0 ? hoursParam : 24;
  const since = url.searchParams.get("since") ?? defaultSince(hours);
  const until = url.searchParams.get("until") ?? String(Date.now());
  return {
    since,
    until,
    type: url.searchParams.get("type") ?? "",
    owner: url.searchParams.get("owner") ?? "",
    department: url.searchParams.get("department") ?? "",
    shift: url.searchParams.get("shift") ?? "",
    reviewed: url.searchParams.get("reviewed") ?? "",
    auditor: url.searchParams.get("auditor") ?? "",
    scoreMin: url.searchParams.get("scoreMin") ?? "0",
    scoreMax: url.searchParams.get("scoreMax") ?? "100",
    page: url.searchParams.get("page") ?? "1",
    limit: "50",
  };
}

function windowLabel(f: AdminAuditFilters): string {
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

const WINDOWS: Array<{ h: number; label: string }> = [
  { h: 1, label: "1h" }, { h: 4, label: "4h" }, { h: 12, label: "12h" },
  { h: 24, label: "24h" }, { h: 72, label: "3d" }, { h: 168, label: "7d" },
];

/** JS snippet for window-button click — sets hidden since/until and fires
 *  the `ah-refresh` custom event the form listens for. (Form's `change from:`
 *  triggers don't fire on programmatic `htmx.trigger(..., 'change')`.) */
function windowBtnJs(hours: number): string {
  return `(()=>{const u=Date.now();const s=u-${hours}*3600000;document.getElementById('ah-since').value=s;document.getElementById('ah-until').value=u;document.querySelectorAll('.window-btn').forEach(b=>b.classList.toggle('active',+b.getAttribute('data-hours')===${hours}));htmx.trigger('#audit-history-filters','ah-refresh');})()`;
}

/** JS for custom-date Go button. */
const goBtnJs =
  `(()=>{const s=document.getElementById('f-date-start').value;const e=document.getElementById('f-date-end').value;if(!s||!e){alert('Select both start and end dates');return;}if(s>e){alert('Start date must be before end date');return;}document.getElementById('ah-since').value=new Date(s+'T00:00:00').getTime();document.getElementById('ah-until').value=new Date(e+'T23:59:59').getTime();document.querySelectorAll('.window-btn').forEach(b=>b.classList.remove('active'));htmx.trigger('#audit-history-filters','ah-refresh');})()`;

/** JS for Reset button — clears all filters back to defaults and 24h. */
const resetJs =
  `(()=>{const u=Date.now();const s=u-24*3600000;document.getElementById('ah-since').value=s;document.getElementById('ah-until').value=u;document.getElementById('f-type').value='';document.getElementById('f-owner').value='';document.getElementById('f-dept').value='';document.getElementById('f-shift').value='';document.getElementById('f-reviewed').value='';document.getElementById('f-auditor').value='';document.getElementById('f-score-min').value=0;document.getElementById('f-score-max').value=100;document.getElementById('f-date-start').value='';document.getElementById('f-date-end').value='';document.getElementById('ah-page').value='1';document.querySelectorAll('.window-btn').forEach(b=>b.classList.toggle('active',+b.getAttribute('data-hours')===24));htmx.trigger('#audit-history-filters','ah-refresh');})()`;

/** JS for CSV button — gathers form values + format=csv into a download URL. */
const csvBtnJs =
  `(()=>{const f=document.getElementById('audit-history-filters');const fd=new FormData(f);const p=new URLSearchParams();for(const[k,v]of fd.entries()){if(typeof v==='string'&&v!=='')p.set(k,v);}p.set('format','csv');const a=document.createElement('a');a.href='/api/admin/audits-csv?'+p.toString();a.download='audit-history.csv';document.body.appendChild(a);a.click();a.remove();})()`;

export default define.page(async function AdminAuditsPage(ctx) {
  const user = ctx.state.user!;
  const url = new URL(ctx.req.url);
  const filters = buildInitialFilters(url);
  const activeHours = Math.round((parseInt(filters.until, 10) - parseInt(filters.since, 10)) / 3_600_000);

  let data: AdminAuditData;
  let mainHtml: string;
  try {
    const result = await fetchAndRenderFragment(filters, ctx.req, { includeOob: false });
    data = result.data;
    mainHtml = result.html;
  } catch (e) {
    console.error("[ADMIN/AUDITS] initial load failed:", e);
    data = { items: [], total: 0, pages: 1, page: 1, owners: [], departments: [], shifts: [], reviewers: [] };
    mainHtml = renderToString(<div class="empty-row" style="padding:40px;color:var(--red);">Failed to load: {(e as Error).message}</div>);
  }
  const dd = renderAuditHistoryDropdowns(data, filters);

  return (
    <Layout title="Audit History" section="admin" user={user} pathname={url.pathname} hideSidebar>
      <style>{`
        /* Make native date pickers visible against dark background. */
        #audit-history-filters input[type="date"] { color-scheme: dark; }
        #audit-history-filters input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(1) brightness(1.3); cursor: pointer; }
        /* Window-button active state. */
        #audit-history-filters .window-btn.active { background: rgba(88,166,255,0.15); border-color: rgba(88,166,255,0.5); color: var(--blue); }
      `}</style>
      <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;gap:16px;">
        <div>
          <h1>
            Audit History <span id="ah-window" style="font-weight:400;color:var(--text-muted);font-size:14px;">({windowLabel(filters)})</span>
          </h1>
          <p class="page-sub"><span id="ah-count">{data.total} audits in window</span></p>
        </div>
        <a href="/admin/dashboard" class="btn btn-ghost btn-sm">&larr; Dashboard</a>
      </div>

      {/* Form's hx-trigger listens for the custom `ah-refresh` event so
          window/Go/Reset buttons can programmatically kick off a refetch.
          Native `change` from selects and number inputs still fires on its own. */}
      <form
        id="audit-history-filters"
        class="card"
        style="margin-bottom:16px;padding:14px 18px;display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;"
        hx-get="/api/admin/audit-history"
        hx-target="#audit-history-table"
        hx-trigger="change from:select, change delay:300ms from:input[type=number], ah-refresh"
        hx-swap="innerHTML"
        hx-include="closest form"
      >
        <div class="form-group" style="margin-bottom:0;">
          <label>Date Range</label>
          <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;">
            {WINDOWS.map((w) => (
              <button
                key={w.h}
                type="button"
                class={`btn btn-ghost btn-sm window-btn ${activeHours === w.h ? "active" : ""}`}
                data-hours={w.h}
                style={`padding:4px 10px;font-size:10px;${activeHours === w.h ? "background:rgba(88,166,255,0.15);border-color:rgba(88,166,255,0.5);color:var(--blue);" : ""}`}
                hx-on--click={windowBtnJs(w.h)}
              >{w.label}</button>
            ))}
            <span style="color:var(--text-dim);font-size:10px;margin:0 4px;">or</span>
            <input type="date" id="f-date-start" style="background:var(--bg);border:1px solid var(--border);border-radius:5px;color:var(--text);font-size:11px;padding:3px 6px;height:26px;" />
            <span style="color:var(--text-dim);">–</span>
            <input type="date" id="f-date-end" style="background:var(--bg);border:1px solid var(--border);border-radius:5px;color:var(--text);font-size:11px;padding:3px 6px;height:26px;" />
            <button type="button" class="btn btn-primary btn-sm" style="padding:4px 10px;font-size:11px;height:26px;" hx-on--click={goBtnJs}>Go</button>
          </div>
          <input type="hidden" name="since" id="ah-since" value={filters.since} />
          <input type="hidden" name="until" id="ah-until" value={filters.until} />
        </div>

        <div class="form-group" style="margin-bottom:0;">
          <label>Type</label>
          <select name="type" id="f-type">
            <option value="" selected={filters.type === ""}>All Types</option>
            <option value="date-leg" selected={filters.type === "date-leg"}>Internal</option>
            <option value="package" selected={filters.type === "package"}>Partner</option>
          </select>
        </div>

        <div class="form-group" style="margin-bottom:0;">
          <label>Team Member</label>
          <select name="owner" id="f-owner">{dd.owner}</select>
        </div>

        <div class="form-group" style="margin-bottom:0;">
          <label>Department</label>
          <select name="department" id="f-dept">{dd.department}</select>
        </div>

        <div class="form-group" style="margin-bottom:0;">
          <label>Shift</label>
          <select name="shift" id="f-shift">{dd.shift}</select>
        </div>

        <div class="form-group" style="margin-bottom:0;">
          <label>Reviewed</label>
          <select name="reviewed" id="f-reviewed">
            <option value="" selected={filters.reviewed === ""}>All</option>
            <option value="yes" selected={filters.reviewed === "yes"}>Reviewed</option>
            <option value="no" selected={filters.reviewed === "no"}>Not Reviewed</option>
            <option value="auto" selected={filters.reviewed === "auto"}>Auto</option>
            <option value="invalid_genie" selected={filters.reviewed === "invalid_genie"}>Invalid Genie</option>
          </select>
        </div>

        <div class="form-group" style="margin-bottom:0;">
          <label>Auditor</label>
          <select name="auditor" id="f-auditor">{dd.auditor}</select>
        </div>

        <div class="form-group" style="margin-bottom:0;">
          <label>Min Score %</label>
          <input type="number" name="scoreMin" id="f-score-min" value={filters.scoreMin} min="0" max="100" style="width:70px;" />
        </div>

        <div class="form-group" style="margin-bottom:0;">
          <label>Max Score %</label>
          <input type="number" name="scoreMax" id="f-score-max" value={filters.scoreMax} min="0" max="100" style="width:70px;" />
        </div>

        <button type="button" class="btn btn-primary btn-sm" hx-on--click={`htmx.trigger('#audit-history-filters','ah-refresh')`}>Apply Filters</button>
        <button type="button" class="btn btn-ghost btn-sm" hx-on--click={resetJs}>Reset</button>
        <button type="button" class="btn btn-ghost btn-sm" hx-on--click={csvBtnJs} style="font-size:10px;">⬇ CSV</button>

        <input type="hidden" name="page" value={filters.page} id="ah-page" />
        <input type="hidden" name="limit" value="50" />
      </form>

      <div id="audit-history-table" dangerouslySetInnerHTML={{ __html: mainHtml }} />
    </Layout>
  );
});
