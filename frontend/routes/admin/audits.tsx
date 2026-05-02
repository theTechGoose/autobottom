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
        /* === Audit History page — prod-parity layout === */
        .audits-topbar { display:flex; align-items:center; gap:16px; padding:0 24px; height:52px; background:var(--bg-raised); border-bottom:1px solid var(--border); flex-shrink:0; }
        .audits-topbar h1 { font-size:14px; font-weight:700; color:var(--text-bright); margin:0; }
        .audits-topbar .ah-back { font-size:11px; color:var(--text-muted); text-decoration:none; padding:4px 10px; border:1px solid var(--border); border-radius:6px; transition:all 0.15s; }
        .audits-topbar .ah-back:hover { background:var(--bg-surface); color:var(--text); }
        .audits-topbar .ah-sub { font-size:11px; color:var(--text-dim); margin-left:auto; }

        .audits-filters { display:flex; align-items:center; gap:10px; padding:14px 24px; background:var(--bg-raised); border-bottom:1px solid var(--border); flex-wrap:wrap; }
        .audits-filters > label { font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:0.8px; color:var(--text-muted); display:flex; flex-direction:column; gap:3px; margin:0; }
        .audits-filters select, .audits-filters input[type=number] { background:var(--bg); border:1px solid var(--border); border-radius:5px; color:var(--text); font-size:11px; padding:5px 8px; font-family:'SF Mono','Fira Code',monospace; }
        .audits-filters select:focus, .audits-filters input:focus { outline:none; border-color:var(--blue); }
        .audits-filters input[type="date"] { background:var(--bg); border:1px solid var(--border); border-radius:5px; color:var(--text); font-size:11px; padding:3px 8px; height:26px; color-scheme:dark; }
        .audits-filters input[type="date"]::-webkit-calendar-picker-indicator { filter:invert(1) brightness(1.3); cursor:pointer; }

        .window-btns { display:flex; gap:4px; align-items:center; }
        .window-btn { padding:4px 10px; border-radius:5px; font-size:10px; font-weight:600; cursor:pointer; border:1px solid var(--border); background:var(--bg); color:var(--text-muted); transition:all 0.15s; }
        .window-btn:hover { background:var(--bg-surface); color:var(--text); }
        .window-btn.active { background:rgba(88,166,255,0.15); border-color:rgba(88,166,255,0.5); color:var(--blue); }

        .ah-btn { padding:5px 14px; border-radius:6px; font-size:11px; font-weight:600; cursor:pointer; border:none; transition:all 0.15s; }
        .ah-btn-primary { background:#1f6feb; color:#fff; }
        .ah-btn-primary:hover { background:#388bfd; }
        .ah-btn-ghost { background:transparent; color:var(--text-muted); border:1px solid var(--border); }
        .ah-btn-ghost:hover { background:var(--bg-surface); color:var(--text); }

        .audits-content { padding:20px 24px; }
        .audits-stats { display:flex; gap:12px; margin-bottom:16px; flex-wrap:wrap; }
        .audits-stats .stat-card { background:var(--bg-raised); border:1px solid var(--border); border-radius:8px; padding:10px 16px; min-width:120px; }
        .audits-stats .stat-card .val { font-size:20px; font-weight:700; color:var(--text-bright); line-height:1; }
        .audits-stats .stat-card .lbl { font-size:10px; color:var(--text-muted); margin-top:3px; }

        .audits-tbl-wrap { background:var(--bg-raised); border:1px solid var(--border); border-radius:10px; overflow:hidden; }
        .audits-tbl-wrap table { width:100%; border-collapse:collapse; font-size:12px; }
        .audits-tbl-wrap thead th { text-align:left; font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:var(--text-dim); padding:6px 12px; border-bottom:1px solid var(--border); white-space:nowrap; }
        .audits-tbl-wrap tbody tr { border-bottom:1px solid rgba(28,35,51,0.6); transition:background 0.1s; }
        .audits-tbl-wrap tbody tr:hover { background:var(--bg-raised); }
        .audits-tbl-wrap tbody td { padding:8px 12px; color:var(--text); vertical-align:middle; }
        .audits-tbl-wrap .empty { text-align:center; color:var(--text-dim); font-size:12px; padding:40px 0; }
      `}</style>

      <div class="audits-topbar">
        <a class="ah-back" href="/admin/dashboard">&larr; Dashboard</a>
        <h1>
          Audit History <span id="ah-window" style="font-weight:400;color:var(--text-muted);">({windowLabel(filters)})</span>
        </h1>
        <span class="ah-sub" id="ah-count">{data.total} audits in window</span>
      </div>

      {/* Filter strip — single horizontal row matching prod. ah-refresh is
          listed in hx-trigger so programmatic htmx.trigger() from buttons
          actually fires the GET (the change-from-select source filter
          ignores form-level dispatched events). */}
      <form
        id="audit-history-filters"
        class="audits-filters"
        hx-get="/api/admin/audit-history"
        hx-target="#audit-history-table"
        hx-trigger="change from:select, change delay:300ms from:input[type=number], ah-refresh"
        hx-swap="innerHTML"
        hx-include="closest form"
      >
        <label>Date Range
          <div class="window-btns">
            {WINDOWS.map((w) => (
              <button
                key={w.h}
                type="button"
                class={`window-btn ${activeHours === w.h ? "active" : ""}`}
                data-hours={w.h}
                hx-on--click={windowBtnJs(w.h)}
              >{w.label}</button>
            ))}
            <span style="color:var(--text-dim);font-size:10px;margin:0 4px;align-self:center;">or</span>
            <input type="date" id="f-date-start" />
            <span style="color:var(--text-dim);align-self:center;">–</span>
            <input type="date" id="f-date-end" />
            <button type="button" class="ah-btn ah-btn-primary" style="padding:3px 10px;font-size:11px;height:26px;" hx-on--click={goBtnJs}>Go</button>
          </div>
          <input type="hidden" name="since" id="ah-since" value={filters.since} />
          <input type="hidden" name="until" id="ah-until" value={filters.until} />
        </label>

        <label>Type
          <select name="type" id="f-type">
            <option value="" selected={filters.type === ""}>All Types</option>
            <option value="date-leg" selected={filters.type === "date-leg"}>Internal</option>
            <option value="package" selected={filters.type === "package"}>Partner</option>
          </select>
        </label>

        <label>Team Member
          <select name="owner" id="f-owner">{dd.owner}</select>
        </label>

        <label>Department
          <select name="department" id="f-dept">{dd.department}</select>
        </label>

        <label>Shift
          <select name="shift" id="f-shift">{dd.shift}</select>
        </label>

        <label>Reviewed
          <select name="reviewed" id="f-reviewed">
            <option value="" selected={filters.reviewed === ""}>All</option>
            <option value="yes" selected={filters.reviewed === "yes"}>Reviewed</option>
            <option value="no" selected={filters.reviewed === "no"}>Not Reviewed</option>
            <option value="auto" selected={filters.reviewed === "auto"}>Auto</option>
            <option value="invalid_genie" selected={filters.reviewed === "invalid_genie"}>Invalid Genie</option>
          </select>
        </label>

        <label>Auditor
          <select name="auditor" id="f-auditor">{dd.auditor}</select>
        </label>

        <label>Min Score %
          <input type="number" name="scoreMin" id="f-score-min" value={filters.scoreMin} min="0" max="100" style="width:70px;" />
        </label>

        <label>Max Score %
          <input type="number" name="scoreMax" id="f-score-max" value={filters.scoreMax} min="0" max="100" style="width:70px;" />
        </label>

        <label style="align-self:flex-end;">
          <button type="button" class="ah-btn ah-btn-primary" hx-on--click={`htmx.trigger('#audit-history-filters','ah-refresh')`}>Apply Filters</button>
        </label>
        <label style="align-self:flex-end;">
          <button type="button" class="ah-btn ah-btn-ghost" hx-on--click={resetJs}>Reset</button>
        </label>
        <label style="align-self:flex-end;">
          <button type="button" class="ah-btn ah-btn-ghost" style="font-size:10px;" hx-on--click={csvBtnJs}>⬇ CSV</button>
        </label>

        <input type="hidden" name="page" value={filters.page} id="ah-page" />
        <input type="hidden" name="limit" value="50" />
      </form>

      <div class="audits-content">
        <div id="audit-history-table" dangerouslySetInnerHTML={{ __html: mainHtml }} />
      </div>
    </Layout>
  );
});
