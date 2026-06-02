/** Email Engagement — full-page drill-down. Popped out from the Reports modal's
 *  "Open full report ↗" link (or navigated directly). Shows the headline
 *  open/click cards + per-department and per-type (Internal/Partner) breakdowns
 *  + a paginated per-email table.
 *
 *  Plain SSR + native GET navigation (no island, no inline JS): range presets
 *  and pagination are <a> links / a GET form, so it sidesteps the
 *  HTMX-injected-island hydration gotcha and just re-renders on each navigation.
 *
 *  Routing note: this path is registered in FRONTEND_EXACT_PAGES in the root
 *  main.ts — without it, browser navigation to an /admin/* page falls through to
 *  the danet backend (which has no such route) and 404s. */

import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { apiFetch } from "../../lib/api.ts";
import { ENG_PRESETS, resolveRange } from "../../lib/report-range.ts";
import { MiniStat, RateCard } from "../../components/EngagementCards.tsx";

interface Agg {
  total: number; sent: number; opened: number; clicked: number; appealed: number;
  appealedAmongOpened: number; appealedAmongClicked: number;
  openRate: number; clickRate: number; appealRateAll: number; appealRateOpened: number; appealRateClicked: number;
}
type GroupTally = { key: string } & Agg;
interface Row {
  findingId: string; completedAt: number; voName?: string; department?: string;
  isPackage?: boolean; recordingId?: string; recordId?: string; score: number;
  sentAt?: number; openedAt?: number; openPrefetchAt?: number; firstClickAt?: number;
  appealStatus?: "pending" | "complete" | null;
}
interface DetailResp {
  aggregate: Agg; byDepartment: GroupTally[]; byType: GroupTally[];
  rows: Row[]; total: number; page: number; pages: number;
  cohortSize: number; hydrationCapped: boolean;
}

const PAGE_LIMIT = 100;

function fmt(ts?: number): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-US", {
    timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function BreakdownTable({ title, groups }: { title: string; groups: GroupTally[] }) {
  return (
    <div style="border:1px solid var(--border);border-radius:8px;background:var(--bg);overflow:hidden;">
      <div style="font-size:11px;font-weight:700;color:var(--text-bright);padding:10px 12px;border-bottom:1px solid var(--border);text-transform:uppercase;letter-spacing:0.5px;">{title}</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead>
          <tr style="color:var(--text-dim);font-size:10px;text-transform:uppercase;letter-spacing:0.5px;">
            <th style="text-align:left;padding:6px 12px;font-weight:600;">Segment</th>
            <th style="text-align:right;padding:6px 8px;font-weight:600;">Sent</th>
            <th style="text-align:right;padding:6px 8px;font-weight:600;">Opened</th>
            <th style="text-align:right;padding:6px 8px;font-weight:600;">Open %</th>
            <th style="text-align:right;padding:6px 8px;font-weight:600;">Clicked</th>
            <th style="text-align:right;padding:6px 8px;font-weight:600;">Click %</th>
            <th style="text-align:right;padding:6px 12px;font-weight:600;">Appeals</th>
          </tr>
        </thead>
        <tbody>
          {groups.length === 0 && (
            <tr><td colSpan={7} style="padding:12px;text-align:center;color:var(--text-dim);">No data in window</td></tr>
          )}
          {groups.map((g) => (
            <tr key={g.key} style="border-top:1px solid var(--border);font-variant-numeric:tabular-nums;">
              <td style="padding:6px 12px;color:var(--text-bright);">{g.key}</td>
              <td style="text-align:right;padding:6px 8px;">{g.sent.toLocaleString()}</td>
              <td style="text-align:right;padding:6px 8px;color:var(--cyan);">{g.opened.toLocaleString()}</td>
              <td style="text-align:right;padding:6px 8px;color:var(--cyan);">{g.openRate}%</td>
              <td style="text-align:right;padding:6px 8px;color:var(--green);">{g.clicked.toLocaleString()}</td>
              <td style="text-align:right;padding:6px 8px;color:var(--green);">{g.clickRate}%</td>
              <td style="text-align:right;padding:6px 12px;color:var(--yellow);">{g.appealed.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default define.page(async function EmailEngagementPage(ctx) {
  const url = new URL(ctx.req.url);
  const sp = url.searchParams;

  // Resolve the active range. Priority: explicit preset → explicit since/until
  // (carried from the modal "Open full report" link) → default "today".
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
    label = `${fmt(since)} → ${fmt(until)}`;
    activePreset = "";
  } else {
    ({ since, until, label } = resolveRange("today", "", ""));
    activePreset = "today";
  }

  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);

  let data: DetailResp | null = null;
  let error = "";
  try {
    data = await apiFetch<DetailResp>(
      `/admin/email-engagement/detail?since=${since}&until=${until}&page=${page}&limit=${PAGE_LIMIT}`,
      ctx.req,
    );
  } catch (e) {
    error = String((e as Error).message ?? e);
  }

  const a = data?.aggregate;
  // Base query for pagination — stable since/until so it survives preset/custom.
  const rangeQ = `since=${since}&until=${until}`;

  return (
    <Layout title="Email Engagement" section="admin" user={ctx.state.user!} pathname={url.pathname} hideSidebar>
      <div class="ql-topbar">
        <div class="ql-topbar-title">
          <span class="ql-topbar-icon" aria-hidden="true">📧</span>
          <h1>Email Engagement</h1>
        </div>
        <a href="/admin/dashboard" class="ql-topbar-back">← Dashboard</a>
      </div>

      <div class="ql-page-body">
        {/* Range selector — preset links + custom-date GET form */}
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:14px;padding:10px 12px;background:var(--bg-raised);border:1px solid var(--border);border-radius:8px;">
          <span style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-right:4px;">Range</span>
          {ENG_PRESETS.map((p) => (
            <a
              key={p.key}
              href={`/admin/email-engagement?preset=${p.key}`}
              class={`sf-btn ${p.key === activePreset ? "primary" : "ghost"}`}
              style="font-size:11px;padding:4px 12px;text-decoration:none;"
            >{p.label}</a>
          ))}
          <span style="margin:0 6px;color:var(--text-dim);">|</span>
          <form method="GET" action="/admin/email-engagement" style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:11px;color:var(--text-dim);">Custom:</span>
            <input type="date" name="custom-from" value={customFrom} class="sf-input" style="font-size:11px;padding:2px 6px;width:140px;" />
            <span style="color:var(--text-dim);font-size:11px;">→</span>
            <input type="date" name="custom-to" value={customTo} class="sf-input" style="font-size:11px;padding:2px 6px;width:140px;" />
            <button type="submit" name="preset" value="custom" class="sf-btn primary" style="font-size:11px;padding:4px 12px;">Apply</button>
          </form>
        </div>

        {error && (
          <div class="error-text" style="font-size:12px;padding:12px;border:1px solid var(--red);border-radius:8px;">
            Failed to load engagement data: {error}
          </div>
        )}

        {a && data && (
          <>
            <div style="font-size:13px;font-weight:700;color:var(--text-bright);margin-bottom:12px;">
              {label} · {a.total.toLocaleString()} audits
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
              <RateCard title="Open rate (opened ÷ sent)" rate={a.openRate} accent="var(--cyan)"
                appealLabel="Appeals ÷ opened:" appealRate={a.appealRateOpened} />
              <RateCard title="Click rate (clicked ÷ sent)" rate={a.clickRate} accent="var(--green)"
                appealLabel="Appeals ÷ clicked:" appealRate={a.appealRateClicked} />
            </div>

            <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:18px;">
              <MiniStat label="Sent" value={a.sent} />
              <MiniStat label="Opened" value={a.opened} color="var(--cyan)" />
              <MiniStat label="Clicked" value={a.clicked} color="var(--green)" />
              <MiniStat label="Appealed" value={a.appealed} color="var(--yellow)" />
              <MiniStat label="Appeals ÷ all" value={a.appealRateAll} color="var(--text-bright)" />
            </div>

            {data.hydrationCapped && (
              <div style="font-size:11px;color:var(--yellow);background:var(--yellow-bg);border:1px solid var(--border);border-radius:6px;padding:8px 12px;margin-bottom:10px;">
                ⚠️ Large window ({data.cohortSize.toLocaleString()} audits) — the department breakdown only fully
                resolves the first {(2000).toLocaleString()} audits; narrow the range for complete per-department accuracy.
              </div>
            )}
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px;">
              <BreakdownTable title="By department / office" groups={data.byDepartment} />
              <BreakdownTable title="By audit type" groups={data.byType} />
            </div>

            {/* Per-email table */}
            <div style="border:1px solid var(--border);border-radius:8px;background:var(--bg);overflow:hidden;">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-bottom:1px solid var(--border);">
                <div style="font-size:11px;font-weight:700;color:var(--text-bright);text-transform:uppercase;letter-spacing:0.5px;">
                  Per-email detail
                </div>
                <div style="font-size:11px;color:var(--text-dim);">
                  {data.total.toLocaleString()} audits · page {data.page} / {data.pages}
                </div>
              </div>
              <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:12px;">
                  <thead>
                    <tr style="color:var(--text-dim);font-size:10px;text-transform:uppercase;letter-spacing:0.5px;">
                      <th style="text-align:left;padding:6px 12px;font-weight:600;">Finding</th>
                      <th style="text-align:left;padding:6px 8px;font-weight:600;">Team Member</th>
                      <th style="text-align:left;padding:6px 8px;font-weight:600;">Department</th>
                      <th style="text-align:left;padding:6px 8px;font-weight:600;">Type</th>
                      <th style="text-align:right;padding:6px 8px;font-weight:600;">Score</th>
                      <th style="text-align:left;padding:6px 8px;font-weight:600;">Sent</th>
                      <th style="text-align:left;padding:6px 8px;font-weight:600;">Opened</th>
                      <th style="text-align:left;padding:6px 8px;font-weight:600;">Clicked</th>
                      <th style="text-align:left;padding:6px 12px;font-weight:600;">Appeal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.length === 0 && (
                      <tr><td colSpan={9} style="padding:16px;text-align:center;color:var(--text-dim);">No audits in this window.</td></tr>
                    )}
                    {data.rows.map((r) => {
                      const openCell = r.openedAt
                        ? fmt(r.openedAt)
                        : (r.openPrefetchAt ? "prefetch" : "—");
                      const openColor = r.openedAt ? "var(--cyan)" : "var(--text-dim)";
                      return (
                        <tr key={r.findingId} style="border-top:1px solid var(--border);font-variant-numeric:tabular-nums;">
                          <td style="padding:6px 12px;">
                            <a href={`/audit/report?id=${encodeURIComponent(r.findingId)}`} target="_blank" rel="noopener" class="tbl-link" style="color:var(--blue);text-decoration:none;">
                              {r.recordingId || r.recordId || r.findingId.slice(0, 8)}
                            </a>
                          </td>
                          <td style="padding:6px 8px;color:var(--text);">{r.voName || "—"}</td>
                          <td style="padding:6px 8px;color:var(--text-dim);">{r.department || "—"}</td>
                          <td style="padding:6px 8px;">
                            <span class={`pill pill-${r.isPackage ? "purple" : "blue"}`} style="font-size:9px;padding:1px 6px;">
                              {r.isPackage ? "Partner" : "Internal"}
                            </span>
                          </td>
                          <td style="text-align:right;padding:6px 8px;color:var(--text);">{r.score != null ? `${r.score}%` : "—"}</td>
                          <td style="padding:6px 8px;color:var(--text-dim);">{fmt(r.sentAt)}</td>
                          <td style={`padding:6px 8px;color:${openColor};`}>{openCell}</td>
                          <td style={`padding:6px 8px;color:${r.firstClickAt ? "var(--green)" : "var(--text-dim)"};`}>{fmt(r.firstClickAt)}</td>
                          <td style="padding:6px 12px;">
                            {r.appealStatus
                              ? <span class={`pill pill-${r.appealStatus === "complete" ? "green" : "yellow"}`} style="font-size:9px;padding:1px 6px;">{r.appealStatus}</span>
                              : <span style="color:var(--text-dim);">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {data.pages > 1 && (
                <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-top:1px solid var(--border);">
                  {data.page > 1
                    ? <a href={`/admin/email-engagement?${rangeQ}&page=${data.page - 1}`} class="sf-btn ghost" style="font-size:11px;padding:4px 12px;text-decoration:none;">← Prev</a>
                    : <span></span>}
                  <span style="font-size:11px;color:var(--text-dim);">Page {data.page} of {data.pages}</span>
                  {data.page < data.pages
                    ? <a href={`/admin/email-engagement?${rangeQ}&page=${data.page + 1}`} class="sf-btn ghost" style="font-size:11px;padding:4px 12px;text-decoration:none;">Next →</a>
                    : <span></span>}
                </div>
              )}
            </div>

            <div style="font-size:10px;color:var(--text-dim);line-height:1.5;margin-top:12px;">
              Opens: Apple-Mail prefetch (&lt;10s) is filtered out and Gmail opens are deduped/geo-masked per recipient —
              a fuzzy-but-broad signal. Clicks: exact human engagement (scanner double-clicks absorbed by binary-per-finding) —
              clean-but-narrower. Engagement is recorded per finding; only audits whose email was actually sent count toward "sent".
              Breakdowns + rates cover the full window; only the per-email table is paginated.
            </div>
          </>
        )}
      </div>
    </Layout>
  );
});
