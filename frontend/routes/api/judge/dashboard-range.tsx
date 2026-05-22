/** Judge dashboard's range-driven panel. Re-rendered whenever the operator
 *  picks a new range preset or custom dates from the StatRangeBar. Returns
 *  the My Appeal Decisions stat cards + the Reviewer Leaderboard in a
 *  single swap target so one click updates both. */

import { define } from "../../../lib/define.ts";
import { apiFetch } from "../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import { StatCard } from "../../../components/StatCard.tsx";
import { resolveRangeFromQuery } from "../../../components/StatRangeBar.tsx";

interface MyJudgeStats {
  range: { from: number; to: number };
  decided: number;
  overturned: number;
  upheld: number;
  overturnRate: number;
  lastInRangeAt: number | null;
  lastDecidedAt: number | null;
  stale?: boolean;
}

interface LeaderRow {
  email: string;
  reviewed: number;
  avgScore: number;
  lastReviewedAt: number | null;
}

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const { range, from, to, label } = resolveRangeFromQuery(url);
    const user = ctx.state.user;
    const email = user?.email ?? "";

    const qs = new URLSearchParams();
    if (from > 0 || range === "custom") qs.set("from", String(from));
    qs.set("to", String(to));

    let my: MyJudgeStats = {
      range: { from, to },
      decided: 0, overturned: 0, upheld: 0, overturnRate: 0,
      lastInRangeAt: null, lastDecidedAt: null,
    };
    let leaders: LeaderRow[] = [];
    if (email) {
      try {
        my = await apiFetch<MyJudgeStats>(
          `/judge/api/my-stats?email=${encodeURIComponent(email)}&${qs.toString()}`,
          ctx.req,
        );
      } catch (e) { console.error("[judge-dashboard-range] my-stats:", e); }
    }
    try {
      leaders = (await apiFetch<{ rows?: LeaderRow[] }>(
        `/judge/api/leaderboard?${qs.toString()}`,
        ctx.req,
      )).rows ?? [];
    } catch (e) { console.error("[judge-dashboard-range] leaderboard:", e); }

    const fmtDate = (ms: number | null) =>
      ms ? new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";
    const fmtTime = (ms: number | null) =>
      ms ? new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

    const html = renderToString(
      <div id="judge-dash-block" data-active-range={range}>
        <div class="panel" style="margin-top:18px;">
          <div class="panel-title" style="display:flex;align-items:center;gap:10px;">
            <span>My Appeal Decisions</span>
            <span style="color:var(--text-dim);font-size:11px;font-weight:400;">{label}</span>
          </div>
          <div class="stat-grid" style="margin-top:8px;">
            <StatCard label="Decided" value={my.decided} color="cyan" sub={my.decided ? `${my.overturnRate}% overturned` : "—"} />
            <StatCard label="Overturned" value={my.overturned} color="purple" />
            <StatCard label="Upheld" value={my.upheld} color="green" />
            <StatCard label="Last Decided" value={fmtDate(my.lastDecidedAt)} color="yellow" sub={my.lastDecidedAt ? new Date(my.lastDecidedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : ""} />
          </div>
        </div>

        <div class="panel" style="margin-top:18px;">
          <div class="panel-title" style="display:flex;align-items:center;justify-content:space-between;">
            <span>Reviewer Leaderboard <span style="color:var(--text-muted);font-weight:400;font-size:11px;">{label}</span></span>
            <span style="color:var(--text-muted);font-size:11px;">{leaders.length} reviewers</span>
          </div>
          {leaders.length === 0 ? (
            <div style="color:var(--text-muted);font-size:13px;padding:14px 0;">No reviewer activity in the selected range.</div>
          ) : (
            <table class="data-table" style="width:100%;font-size:12px;margin-top:8px;">
              <thead>
                <tr style="text-align:left;color:var(--text-dim);font-size:10px;text-transform:uppercase;letter-spacing:1px;">
                  <th style="padding:8px;">Reviewer</th>
                  <th style="padding:8px;width:90px;">Reviewed</th>
                  <th style="padding:8px;width:90px;">Avg Score</th>
                  <th style="padding:8px;width:140px;">Last Reviewed</th>
                </tr>
              </thead>
              <tbody>
                {leaders.slice(0, 25).map((r) => (
                  <tr key={r.email} style="border-top:1px solid var(--border);">
                    <td style="padding:8px;">{r.email}</td>
                    <td style="padding:8px;font-weight:600;">{r.reviewed.toLocaleString()}</td>
                    <td style="padding:8px;">{r.avgScore}%</td>
                    <td style="padding:8px;color:var(--text-dim);">{fmtTime(r.lastReviewedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>,
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
