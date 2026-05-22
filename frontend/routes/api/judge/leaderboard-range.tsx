/** Reviewer Leaderboard panel for the judge dashboard, scoped to its own
 *  range filter — independent from the judge's personal-stats range so
 *  the operator can ask "what did each reviewer do this week?" while
 *  keeping their own decision stats on a different window. */

import { define } from "../../../lib/define.ts";
import { apiFetch } from "../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import { resolveRangeFromQuery } from "../../../components/StatRangeBar.tsx";

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

    const qs = new URLSearchParams();
    if (from > 0 || range === "custom") qs.set("from", String(from));
    qs.set("to", String(to));

    let leaders: LeaderRow[] = [];
    try {
      leaders = (await apiFetch<{ rows?: LeaderRow[] }>(
        `/judge/api/leaderboard?${qs.toString()}`,
        ctx.req,
      )).rows ?? [];
    } catch (e) { console.error("[judge-leaderboard-range] leaderboard:", e); }

    const fmtTime = (ms: number | null) =>
      ms ? new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

    const html = renderToString(
      <div id="judge-leaderboard-block" data-active-range={range}>
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
