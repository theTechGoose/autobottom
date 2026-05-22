/** Judge's personal "My Appeal Decisions" panel for the current range.
 *  Independent from the reviewer-leaderboard fragment so the judge can
 *  scope their own stats and the leaderboard separately. */

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
    if (email) {
      try {
        my = await apiFetch<MyJudgeStats>(
          `/judge/api/my-stats?email=${encodeURIComponent(email)}&${qs.toString()}`,
          ctx.req,
        );
      } catch (e) { console.error("[judge-dashboard-range] my-stats:", e); }
    }

    const fmtDate = (ms: number | null) =>
      ms ? new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";

    const html = renderToString(
      <div id="judge-my-stats-block" data-active-range={range}>
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
      </div>,
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
