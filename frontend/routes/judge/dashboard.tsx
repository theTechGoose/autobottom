/** Judge dashboard — appeal stats, reviewer leaderboard, personal stats. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { StatCard } from "../../components/StatCard.tsx";
import { DonutChart } from "../../components/DonutChart.tsx";
import { LeaderboardCard, type LeaderboardEntry } from "../../components/LeaderboardCard.tsx";
import { apiFetch } from "../../lib/api.ts";

interface JudgeBucket { decided: number; overturned: number; upheld: number; overturnRate: number; lastDecidedAt: number | null }
interface MyJudgeStats {
  week: JudgeBucket; month: JudgeBucket; allTime: JudgeBucket; decisions: number; stale?: boolean;
}
interface LeaderRow { email: string; reviewed: number; avgScore: number; lastReviewedAt: number | null }

const EMPTY_J: JudgeBucket = { decided: 0, overturned: 0, upheld: 0, overturnRate: 0, lastDecidedAt: null };

export default define.page(async function JudgeDashboard(ctx) {
  const user = ctx.state.user!;
  let stats = { pending: 0, decided: 0 };
  let leaderboard: LeaderboardEntry[] = [];
  let leaderRows: LeaderRow[] = [];
  let my: MyJudgeStats = { week: EMPTY_J, month: EMPTY_J, allTime: EMPTY_J, decisions: 0 };
  try { stats = await apiFetch<typeof stats>("/judge/api/dashboard", ctx.req); }
  catch (e) { console.error("Judge dashboard error:", e); }
  try { leaderboard = (await apiFetch<{ entries?: LeaderboardEntry[] }>("/gamification/api/leaderboard", ctx.req)).entries ?? []; }
  catch (e) { console.error("Leaderboard error:", e); }
  try { leaderRows = (await apiFetch<{ rows?: LeaderRow[] }>("/judge/api/leaderboard", ctx.req)).rows ?? []; }
  catch (e) { console.error("Reviewer leaderboard error:", e); }
  try { my = await apiFetch<MyJudgeStats>(`/judge/api/my-stats?email=${encodeURIComponent(user.email)}`, ctx.req); }
  catch (e) { console.error("My judge stats error:", e); }

  return (
    <Layout title="Judge Dashboard" section="judge" user={user} pathname={new URL(ctx.req.url).pathname}>
      <div class="page-header"><h1>Judge Dashboard</h1><p class="page-sub">Appeal stats and judge performance</p></div>

      <div id="judge-stats" hx-get="/api/judge/stats" hx-trigger="every 10s" hx-swap="innerHTML">
        <div class="stat-grid">
          <StatCard label="Appeals Pending" value={stats.pending} color="purple" />
          <StatCard label="Decided" value={stats.decided} color="green" />
          <StatCard label="Total" value={stats.pending + stats.decided} color="blue" />
        </div>
      </div>

      <div class="panel" style="margin-top:18px;">
        <div class="panel-title">My Appeal Decisions</div>
        <div class="stat-grid" style="margin-top:8px;">
          <StatCard label="This Week" value={my.week.decided} color="cyan" sub={my.week.decided ? `${my.week.overturnRate}% overturned` : "—"} />
          <StatCard label="This Month" value={my.month.decided} color="blue" sub={my.month.decided ? `${my.month.overturnRate}% overturned` : "—"} />
          <StatCard label="All Time" value={my.allTime.decided} color="green" sub={my.allTime.decided ? `${my.allTime.overturnRate}% overturned` : "—"} />
          <StatCard label="Last Decided" value={my.allTime.lastDecidedAt ? new Date(my.allTime.lastDecidedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"} color="yellow" />
        </div>
      </div>

      <div class="panel" style="margin-top:18px;">
        <div class="panel-title" style="display:flex;align-items:center;justify-content:space-between;">
          <span>Reviewer Leaderboard <span style="color:var(--text-muted);font-weight:400;font-size:11px;">last 365d</span></span>
          <span style="color:var(--text-muted);font-size:11px;">{leaderRows.length} reviewers</span>
        </div>
        {leaderRows.length === 0 ? (
          <div style="color:var(--text-muted);font-size:13px;padding:14px 0;">No reviewer activity in the trailing year.</div>
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
              {leaderRows.slice(0, 25).map((r) => (
                <tr key={r.email} style="border-top:1px solid var(--border);">
                  <td style="padding:8px;">{r.email}</td>
                  <td style="padding:8px;font-weight:600;">{r.reviewed.toLocaleString()}</td>
                  <td style="padding:8px;">{r.avgScore}%</td>
                  <td style="padding:8px;color:var(--text-dim);">
                    {r.lastReviewedAt ? new Date(r.lastReviewedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div class="charts" style="margin-top:18px;">
        <LeaderboardCard entries={leaderboard} accent="#14b8a6" />
        <DonutChart
          title="Appeal Progress"
          segments={[
            { label: "Pending", value: stats.pending, color: "var(--yellow)" },
            { label: "Decided", value: stats.decided, color: "var(--green)" },
          ]}
        />
      </div>

      <div class="panel" style="margin-top:18px;">
        <div class="panel-title">Badges</div>
        <p style="color:var(--text-muted);font-size:13px;">Badge showcase — earned badges appear here as you judge appeals</p>
      </div>
    </Layout>
  );
});
