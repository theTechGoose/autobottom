/** Review dashboard — stats, queue status, leaderboard placeholder. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { StatCard } from "../../components/StatCard.tsx";
import { DonutChart } from "../../components/DonutChart.tsx";
import { apiFetch } from "../../lib/api.ts";

interface ReviewerSettings { allowedTypes: ("date-leg" | "package")[] }

export default define.page(async function ReviewDashboard(ctx) {
  const user = ctx.state.user!;
  let stats = { pending: 0, decided: 0, pendingAuditCount: 0 };
  let settings: ReviewerSettings = { allowedTypes: ["date-leg", "package"] };
  try { stats = await apiFetch<typeof stats>("/review/api/dashboard", ctx.req); }
  catch (e) { console.error("Review dashboard error:", e); }
  try {
    const resp = await apiFetch<ReviewerSettings | { error: string }>(`/review/api/settings?email=${encodeURIComponent(user.email)}`, ctx.req);
    if (!("error" in resp)) settings = resp as ReviewerSettings;
  } catch (e) { console.error("Reviewer settings error:", e); }

  const total = stats.pending + stats.decided;
  const confirmRate = total > 0 ? Math.round((stats.decided / total) * 100) : 0;
  const allowDateLeg = settings.allowedTypes.includes("date-leg");
  const allowPackage = settings.allowedTypes.includes("package");

  return (
    <Layout title="Review Dashboard" section="review" user={user} pathname={new URL(ctx.req.url).pathname}>
      <div class="page-header"><h1>Review Dashboard</h1><p class="page-sub">Your review performance and queue status</p></div>

      <div id="review-stats" hx-get="/api/review/stats" hx-trigger="every 10s" hx-swap="innerHTML">
        <div class="stat-grid">
          <StatCard label="Queue Pending" value={stats.pending} color="purple" sub={`${stats.pendingAuditCount} audits`} />
          <StatCard label="Decided" value={stats.decided} color="green" />
          <StatCard label="Total Processed" value={total} color="blue" />
          <StatCard label="Decision Rate" value={`${confirmRate}%`} color={confirmRate >= 90 ? "green" : "yellow"} />
        </div>
      </div>

      <div class="charts">
        <div class="panel">
          <div class="panel-title">Leaderboard</div>
          <div class="tbl">
            <table class="data-table">
              <thead><tr><th>Reviewer</th><th>Decisions</th><th>Confirm Rate</th><th>Avg Speed</th></tr></thead>
              <tbody>
                <tr class="empty-row"><td colSpan={4}>Leaderboard data loads from reviewer activity tracking</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <DonutChart
          title="Queue Progress"
          segments={[
            { label: "Pending", value: stats.pending, color: "var(--yellow)" },
            { label: "Decided", value: stats.decided, color: "var(--green)" },
          ]}
        />
      </div>

      <div class="panels">
        <div class="panel">
          <div class="panel-title">Badges</div>
          <p style="color:var(--text-muted);font-size:13px;">Badge showcase — earned badges appear here as you review</p>
        </div>
        <div class="panel">
          <div class="panel-title">Queue Preferences</div>
          <p style="color:var(--text-muted);font-size:13px;margin-bottom:10px;">Filter by audit type — only items matching these types will appear in your queue.</p>
          <form
            hx-post="/api/review/settings"
            hx-target="#queue-pref-result"
            hx-swap="innerHTML"
            style="display:flex;flex-direction:column;gap:8px;"
          >
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
              <input type="checkbox" name="date-leg" value="1" checked={allowDateLeg} />
              <span>Date Leg (Internal)</span>
            </label>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
              <input type="checkbox" name="package" value="1" checked={allowPackage} />
              <span>Package (Partner)</span>
            </label>
            <div style="display:flex;align-items:center;gap:10px;">
              <button type="submit" class="btn btn-primary btn-sm">Save</button>
              <span id="queue-pref-result" style="font-size:11px;color:var(--text-muted);"></span>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  );
});
