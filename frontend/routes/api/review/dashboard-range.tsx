/** Reviewer dashboard's range-driven panel. Re-rendered whenever the
 *  operator picks a new range preset or custom dates. Returns the My Stats
 *  cards + streak badge for the chosen range; "Last Reviewed" stays
 *  absolute (always today-relative). */

import { define } from "../../../lib/define.ts";
import { apiFetch } from "../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import { StatCard } from "../../../components/StatCard.tsx";
import { resolveRangeFromQuery } from "../../../components/StatRangeBar.tsx";

interface MyReviewerStats {
  range: { from: number; to: number };
  reviewed: number;
  avgScore: number;
  daysActive: number;
  lastInRangeAt: number | null;
  currentStreak: number;
  longestStreak: number;
  lastReviewedAt: number | null;
  stale?: boolean;
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

    let my: MyReviewerStats = {
      range: { from, to },
      reviewed: 0, avgScore: 0, daysActive: 0, lastInRangeAt: null,
      currentStreak: 0, longestStreak: 0, lastReviewedAt: null,
    };
    if (email) {
      try {
        my = await apiFetch<MyReviewerStats>(
          `/review/api/my-stats?email=${encodeURIComponent(email)}&${qs.toString()}`,
          ctx.req,
        );
      } catch (e) { console.error("[review-dashboard-range] my-stats:", e); }
    }

    const fmtDate = (ms: number | null) =>
      ms ? new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";

    const html = renderToString(
      <div id="review-dash-block" data-active-range={range}>
        <div class="panel" style="margin-top:18px;">
          <div class="panel-title" style="display:flex;align-items:center;gap:12px;">
            <span>My Stats <span style="color:var(--text-dim);font-weight:400;font-size:11px;">{label}</span></span>
            <span class="pill" style="background:#8b5cf6;color:#fff;font-size:11px;">🔥 {my.currentStreak}-day streak</span>
            <span style="color:var(--text-muted);font-size:11px;font-weight:400;">longest {my.longestStreak}</span>
          </div>
          <div class="stat-grid" style="margin-top:10px;">
            <StatCard label="Reviewed" value={my.reviewed} color="purple" sub={my.reviewed ? `avg ${my.avgScore}%` : "—"} />
            <StatCard label="Days Active" value={my.daysActive} color="blue" />
            <StatCard label="Avg Score" value={my.reviewed ? `${my.avgScore}%` : "—"} color="green" />
            <StatCard label="Last Reviewed" value={fmtDate(my.lastReviewedAt)} color="yellow" sub={my.lastReviewedAt ? new Date(my.lastReviewedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : ""} />
          </div>
        </div>
      </div>,
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
