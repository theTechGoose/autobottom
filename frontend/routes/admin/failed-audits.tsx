/** Failed Audits — failures-only analytics dashboard. Four views (line items,
 *  appealed-and-still-failed, by-question, department x question matrix) plus a
 *  "#1 fail" banner that answers "what is the top fail for [TM] in [dept] for
 *  [week]" with graceful scope degradation. Plain SSR + native GET nav, no
 *  inline JS. Admin only. Registered in FRONTEND_EXACT_PAGES. */

import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { apiFetch } from "../../lib/api.ts";
import {
  FA_PRESETS, FAILURE_SOURCES, resolveFaRange, parseIsoWeek, weekOptions,
} from "../../lib/failed-audits-range.ts";
import { MiniStat } from "../../components/EngagementCards.tsx";
import { MatrixTable, ByQuestionTable } from "../../components/FailedAuditsMatrix.tsx";
import type { MatrixData, QuestionCount } from "../../components/FailedAuditsMatrix.tsx";

interface FailRow {
  findingId: string; questionKey: string; header: string; completedAt: number;
  voName?: string; owner?: string; department?: string; shift?: string;
  recordId?: string; recordingId?: string; isPackage?: boolean; score: number;
  defense?: string; failureSource: string; appealed?: boolean; appealDenied?: boolean;
}
interface Paged { rows: FailRow[]; total: number; page: number; pages: number }
interface ByQuestionResp { rows: QuestionCount[]; total: number }
interface TopFailResp { rows: QuestionCount[]; scope: string; total: number }
interface Dimensions { departments: string[]; shifts: string[] }

const SOURCE_META: Record<string, { label: string; color: string }> = {
  autobot: { label: "Autobot", color: "var(--blue)" },
  vo_app: { label: "VO app", color: "var(--yellow)" },
  team_member: { label: "Team member", color: "var(--red)" },
  unknown: { label: "Unknown", color: "var(--text-dim)" },
};

const VIEWS: Array<{ key: string; label: string }> = [
  { key: "findings", label: "Failed findings" },
  { key: "appealed", label: "Appealed & still failed" },
  { key: "by-question", label: "By question" },
  { key: "matrix", label: "Dept x question" },
];

function fmtWhen(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function SourceBadge({ source }: { source: string }) {
  const m = SOURCE_META[source] ?? SOURCE_META.unknown;
  return (
    <span style={`display:inline-block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:${m.color};border:1px solid ${m.color};border-radius:4px;padding:1px 6px;`}>{m.label}</span>
  );
}

export default define.page(async function FailedAuditsPage(ctx) {
  const url = new URL(ctx.req.url);
  const sp = url.searchParams;

  // Range: week token > preset > explicit since/until > default current ISO week.
  const weekParam = (sp.get("week") ?? "").trim();
  const presetParam = (sp.get("preset") ?? "").trim();
  const sinceParam = sp.get("since");
  const untilParam = sp.get("until");
  let since: number, until: number, label: string, activePreset = "", activeWeek = "";
  const wk = weekParam ? parseIsoWeek(weekParam) : null;
  if (wk) { ({ since, until, label } = wk); activeWeek = weekParam; }
  else if (presetParam) { ({ since, until, label } = resolveFaRange(presetParam)); activePreset = presetParam; }
  else if (sinceParam != null && untilParam != null) {
    since = parseInt(sinceParam, 10) || 0;
    until = parseInt(untilParam, 10) || Date.now();
    label = `${new Date(since).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" })} → ${new Date(until).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" })}`;
  } else { ({ since, until, label } = resolveFaRange("this-week")); activePreset = "this-week"; }

  const view = sp.get("view") ?? "findings";
  const voName = (sp.get("voName") ?? "").trim();
  const department = (sp.get("department") ?? "").trim();
  const shift = (sp.get("shift") ?? "").trim();
  const header = (sp.get("header") ?? "").trim();
  const source = (sp.get("source") ?? "").trim();
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);

  const filterQs = `voName=${encodeURIComponent(voName)}&department=${encodeURIComponent(department)}&shift=${encodeURIComponent(shift)}&header=${encodeURIComponent(header)}&source=${encodeURIComponent(source)}`;
  const rangeQs = `since=${since}&until=${until}`;

  // Build an href that carries the active range + filters, with overrides.
  const mk = (o: Record<string, string | undefined> = {}): string => {
    const sp2 = new URLSearchParams();
    if (o.preset) sp2.set("preset", o.preset);
    else if (o.week) sp2.set("week", o.week);
    else if (activeWeek) sp2.set("week", activeWeek);
    else if (activePreset) sp2.set("preset", activePreset);
    else { sp2.set("since", String(since)); sp2.set("until", String(until)); }
    const cur: Record<string, string> = { view, voName, department, shift, header, source };
    for (const k of ["view", "voName", "department", "shift", "header", "source", "page"]) {
      const v = k in o ? o[k] : cur[k];
      if (v != null && v !== "") sp2.set(k, String(v));
    }
    return `/admin/failed-audits?${sp2.toString()}`;
  };

  // Fetches: dimensions (datalists), #1-fail banner, and the active view's data.
  let dims: Dimensions = { departments: [], shifts: [] };
  try { dims = await apiFetch<Dimensions>("/admin/audit-dimensions", ctx.req); } catch (_e) { /* datalists optional */ }
  let topFail: TopFailResp | null = null;
  try { topFail = await apiFetch<TopFailResp>(`/admin/failed-audits/top-fail?${rangeQs}&${filterQs}`, ctx.req); } catch (_e) { /* banner optional */ }

  let error = "";
  let findings: Paged | null = null;
  let byQuestion: ByQuestionResp | null = null;
  let matrix: MatrixData | null = null;
  try {
    if (view === "by-question") {
      byQuestion = await apiFetch<ByQuestionResp>(`/admin/failed-audits/by-question?${rangeQs}&${filterQs}`, ctx.req);
    } else if (view === "matrix") {
      matrix = await apiFetch<MatrixData>(`/admin/failed-audits/matrix?${rangeQs}&${filterQs}`, ctx.req);
    } else {
      const endpoint = view === "appealed" ? "appealed" : "findings";
      findings = await apiFetch<Paged>(`/admin/failed-audits/${endpoint}?${rangeQs}&${filterQs}&page=${page}`, ctx.req);
    }
  } catch (e) { error = String((e as Error).message ?? e); }

  const totalForView = view === "by-question" ? (byQuestion?.total ?? 0)
    : view === "matrix" ? (matrix?.grandTotal ?? 0)
    : (findings?.total ?? 0);
  const weeks = weekOptions(until || Date.now(), 16);

  return (
    <Layout title="Failed Audits" section="admin" user={ctx.state.user!} pathname={url.pathname} hideSidebar>
      <div class="ql-topbar">
        <div class="ql-topbar-title"><span class="ql-topbar-icon" aria-hidden="true">🚫</span><h1>Failed Audits</h1></div>
        <a href="/admin/dashboard" class="ql-topbar-back">← Dashboard</a>
      </div>

      <div class="ql-page-body">
        {/* Range presets + ISO week selector */}
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px;padding:10px 12px;background:var(--bg-raised);border:1px solid var(--border);border-radius:8px;">
          <span style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-right:4px;">Range</span>
          {FA_PRESETS.map((p) => (
            <a key={p.key} href={mk({ preset: p.key, week: undefined, page: undefined })}
              class={`sf-btn ${p.key === activePreset ? "primary" : "ghost"}`}
              style="font-size:11px;padding:4px 12px;text-decoration:none;">{p.label}</a>
          ))}
          <form method="GET" action="/admin/failed-audits" style="display:flex;align-items:center;gap:6px;margin-left:auto;">
            <input type="hidden" name="view" value={view} />
            <input type="hidden" name="voName" value={voName} />
            <input type="hidden" name="department" value={department} />
            <input type="hidden" name="shift" value={shift} />
            <input type="hidden" name="header" value={header} />
            <input type="hidden" name="source" value={source} />
            <span style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;">Week</span>
            <select name="week" class="sf-input" style="font-size:11px;padding:3px 6px;">
              <option value="">pick a week…</option>
              {weeks.map((w) => (
                <option key={w.value} value={w.value} selected={w.value === activeWeek}>{w.label}</option>
              ))}
            </select>
            <button type="submit" class="sf-btn ghost" style="font-size:11px;padding:4px 12px;">Go</button>
          </form>
        </div>

        {/* Filters */}
        <form method="GET" action="/admin/failed-audits" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;padding:10px 12px;background:var(--bg-raised);border:1px solid var(--border);border-radius:8px;">
          <input type="hidden" name="view" value={view} />
          {activeWeek ? <input type="hidden" name="week" value={activeWeek} />
            : activePreset ? <input type="hidden" name="preset" value={activePreset} />
            : (<><input type="hidden" name="since" value={String(since)} /><input type="hidden" name="until" value={String(until)} /></>)}
          <input type="hidden" name="page" value="1" />
          <span style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;">Filters</span>
          <input type="text" name="voName" value={voName} placeholder="team member" class="sf-input" style="font-size:11px;padding:3px 6px;width:130px;" />
          <input type="text" name="department" value={department} placeholder="department" list="fa-dept-options" class="sf-input" style="font-size:11px;padding:3px 6px;width:140px;" />
          <datalist id="fa-dept-options">{dims.departments.map((d) => <option key={d} value={d} />)}</datalist>
          <input type="text" name="shift" value={shift} placeholder="shift" list="fa-shift-options" class="sf-input" style="font-size:11px;padding:3px 6px;width:90px;" />
          <datalist id="fa-shift-options">{dims.shifts.map((s) => <option key={s} value={s} />)}</datalist>
          <input type="text" name="header" value={header} placeholder="question" class="sf-input" style="font-size:11px;padding:3px 6px;width:130px;" />
          <select name="source" class="sf-input" style="font-size:11px;padding:3px 6px;">
            {FAILURE_SOURCES.map((s) => <option key={s.key} value={s.key} selected={s.key === source}>{s.label}</option>)}
          </select>
          <button type="submit" class="sf-btn primary" style="font-size:11px;padding:4px 12px;">Apply</button>
          <a href={mk({ voName: undefined, department: undefined, shift: undefined, header: undefined, source: undefined, page: undefined })} class="sf-btn ghost" style="font-size:11px;padding:4px 12px;text-decoration:none;">Clear</a>
        </form>

        <div style="font-size:13px;font-weight:700;color:var(--text-bright);margin-bottom:10px;">
          {label} · {totalForView.toLocaleString()} failures
        </div>

        {/* #1 fail banner — answers "what is the top fail for these filters". */}
        {topFail && topFail.rows.length > 0 && (
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;padding:12px 14px;border:1px solid var(--border);border-left:3px solid var(--red);border-radius:8px;background:var(--bg-2);">
            <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;">#1 fail</div>
            <div style="font-size:16px;font-weight:800;color:var(--text-bright);">{topFail.rows[0].header}</div>
            <div style="font-size:13px;color:var(--red);font-weight:700;">{topFail.rows[0].count.toLocaleString()} failures</div>
            <div style="font-size:11px;color:var(--text-dim);margin-left:auto;">scope: {topFail.scope}</div>
          </div>
        )}

        {/* Headline stats */}
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px;">
          <MiniStat label="Failures in range" value={totalForView} color="var(--red)" />
          <MiniStat label="Distinct questions" value={view === "by-question" ? (byQuestion?.rows.length ?? 0) : (matrix?.questions.length ?? topFail?.rows.length ?? 0)} />
          <MiniStat label="Departments" value={matrix?.departments.length ?? 0} />
          <MiniStat label="Appealed & denied" value={view === "appealed" ? (findings?.total ?? 0) : 0} color="var(--yellow)" />
        </div>

        {/* View tabs */}
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">
          {VIEWS.map((v) => (
            <a key={v.key} href={mk({ view: v.key, page: undefined })}
              class={`sf-btn ${v.key === view ? "primary" : "ghost"}`}
              style="font-size:11px;padding:5px 12px;text-decoration:none;">{v.label}</a>
          ))}
        </div>

        {error ? (
          <div class="error-text" style="font-size:12px;padding:12px;border:1px solid var(--red);border-radius:8px;">Failed to load: {error}</div>
        ) : (
          <div style="border:1px solid var(--border);border-radius:8px;background:var(--bg);overflow:hidden;">
            {view === "matrix" && matrix && <MatrixTable matrix={matrix} />}
            {view === "by-question" && byQuestion && <ByQuestionTable rows={byQuestion.rows} total={byQuestion.total} />}
            {(view === "findings" || view === "appealed") && findings && (
              <>
                <table style="width:100%;border-collapse:collapse;font-size:12px;">
                  <thead>
                    <tr style="color:var(--text-dim);font-size:10px;text-transform:uppercase;letter-spacing:0.5px;">
                      <th style="text-align:left;padding:6px 12px;">Audit</th>
                      <th style="text-align:left;padding:6px 8px;">Question</th>
                      <th style="text-align:left;padding:6px 8px;">Source</th>
                      <th style="text-align:left;padding:6px 8px;">Team member</th>
                      <th style="text-align:left;padding:6px 8px;">Department</th>
                      <th style="text-align:left;padding:6px 8px;">Shift</th>
                      <th style="text-align:right;padding:6px 8px;">Score</th>
                      <th style="text-align:left;padding:6px 12px;">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {findings.rows.length === 0 && (
                      <tr><td colSpan={8} style="padding:16px;text-align:center;color:var(--text-dim);">{view === "appealed" ? "No appealed-and-denied fails in this window." : "No failures match the current filters."}</td></tr>
                    )}
                    {findings.rows.map((r) => (
                      <tr key={`${r.findingId}:${r.questionKey}`} style="border-top:1px solid var(--border);font-variant-numeric:tabular-nums;">
                        <td style="padding:6px 12px;">
                          <a href={`/audit/report?id=${encodeURIComponent(r.findingId)}`} target="_blank" rel="noopener" class="tbl-link" style="color:var(--blue);text-decoration:none;">
                            {r.recordingId || r.recordId || r.findingId.slice(0, 8)}
                          </a>
                        </td>
                        <td style="padding:6px 8px;color:var(--text-bright);">{r.header}</td>
                        <td style="padding:6px 8px;"><SourceBadge source={r.failureSource} /></td>
                        <td style="padding:6px 8px;color:var(--text);">{r.voName || "—"}</td>
                        <td style="padding:6px 8px;color:var(--text-dim);">{r.department || "—"}</td>
                        <td style="padding:6px 8px;color:var(--text-dim);">{r.shift || "—"}</td>
                        <td style="text-align:right;padding:6px 8px;">{r.score != null ? `${r.score}%` : "—"}</td>
                        <td style="padding:6px 12px;color:var(--text-dim);">{fmtWhen(r.completedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {findings.pages > 1 && (
                  <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-top:1px solid var(--border);">
                    {findings.page > 1
                      ? <a href={mk({ page: String(findings.page - 1) })} class="sf-btn ghost" style="font-size:11px;padding:4px 12px;text-decoration:none;">← Prev</a>
                      : <span></span>}
                    <span style="font-size:11px;color:var(--text-dim);">Page {findings.page} of {findings.pages}</span>
                    {findings.page < findings.pages
                      ? <a href={mk({ page: String(findings.page + 1) })} class="sf-btn ghost" style="font-size:11px;padding:4px 12px;text-decoration:none;">Next →</a>
                      : <span></span>}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
});
