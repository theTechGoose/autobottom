import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";

interface Audit {
  findingId: string;
  recordId: string;
  recordingId: string;
  totalQuestions: number;
  passedCount: number;
  failedCount: number;
  completedAt?: string;
  jobTimestamp?: string;
}

interface WeeklyTrend {
  weekStart: string;
  avgScore: number;
  audits: number;
}

interface DashboardData {
  totalAudits: number;
  avgScore: number;
  recentAudits: Audit[];
  weeklyTrend: WeeklyTrend[];
}

interface GameState {
  level: number;
  totalXp: number;
  tokenBalance: number;
  badges: string[];
}

const AGT_BADGES = [
  { id: "agt_first_audit", name: "Rookie", tier: "common", description: "Complete your first audit" },
  { id: "agt_fifty", name: "Seasoned Agent", tier: "uncommon", description: "Complete 50 audits" },
  { id: "agt_hundred", name: "Road Warrior", tier: "rare", description: "Complete 100 audits" },
  { id: "agt_perfect_10", name: "Perfect Ten", tier: "rare", description: "Score 100% on 10 audits" },
  { id: "agt_honor_roll", name: "Honor Roll", tier: "uncommon", description: "90%+ avg score (20+ audits)" },
  { id: "agt_comeback", name: "Comeback Kid", tier: "uncommon", description: "Weekly avg improves 15+ pts" },
  { id: "agt_consistent", name: "Consistent Performer", tier: "rare", description: "5 weeks above 80%" },
];

const TIER_COLORS: Record<string, string> = {
  common: "#6b7280", uncommon: "#22c55e", rare: "#3b82f6", epic: "#a855f7", legendary: "#f59e0b",
};

const AGENT_LEVELS = [0, 50, 150, 350, 700, 1200, 2000, 3000, 4500, 7000];

function scoreColor(pct: number): string {
  if (pct >= 80) return "green";
  if (pct >= 60) return "yellow";
  return "red";
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return "--";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatWeekLabel(dateStr?: string): string {
  if (!dateStr) return "--";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return (d.getMonth() + 1) + "/" + d.getDate();
}

function getThisWeekCount(audits: Audit[]): number {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  weekStart.setHours(0, 0, 0, 0);
  return audits.filter((a) => new Date(a.completedAt || a.jobTimestamp || 0) >= weekStart).length;
}

export default function AgentDashboard() {
  const activeTab = useSignal<"dashboard" | "badges">("dashboard");
  const data = useSignal<DashboardData | null>(null);
  const gameState = useSignal<GameState | null>(null);
  const loading = useSignal(true);
  const error = useSignal("");
  const userEmail = useSignal("--");

  async function loadDashboard() {
    try {
      const [meRes, dataRes] = await Promise.all([
        fetch("/agent/api/me", { credentials: "same-origin" }),
        fetch("/agent/api/dashboard", { credentials: "same-origin" }),
      ]);

      if (!meRes.ok) {
        window.location.href = "/login";
        return;
      }

      const me = await meRes.json();
      userEmail.value = me.username || me.email || "--";

      const navAvatar = document.getElementById("nav-avatar");
      const navUsername = document.getElementById("nav-username");
      if (navAvatar) navAvatar.textContent = (userEmail.value[0] || "A").toUpperCase();
      if (navUsername) navUsername.textContent = userEmail.value;

      if (!dataRes.ok) throw new Error("Failed to load dashboard data");
      data.value = await dataRes.json();
    } catch (err) {
      error.value = "Failed to load dashboard: " + ((err as Error).message || "Unknown error");
    } finally {
      loading.value = false;
    }
  }

  async function loadGameState() {
    try {
      const res = await fetch("/agent/api/game-state", { credentials: "same-origin" });
      if (!res.ok) return;
      gameState.value = await res.json();
    } catch { /* non-critical */ }
  }

  useEffect(() => {
    loadDashboard();
    loadGameState();
  }, []);

  const xpProgress = (() => {
    const gs = gameState.value;
    if (!gs) return 0;
    const cur = AGENT_LEVELS[gs.level] || 0;
    const next = AGENT_LEVELS[gs.level + 1] || AGENT_LEVELS[AGENT_LEVELS.length - 1];
    return next > cur ? Math.min(100, ((gs.totalXp - cur) / (next - cur)) * 100) : 100;
  })();

  return (
    <div>
      <style>{`
        .main-tabs { display: flex; gap: 4px; margin-bottom: 20px; }
        .main-tab { padding: 6px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; color: var(--text-muted); cursor: pointer; border: none; background: none; transition: all 0.15s; }
        .main-tab:hover { color: var(--text); background: var(--bg-raised); }
        .main-tab.active { color: var(--text-bright); background: var(--accent-bg); }
        .stat-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 24px; }
        .stat-card { background: var(--bg-raised); border: 1px solid var(--border); border-radius: 10px; padding: 16px 18px; }
        .stat-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--text-dim); margin-bottom: 6px; }
        .stat-value { font-size: 28px; font-weight: 700; color: var(--text-bright); font-variant-numeric: tabular-nums; }
        .stat-value.accent { color: var(--accent); }
        .stat-value.green { color: var(--green); }
        .stat-value.red { color: var(--red); }
        .stat-value.yellow { color: var(--yellow); }
        .stat-sub { font-size: 11px; color: var(--text-dim); margin-top: 2px; }
        .section { margin-bottom: 28px; }
        .section-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
        .section-title { font-size: 13px; font-weight: 700; color: var(--text-bright); text-transform: uppercase; letter-spacing: 0.8px; }
        .section-badge { font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 10px; background: var(--accent-bg); color: var(--accent); }
        .trend-chart { display: flex; align-items: flex-end; gap: 8px; height: 140px; padding: 16px 18px 12px; background: var(--bg-raised); border: 1px solid var(--border); border-radius: 10px; margin-bottom: 24px; }
        .trend-bar-group { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%; }
        .trend-bar-wrap { flex: 1; width: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; }
        .trend-bar { width: 100%; max-width: 48px; border-radius: 4px 4px 0 0; min-height: 2px; }
        .trend-bar-value { font-size: 9px; font-weight: 700; color: var(--text-muted); text-align: center; margin-bottom: 2px; font-family: var(--mono); }
        .trend-bar-label { font-size: 9px; color: var(--text-dim); text-align: center; margin-top: 6px; font-family: var(--mono); }
        .trend-bar-audits { font-size: 8px; color: var(--text-dim); text-align: center; margin-top: 1px; }
        .trend-empty { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-dim); font-size: 12px; font-style: italic; width: 100%; }
        .tbl-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 10px; background: var(--bg-raised); }
        .tbl { width: 100%; border-collapse: collapse; }
        .tbl th { text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--text-dim); padding: 10px 12px; border-bottom: 1px solid var(--border); background: var(--bg-raised); }
        .tbl td { font-size: 13px; padding: 10px 12px; border-bottom: 1px solid var(--border); color: var(--text); font-variant-numeric: tabular-nums; }
        .tbl tbody tr:hover td { background: var(--bg-surface); }
        .tbl .mono { font-family: var(--mono); font-size: 11px; }
        .tbl .num { text-align: right; }
        .pill { display: inline-block; font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 10px; }
        .pill-green { background: var(--green-bg); color: var(--green); }
        .pill-red { background: var(--red-bg); color: var(--red); }
        .pill-yellow { background: var(--yellow-bg); color: var(--yellow); }
        .score-pill { display: inline-block; font-size: 12px; font-weight: 700; padding: 2px 10px; border-radius: 10px; font-family: var(--mono); }
        .action-link { font-size: 11px; font-weight: 600; color: var(--accent); text-decoration: none; padding: 4px 10px; border: 1px solid var(--accent); border-radius: 6px; white-space: nowrap; }
        .action-link:hover { background: var(--accent-bg); }
        .loading-wrap { display: flex; align-items: center; justify-content: center; padding: 60px; color: var(--text-dim); font-size: 13px; }
        .error-msg { padding: 12px 16px; background: var(--red-bg); color: var(--red); border-radius: 8px; font-size: 13px; margin-bottom: 16px; }
        .empty-row td { color: var(--text-dim); font-style: italic; text-align: center; padding: 20px; }
        .badge-showcase { display: flex; flex-wrap: wrap; gap: 10px; }
        .badge-item { display: flex; align-items: center; gap: 8px; padding: 8px 14px; background: var(--bg); border: 1px solid var(--border); border-radius: 10px; font-size: 12px; }
        .badge-item .bi-name { font-weight: 600; color: var(--text-bright); }
        .badge-item .bi-tier { font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; margin-left: 4px; }
        .badge-item.locked { opacity: 0.35; }
        .game-bar { display: flex; align-items: center; gap: 8px; padding: 8px 14px; background: var(--bg-raised); border: 1px solid var(--border); border-radius: 10px; margin-bottom: 16px; }
        @media (max-width: 900px) { .stat-row { grid-template-columns: 1fr; } .trend-chart { height: 120px; } }
      `}</style>

      {loading.value ? (
        <div class="loading-wrap">Loading dashboard data...</div>
      ) : (
        <>
          {error.value && <div class="error-msg">{error.value}</div>}

          {gameState.value && (
            <div class="game-bar">
              <span style="font-size:11px;font-weight:800;color:var(--accent);background:var(--accent-bg);padding:3px 8px;border-radius:6px;">
                Lv.{gameState.value.level}
              </span>
              <div style="flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden;max-width:100px;">
                <div style={{ width: `${xpProgress}%`, height: "100%", background: "linear-gradient(90deg,var(--accent-dim),var(--accent))", borderRadius: "3px", transition: "width 0.4s ease" }} />
              </div>
              <span style="font-size:11px;font-weight:700;color:var(--yellow);">
                {gameState.value.tokenBalance || 0} tokens
              </span>
            </div>
          )}

          <div class="main-tabs">
            <button
              class={`main-tab${activeTab.value === "dashboard" ? " active" : ""}`}
              onClick={() => { activeTab.value = "dashboard"; }}
            >
              Dashboard
            </button>
            <button
              class={`main-tab${activeTab.value === "badges" ? " active" : ""}`}
              onClick={() => { activeTab.value = "badges"; }}
            >
              Badges
            </button>
          </div>

          {activeTab.value === "dashboard" && data.value && (
            <div>
              <div class="stat-row">
                <div class="stat-card">
                  <div class="stat-label">Total Audits</div>
                  <div class="stat-value accent">{data.value.totalAudits || 0}</div>
                  <div class="stat-sub">all time</div>
                </div>
                <div class="stat-card">
                  <div class="stat-label">Average Score</div>
                  <div class={`stat-value ${scoreColor(Math.round(data.value.avgScore || 0))}`}>
                    {Math.round(data.value.avgScore || 0)}%
                  </div>
                  <div class="stat-sub">across all audits</div>
                </div>
                <div class="stat-card">
                  <div class="stat-label">This Week</div>
                  <div class="stat-value accent">{getThisWeekCount(data.value.recentAudits || [])}</div>
                  <div class="stat-sub">audits completed</div>
                </div>
              </div>

              <div class="section">
                <div class="section-head">
                  <span class="section-title">Weekly Trend</span>
                  <span class="section-badge">Last 8 Weeks</span>
                </div>
                <div class="trend-chart">
                  {!data.value.weeklyTrend || data.value.weeklyTrend.length === 0 ? (
                    <div class="trend-empty">No trend data available</div>
                  ) : (
                    data.value.weeklyTrend.map((w, i) => {
                      const pct = Math.round(w.avgScore || 0);
                      const barHeight = Math.max(2, (pct / 100) * 100);
                      const color = scoreColor(pct);
                      const cssColor = color === "green" ? "var(--green)" : color === "yellow" ? "var(--yellow)" : "var(--red)";
                      return (
                        <div class="trend-bar-group" key={i}>
                          <div class="trend-bar-value">{pct}%</div>
                          <div class="trend-bar-wrap">
                            <div
                              class="trend-bar"
                              style={{ height: barHeight + "%", background: cssColor }}
                              title={`${formatWeekLabel(w.weekStart)}: ${pct}% (${w.audits} audits)`}
                            />
                          </div>
                          <div class="trend-bar-label">{formatWeekLabel(w.weekStart)}</div>
                          <div class="trend-bar-audits">{w.audits} audit{w.audits !== 1 ? "s" : ""}</div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div class="section">
                <div class="section-head">
                  <span class="section-title">Audit Reports</span>
                  <span class="section-badge">{(data.value.recentAudits || []).length}</span>
                </div>
                <div class="tbl-wrap">
                  <table class="tbl">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Record ID</th>
                        <th>Recording ID</th>
                        <th class="num">Questions</th>
                        <th class="num">Passed</th>
                        <th class="num">Failed</th>
                        <th class="num">Score</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(!data.value.recentAudits || data.value.recentAudits.length === 0) ? (
                        <tr class="empty-row"><td colSpan={8}>No audit reports yet</td></tr>
                      ) : (
                        data.value.recentAudits.map((a, i) => {
                          const total = a.totalQuestions || 0;
                          const passed = a.passedCount || 0;
                          const failed = a.failedCount || 0;
                          const scorePct = total > 0 ? Math.round((passed / total) * 100) : 0;
                          const sColor = scoreColor(scorePct);
                          const reportUrl = "/audit/report?id=" + encodeURIComponent(a.findingId);
                          return (
                            <tr key={i}>
                              <td>{formatDate(a.completedAt || a.jobTimestamp)}</td>
                              <td class="mono">{a.recordId || "--"}</td>
                              <td class="mono">{a.recordingId || "--"}</td>
                              <td class="num">{total}</td>
                              <td class="num"><span class="pill pill-green">{passed}</span></td>
                              <td class="num"><span class="pill pill-red">{failed}</span></td>
                              <td class="num">
                                <span class={`score-pill pill-${sColor}`}>{scorePct}%</span>
                              </td>
                              <td>
                                <a class="action-link" href={reportUrl}>View Report</a>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab.value === "badges" && (
            <div class="section">
              <div class="section-head">
                <span class="section-title">Your Badges</span>
                <span class="section-badge">
                  {gameState.value ? AGT_BADGES.filter((b) => (gameState.value?.badges || []).includes(b.id)).length : 0} / {AGT_BADGES.length}
                </span>
              </div>
              <div class="badge-showcase">
                {AGT_BADGES.map((b) => {
                  const isEarned = (gameState.value?.badges || []).includes(b.id);
                  const tierColor = TIER_COLORS[b.tier] || "#6e7681";
                  return (
                    <div
                      class={`badge-item${isEarned ? "" : " locked"}`}
                      key={b.id}
                      title={b.description}
                      style={isEarned ? { borderColor: tierColor } : undefined}
                    >
                      <span class="bi-name">{b.name}</span>
                      <span class="bi-tier" style={{ color: tierColor }}>{b.tier}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
