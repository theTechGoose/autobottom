/** Reviewer Throughput — full-page report. Popped out from the Reports modal.
 *  Two pivots (By-Reviewer + By-Question) with a question filter; clicking a
 *  reviewer drills into that reviewer's audits (?reviewer=), and each audit
 *  links to its report (per-question handle times live there).
 *
 *  Handle time is forward-only — only audits reviewed after timing capture
 *  shipped have it; older rows show volume only. Plain SSR + native GET nav.
 *  Registered in FRONTEND_EXACT_PAGES. */

import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { apiFetch } from "../../lib/api.ts";
import { RT_PRESETS, resolveRange } from "../../lib/report-range.ts";
import { MiniStat } from "../../components/EngagementCards.tsx";

interface ByReviewer {
  email: string; reviewed: number; avgScore: number; lastReviewedAt: number | null;
  handledAudits: number; avgHandleMs: number; medianHandleMs: number; activeMs: number;
  auditsPerActiveHour: number; validQuestions: number; avgPerQuestionMs: number;
}
interface ByQuestion { header: string; samples: number; avgMs: number; medianMs: number; discardedCount: number }
interface DetailResp {
  aggregate: { reviewers: number; totalAudits: number; handledAudits: number; avgHandleMs: number; avgPerQuestionMs: number; auditsPerActiveHour: number };
  byReviewer: ByReviewer[]; byQuestion: ByQuestion[]; cohort: number; hydrated: number; capped: boolean;
}
interface AuditRow {
  findingId: string; completedAt: number; score: number; isPackage?: boolean;
  recordId?: string; recordingId?: string; voName?: string;
  reviewHandleMs?: number; reviewedQuestionCount?: number; reviewedValidCount?: number;
}
interface ReviewerResp { rows: AuditRow[]; total: number; page: number; pages: number }
interface HeaderOverturn { header: string; judged: number; overturns: number; rate: number }
interface OverturnRow {
  email: string; judged: number; overturns: number; overturnRate: number;
  auditsJudged: number; auditsOverturned: number; auditOverturnRate: number; byHeader: HeaderOverturn[];
}
interface QualityResult { rows: OverturnRow[]; cohortDecisions: number; hydratedFindings: number; capped: boolean }
interface QualityResp { ranged: QualityResult; lifetime: QualityResult }
interface QualityDetailResp { range: OverturnRow | null; lifetime: OverturnRow | null }

/** Org-wide overturn rate = Σ overturns / Σ appealed-and-judged questions. */
function orgRate(rows: OverturnRow[]): { rate: number; overturns: number; judged: number } {
  let o = 0, j = 0;
  for (const r of rows) { o += r.overturns; j += r.judged; }
  return { rate: j > 0 ? Math.round((o / j) * 100) : 0, overturns: o, judged: j };
}
/** Higher overturn rate is worse — red past 30%, yellow past 15%, else green. */
function rateColor(rate: number): string {
  if (rate >= 30) return "var(--red)";
  if (rate >= 15) return "var(--yellow)";
  return "var(--green)";
}

function fmtMs(ms?: number): string {
  if (ms == null || ms <= 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}
function fmtTime(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Stat card whose value is a preformatted string (e.g. "2m 1s") — MiniStat only
 *  takes numbers, so handle-time cards use this. */
function TimeStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style="border:1px solid var(--border);border-radius:6px;padding:10px;background:var(--bg);">
      <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">{label}</div>
      <div style={`font-size:18px;font-weight:700;color:${color ?? "var(--text-bright)"};font-variant-numeric:tabular-nums;`}>{value}</div>
    </div>
  );
}

export default define.page(async function ReviewerThroughputPage(ctx) {
  const url = new URL(ctx.req.url);
  const sp = url.searchParams;

  // Range: explicit preset → explicit since/until → default Today.
  const presetParam = sp.get("preset") ?? "";
  const customFrom = sp.get("custom-from") ?? "";
  const customTo = sp.get("custom-to") ?? "";
  const sinceParam = sp.get("since");
  const untilParam = sp.get("until");
  let since: number, until: number, label: string, activePreset: string;
  if (presetParam) {
    ({ since, until, label } = resolveRange(presetParam, customFrom, customTo));
    activePreset = presetParam;
  } else if (sinceParam != null && untilParam != null) {
    since = parseInt(sinceParam, 10) || 0;
    until = parseInt(untilParam, 10) || Date.now();
    label = `${fmtTime(since)} → ${fmtTime(until)}`;
    activePreset = "";
  } else {
    ({ since, until, label } = resolveRange("today", "", ""));
    activePreset = "today";
  }

  const q = (sp.get("q") ?? "").trim();
  const reviewer = (sp.get("reviewer") ?? "").trim();
  const rangeQ = `since=${since}&until=${until}`;

  // ── Drill-down: one reviewer's audits ──────────────────────────────────────
  if (reviewer) {
    const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
    let data: ReviewerResp | null = null;
    let error = "";
    try {
      data = await apiFetch<ReviewerResp>(
        `/admin/reviewer-throughput/reviewer?email=${encodeURIComponent(reviewer)}&${rangeQ}&page=${page}`, ctx.req);
    } catch (e) { error = String((e as Error).message ?? e); }
    let quality: QualityDetailResp | null = null;
    try {
      quality = await apiFetch<QualityDetailResp>(
        `/admin/reviewer-quality/reviewer?email=${encodeURIComponent(reviewer)}&${rangeQ}`, ctx.req);
    } catch (_e) { /* throughput drill-down still renders without overturn data */ }
    const qRange = quality?.range ?? null;
    const qLife = quality?.lifetime ?? null;
    return (
      <Layout title="Reviewer Throughput" section="admin" user={ctx.state.user!} pathname={url.pathname} hideSidebar>
        <div class="ql-topbar">
          <div class="ql-topbar-title"><span class="ql-topbar-icon" aria-hidden="true">⏱️</span><h1>Reviewer Throughput</h1></div>
          <a href="/admin/dashboard" class="ql-topbar-back">← Dashboard</a>
        </div>
        <div class="ql-page-body">
          <div style="margin-bottom:12px;">
            <a href={`/admin/reviewer-throughput?${rangeQ}`} class="sf-btn ghost" style="font-size:11px;padding:4px 10px;text-decoration:none;">← All reviewers</a>
          </div>
          <div style="font-size:13px;font-weight:700;color:var(--text-bright);margin-bottom:12px;">
            {reviewer} · {label} · {data?.total?.toLocaleString() ?? 0} audits
          </div>

          {/* Overturn quality — appealed-and-judged questions only. */}
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:16px;">
            <div style={`border:1px solid var(--border);border-left:3px solid ${rateColor(qRange?.overturnRate ?? 0)};border-radius:8px;padding:14px;background:var(--bg-2);`}>
              <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Overturn rate (range)</div>
              <div style={`font-size:28px;font-weight:800;color:${rateColor(qRange?.overturnRate ?? 0)};font-variant-numeric:tabular-nums;`}>{qRange ? `${qRange.overturnRate}%` : "—"}</div>
              <div style="font-size:11px;color:var(--text-dim);margin-top:8px;">{qRange?.overturns ?? 0} overturned of <strong style="color:var(--text-bright);">{qRange?.judged ?? 0}</strong> appealed and judged</div>
            </div>
            <div style={`border:1px solid var(--border);border-left:3px solid ${rateColor(qLife?.overturnRate ?? 0)};border-radius:8px;padding:14px;background:var(--bg-2);`}>
              <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Overturn rate (lifetime)</div>
              <div style={`font-size:28px;font-weight:800;color:${rateColor(qLife?.overturnRate ?? 0)};font-variant-numeric:tabular-nums;`}>{qLife ? `${qLife.overturnRate}%` : "—"}</div>
              <div style="font-size:11px;color:var(--text-dim);margin-top:8px;">{qLife?.overturns ?? 0} overturned of <strong style="color:var(--text-bright);">{qLife?.judged ?? 0}</strong> all time</div>
            </div>
          </div>

          {/* Per-question overturn breakdown (which questions this reviewer gets overturned on). */}
          {qRange && qRange.byHeader.length > 0 && (
            <div style="border:1px solid var(--border);border-radius:8px;background:var(--bg);overflow:hidden;margin-bottom:18px;">
              <div style="font-size:11px;font-weight:700;color:var(--text-bright);padding:10px 12px;border-bottom:1px solid var(--border);text-transform:uppercase;letter-spacing:0.5px;">Overturns by question (range)</div>
              <table style="width:100%;border-collapse:collapse;font-size:12px;">
                <thead>
                  <tr style="color:var(--text-dim);font-size:10px;text-transform:uppercase;letter-spacing:0.5px;">
                    <th style="text-align:left;padding:6px 12px;">Question</th>
                    <th style="text-align:right;padding:6px 8px;">Appealed and judged</th>
                    <th style="text-align:right;padding:6px 8px;">Overturned</th>
                    <th style="text-align:right;padding:6px 12px;">Overturn rate</th>
                  </tr>
                </thead>
                <tbody>
                  {qRange.byHeader.map((h) => (
                    <tr key={h.header} style="border-top:1px solid var(--border);font-variant-numeric:tabular-nums;">
                      <td style="padding:6px 12px;color:var(--text-bright);">{h.header}</td>
                      <td style="text-align:right;padding:6px 8px;color:var(--text-dim);">{h.judged}</td>
                      <td style="text-align:right;padding:6px 8px;">{h.overturns}</td>
                      <td style={`text-align:right;padding:6px 12px;color:${rateColor(h.rate)};`}>{h.rate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {error ? (
            <div class="error-text" style="font-size:12px;padding:12px;border:1px solid var(--red);border-radius:8px;">Failed: {error}</div>
          ) : (
            <div style="border:1px solid var(--border);border-radius:8px;background:var(--bg);overflow:hidden;">
              <table style="width:100%;border-collapse:collapse;font-size:12px;">
                <thead>
                  <tr style="color:var(--text-dim);font-size:10px;text-transform:uppercase;letter-spacing:0.5px;">
                    <th style="text-align:left;padding:6px 12px;">Audit</th>
                    <th style="text-align:left;padding:6px 8px;">Team Member</th>
                    <th style="text-align:right;padding:6px 8px;">Score</th>
                    <th style="text-align:right;padding:6px 8px;">Handle time</th>
                    <th style="text-align:right;padding:6px 8px;">Qs (valid)</th>
                    <th style="text-align:left;padding:6px 12px;">Reviewed</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.rows ?? []).length === 0 && (
                    <tr><td colSpan={6} style="padding:16px;text-align:center;color:var(--text-dim);">No audits in this window.</td></tr>
                  )}
                  {(data?.rows ?? []).map((r) => (
                    <tr key={r.findingId} style="border-top:1px solid var(--border);font-variant-numeric:tabular-nums;">
                      <td style="padding:6px 12px;">
                        <a href={`/audit/report?id=${encodeURIComponent(r.findingId)}`} target="_blank" rel="noopener" class="tbl-link" style="color:var(--blue);text-decoration:none;">
                          {r.recordingId || r.recordId || r.findingId.slice(0, 8)}
                        </a>
                      </td>
                      <td style="padding:6px 8px;color:var(--text);">{r.voName || "—"}</td>
                      <td style="text-align:right;padding:6px 8px;">{r.score != null ? `${r.score}%` : "—"}</td>
                      <td style="text-align:right;padding:6px 8px;color:var(--cyan);">{fmtMs(r.reviewHandleMs)}</td>
                      <td style="text-align:right;padding:6px 8px;color:var(--text-dim);">{r.reviewedValidCount ?? 0}/{r.reviewedQuestionCount ?? 0}</td>
                      <td style="padding:6px 12px;color:var(--text-dim);">{fmtTime(r.completedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data && data.pages > 1 && (
                <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-top:1px solid var(--border);">
                  {data.page > 1
                    ? <a href={`/admin/reviewer-throughput?reviewer=${encodeURIComponent(reviewer)}&${rangeQ}&page=${data.page - 1}`} class="sf-btn ghost" style="font-size:11px;padding:4px 12px;text-decoration:none;">← Prev</a>
                    : <span></span>}
                  <span style="font-size:11px;color:var(--text-dim);">Page {data.page} of {data.pages}</span>
                  {data.page < data.pages
                    ? <a href={`/admin/reviewer-throughput?reviewer=${encodeURIComponent(reviewer)}&${rangeQ}&page=${data.page + 1}`} class="sf-btn ghost" style="font-size:11px;padding:4px 12px;text-decoration:none;">Next →</a>
                    : <span></span>}
                </div>
              )}
            </div>
          )}
        </div>
      </Layout>
    );
  }

  // ── Main: by-reviewer + by-question ────────────────────────────────────────
  let data: DetailResp | null = null;
  let error = "";
  try {
    data = await apiFetch<DetailResp>(`/admin/reviewer-throughput/detail?${rangeQ}&q=${encodeURIComponent(q)}`, ctx.req);
  } catch (e) { error = String((e as Error).message ?? e); }
  const a = data?.aggregate;

  // Overturn quality (best-effort — throughput still renders if it fails).
  let quality: QualityResp | null = null;
  try {
    quality = await apiFetch<QualityResp>(`/admin/reviewer-quality/detail?${rangeQ}`, ctx.req);
  } catch (_e) { /* keep throughput even without overturn data */ }
  const rangedByEmail = new Map((quality?.ranged.rows ?? []).map((r) => [r.email, r]));
  const lifeByEmail = new Map((quality?.lifetime.rows ?? []).map((r) => [r.email, r]));
  const orgRange = orgRate(quality?.ranged.rows ?? []);
  const orgLife = orgRate(quality?.lifetime.rows ?? []);

  return (
    <Layout title="Reviewer Throughput" section="admin" user={ctx.state.user!} pathname={url.pathname} hideSidebar>
      <div class="ql-topbar">
        <div class="ql-topbar-title"><span class="ql-topbar-icon" aria-hidden="true">⏱️</span><h1>Reviewer Throughput</h1></div>
        <a href="/admin/dashboard" class="ql-topbar-back">← Dashboard</a>
      </div>

      <div class="ql-page-body">
        {/* Range presets (native nav) + question filter form */}
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px;padding:10px 12px;background:var(--bg-raised);border:1px solid var(--border);border-radius:8px;">
          <span style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-right:4px;">Range</span>
          {RT_PRESETS.map((p) => (
            <a key={p.key} href={`/admin/reviewer-throughput?preset=${p.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
              class={`sf-btn ${p.key === activePreset ? "primary" : "ghost"}`}
              style="font-size:11px;padding:4px 12px;text-decoration:none;">{p.label}</a>
          ))}
          <form method="GET" action="/admin/reviewer-throughput" style="display:flex;align-items:center;gap:6px;margin-left:auto;">
            <input type="hidden" name="since" value={String(since)} />
            <input type="hidden" name="until" value={String(until)} />
            <input type="text" name="q" value={q} placeholder="filter questions…" class="sf-input" style="font-size:11px;padding:2px 6px;width:180px;" />
            <button type="submit" class="sf-btn primary" style="font-size:11px;padding:4px 12px;">Filter</button>
          </form>
        </div>
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:14px;">
          Per-audit handle time is <strong>approximated</strong> from the gap between a reviewer's
          consecutive audit completions; gaps over 15&nbsp;min are treated as breaks and excluded, so it
          works across all history. Per-question times (the By&nbsp;Question table and the top-row
          Avg&nbsp;/&nbsp;question) are the true mean of exact decision-to-decision gaps and fill in going forward.
        </div>

        {error ? (
          <div class="error-text" style="font-size:12px;padding:12px;border:1px solid var(--red);border-radius:8px;">Failed to load: {error}</div>
        ) : a && data ? (
          <>
            <div style="font-size:13px;font-weight:700;color:var(--text-bright);margin-bottom:12px;">
              {label} · {a.totalAudits.toLocaleString()} audits · {a.reviewers} reviewers
            </div>

            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:10px;">
              <MiniStat label="Audits reviewed" value={a.totalAudits} />
              <TimeStat label="Avg handle / audit" value={fmtMs(a.avgHandleMs)} color="var(--cyan)" />
              <TimeStat label="Avg / question" value={a.avgPerQuestionMs ? fmtMs(a.avgPerQuestionMs) : "—"} color="var(--green)" />
              <MiniStat label="Audits / active hr" value={a.auditsPerActiveHour} color="var(--yellow)" />
            </div>

            {/* Org-wide overturn quality — appealed-and-judged questions only. */}
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:18px;">
              <div style={`border:1px solid var(--border);border-left:3px solid ${rateColor(orgRange.rate)};border-radius:8px;padding:14px;background:var(--bg-2);`}>
                <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Overturn rate (range)</div>
                <div style={`font-size:28px;font-weight:800;color:${rateColor(orgRange.rate)};font-variant-numeric:tabular-nums;`}>{orgRange.judged ? `${orgRange.rate}%` : "—"}</div>
                <div style="font-size:11px;color:var(--text-dim);margin-top:8px;">{orgRange.overturns} overturned of <strong style="color:var(--text-bright);">{orgRange.judged}</strong> appealed and judged</div>
              </div>
              <div style={`border:1px solid var(--border);border-left:3px solid ${rateColor(orgLife.rate)};border-radius:8px;padding:14px;background:var(--bg-2);`}>
                <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Overturn rate (lifetime)</div>
                <div style={`font-size:28px;font-weight:800;color:${rateColor(orgLife.rate)};font-variant-numeric:tabular-nums;`}>{orgLife.judged ? `${orgLife.rate}%` : "—"}</div>
                <div style="font-size:11px;color:var(--text-dim);margin-top:8px;">{orgLife.overturns} overturned of <strong style="color:var(--text-bright);">{orgLife.judged}</strong> all time</div>
              </div>
            </div>

            {/* By reviewer */}
            <div style="border:1px solid var(--border);border-radius:8px;background:var(--bg);overflow:hidden;margin-bottom:18px;">
              <div style="font-size:11px;font-weight:700;color:var(--text-bright);padding:10px 12px;border-bottom:1px solid var(--border);text-transform:uppercase;letter-spacing:0.5px;">By reviewer</div>
              <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:12px;">
                  <thead>
                    <tr style="color:var(--text-dim);font-size:10px;text-transform:uppercase;letter-spacing:0.5px;">
                      <th style="text-align:left;padding:6px 12px;">Reviewer</th>
                      <th style="text-align:right;padding:6px 8px;">Audits</th>
                      <th style="text-align:right;padding:6px 8px;">Avg handle</th>
                      <th style="text-align:right;padding:6px 8px;">Median</th>
                      <th style="text-align:right;padding:6px 8px;">Avg / question</th>
                      <th style="text-align:right;padding:6px 8px;">Audits/hr</th>
                      <th style="text-align:right;padding:6px 8px;">Avg score</th>
                      <th style="text-align:right;padding:6px 8px;">Overturn (range)</th>
                      <th style="text-align:right;padding:6px 8px;">Overturn (life)</th>
                      <th style="text-align:left;padding:6px 12px;">Last</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byReviewer.length === 0 && (
                      <tr><td colSpan={10} style="padding:16px;text-align:center;color:var(--text-dim);">No reviewer activity in this window.</td></tr>
                    )}
                    {data.byReviewer.map((r) => {
                      const qr = rangedByEmail.get(r.email);
                      const ql = lifeByEmail.get(r.email);
                      return (
                      <tr key={r.email} style="border-top:1px solid var(--border);font-variant-numeric:tabular-nums;">
                        <td style="padding:6px 12px;">
                          <a href={`/admin/reviewer-throughput?reviewer=${encodeURIComponent(r.email)}&${rangeQ}`} class="tbl-link" style="color:var(--blue);text-decoration:none;">{r.email}</a>
                        </td>
                        <td style="text-align:right;padding:6px 8px;font-weight:600;">{r.reviewed.toLocaleString()}</td>
                        <td style="text-align:right;padding:6px 8px;color:var(--cyan);">{r.handledAudits ? fmtMs(r.avgHandleMs) : "—"}</td>
                        <td style="text-align:right;padding:6px 8px;color:var(--text-dim);">{r.handledAudits ? fmtMs(r.medianHandleMs) : "—"}</td>
                        <td style="text-align:right;padding:6px 8px;color:var(--green);">{r.validQuestions ? fmtMs(r.avgPerQuestionMs) : "—"}</td>
                        <td style="text-align:right;padding:6px 8px;color:var(--yellow);">{r.handledAudits ? r.auditsPerActiveHour : "—"}</td>
                        <td style="text-align:right;padding:6px 8px;">{r.avgScore}%</td>
                        <td style="text-align:right;padding:6px 8px;" title={qr ? `${qr.overturns} of ${qr.judged} judged` : "no appeals judged"}>
                          {qr && qr.judged > 0 ? <span style={`color:${rateColor(qr.overturnRate)};`}>{qr.overturnRate}%</span> : <span style="color:var(--text-dim);">—</span>}
                        </td>
                        <td style="text-align:right;padding:6px 8px;" title={ql ? `${ql.overturns} of ${ql.judged} judged` : "no appeals judged"}>
                          {ql && ql.judged > 0 ? <span style={`color:${rateColor(ql.overturnRate)};`}>{ql.overturnRate}%</span> : <span style="color:var(--text-dim);">—</span>}
                        </td>
                        <td style="padding:6px 12px;color:var(--text-dim);">{fmtTime(r.lastReviewedAt)}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* By question */}
            <div style="border:1px solid var(--border);border-radius:8px;background:var(--bg);overflow:hidden;">
              <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid var(--border);">
                <div style="font-size:11px;font-weight:700;color:var(--text-bright);text-transform:uppercase;letter-spacing:0.5px;">By question{q ? ` · “${q}”` : ""} (slowest first)</div>
                <div style="font-size:11px;color:var(--text-dim);">{data.byQuestion.length} questions{data.capped ? ` · sampled first ${data.hydrated.toLocaleString()} of ${data.cohort.toLocaleString()} audits` : ""}</div>
              </div>
              <table style="width:100%;border-collapse:collapse;font-size:12px;">
                <thead>
                  <tr style="color:var(--text-dim);font-size:10px;text-transform:uppercase;letter-spacing:0.5px;">
                    <th style="text-align:left;padding:6px 12px;">Question</th>
                    <th style="text-align:right;padding:6px 8px;">Samples</th>
                    <th style="text-align:right;padding:6px 8px;">Avg time</th>
                    <th style="text-align:right;padding:6px 8px;">Median</th>
                    <th style="text-align:right;padding:6px 12px;">Discarded</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byQuestion.length === 0 && (
                    <tr><td colSpan={5} style="padding:16px;text-align:center;color:var(--text-dim);">No per-question timing yet for this window{q ? " / filter" : ""}.</td></tr>
                  )}
                  {data.byQuestion.map((qq) => (
                    <tr key={qq.header} style="border-top:1px solid var(--border);font-variant-numeric:tabular-nums;">
                      <td style="padding:6px 12px;color:var(--text-bright);">{qq.header}</td>
                      <td style="text-align:right;padding:6px 8px;">{qq.samples.toLocaleString()}</td>
                      <td style="text-align:right;padding:6px 8px;color:var(--cyan);">{fmtMs(qq.avgMs)}</td>
                      <td style="text-align:right;padding:6px 8px;color:var(--text-dim);">{fmtMs(qq.medianMs)}</td>
                      <td style="text-align:right;padding:6px 12px;color:var(--text-dim);">{qq.discardedCount || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </Layout>
  );
});
