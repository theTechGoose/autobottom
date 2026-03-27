/**
 * ReviewDashboard island — reviewer performance stats, leaderboard, recent
 * decisions, and badge showcase.
 *
 * Fetches from /review/api/me and /review/api/dashboard. Auto-refreshes every 15s.
 */
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";

interface QueueStats { pending: number; decided: number; }
interface PersonalStats {
  totalDecisions: number;
  confirmCount: number;
  flipCount: number;
  avgDecisionSpeedMs: number;
}
interface ReviewerRow { reviewer: string; decisions: number; confirms: number; flips: number; flipRate: string; }
interface DecisionRow { decidedAt: number; findingId: string; questionIndex?: number; decision: string; header?: string; }
interface DashboardData {
  queue: QueueStats;
  personal: PersonalStats;
  byReviewer: ReviewerRow[];
  recentDecisions: DecisionRow[];
}

const REV_BADGES = [
  { id: "rev_first_blood", name: "First Blood", tier: "common", icon: "\u{1F514}", description: "Complete your first review" },
  { id: "rev_centurion", name: "Centurion", tier: "uncommon", icon: "\u{1F396}", description: "Complete 100 reviews" },
  { id: "rev_grinder", name: "The Grinder", tier: "rare", icon: "\u{2699}", description: "Complete 1,000 reviews" },
  { id: "rev_speed_demon", name: "Speed Demon", tier: "uncommon", icon: "\u{26A1}", description: "Average under 8s per decision (50+)" },
  { id: "rev_streak_7", name: "Week Warrior", tier: "uncommon", icon: "\u{1F525}", description: "7-day decision streak" },
  { id: "rev_streak_30", name: "Iron Will", tier: "rare", icon: "\u{1F9CA}", description: "30-day decision streak" },
  { id: "rev_combo_10", name: "Combo Breaker", tier: "uncommon", icon: "\u{1F4A5}", description: "Reach a 10x combo" },
  { id: "rev_combo_20", name: "Unstoppable", tier: "rare", icon: "\u{1F680}", description: "Reach a 20x combo" },
  { id: "rev_combo_50", name: "Beyond Godlike", tier: "epic", icon: "\u{1F30C}", description: "Reach a 50x combo" },
  { id: "rev_level_10", name: "Max Level", tier: "legendary", icon: "\u{1F48E}", description: "Reach level 10" },
];
const TIER_COLORS: Record<string, string> = {
  common: "#6b7280", uncommon: "#22c55e", rare: "#3b82f6", epic: "#a855f7", legendary: "#f59e0b",
};

function formatDate(ts: number): string {
  if (!ts) return "--";
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " +
    d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return "--";
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  return `${Math.round(ms / 3600000 * 10) / 10}h`;
}

export default function ReviewDashboard() {
  const loading = useSignal(true);
  const error = useSignal("");
  const currentUser = useSignal("");
  const data = useSignal<DashboardData | null>(null);
  const earnedBadges = useSignal<string[]>([]);

  async function load() {
    try {
      const meRes = await fetch("/review/api/me");
      if (!meRes.ok) throw new Error("Not authenticated");
      const me = await meRes.json();
      currentUser.value = me.username || "";

      // Update sidebar user display
      const emailEl = document.getElementById("user-email");
      const avatarEl = document.getElementById("user-avatar");
      if (emailEl) emailEl.textContent = me.username || "";
      if (avatarEl) avatarEl.textContent = (me.username || "?")[0].toUpperCase();

      const dataRes = await fetch("/review/api/dashboard");
      if (!dataRes.ok) throw new Error(`HTTP ${dataRes.status}`);
      data.value = await dataRes.json();
      loading.value = false;
    } catch (err: unknown) {
      loading.value = false;
      const msg = (err as Error).message;
      error.value = `Failed to load dashboard: ${msg}`;
      if (msg === "Not authenticated") window.location.href = "/login";
    }
  }

  async function loadBadges() {
    try {
      const res = await fetch("/api/badges");
      if (!res.ok) return;
      const d = await res.json();
      earnedBadges.value = d.earned || [];
    } catch { /* ignore */ }
  }

  useEffect(() => {
    load();
    loadBadges();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, []);

  if (loading.value) {
    return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "60px", color: "var(--text-dim)", fontSize: "13px" }}>Loading dashboard data...</div>;
  }

  if (error.value) {
    return <div style={{ padding: "12px 16px", background: "var(--red-bg)", color: "var(--red)", borderRadius: "8px", fontSize: "13px" }}>{error.value}</div>;
  }

  const d = data.value;
  if (!d) return null;

  const p = d.personal;
  const confirmRate = p.totalDecisions > 0 ? Math.round(p.confirmCount / p.totalDecisions * 100) : 0;
  const flipRate = p.totalDecisions > 0 ? Math.round(p.flipCount / p.totalDecisions * 100) : 0;

  return (
    <div>
      {/* Stat cards */}
      <div class="stat-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
        <div class="stat-card">
          <div class="stat-label">Queue Pending</div>
          <div class="stat-value" style={{ color: "var(--yellow)" }}>{d.queue.pending}</div>
          <div style={{ fontSize: "11px", color: "var(--text-dim)", marginTop: "2px" }}>awaiting review</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Queue Decided</div>
          <div class="stat-value" style={{ color: "var(--green)" }}>{d.queue.decided}</div>
          <div style={{ fontSize: "11px", color: "var(--text-dim)", marginTop: "2px" }}>total decisions</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">My Decisions</div>
          <div class="stat-value" style={{ color: "var(--purple)" }}>{p.totalDecisions}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Confirm Rate</div>
          <div class="stat-value" style={{ color: confirmRate > 60 ? "var(--red)" : "var(--green)" }}>{p.totalDecisions > 0 ? `${confirmRate}%` : "--"}</div>
          <div style={{ fontSize: "11px", color: "var(--text-dim)", marginTop: "2px" }}>{p.confirmCount} confirmed</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Flip Rate</div>
          <div class="stat-value" style={{ color: flipRate > 40 ? "var(--green)" : "var(--text-bright)" }}>{p.totalDecisions > 0 ? `${flipRate}%` : "--"}</div>
          <div style={{ fontSize: "11px", color: "var(--text-dim)", marginTop: "2px" }}>{p.flipCount} flipped</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Avg Speed</div>
          <div class="stat-value">{formatDuration(p.avgDecisionSpeedMs)}</div>
          <div style={{ fontSize: "11px", color: "var(--text-dim)", marginTop: "2px" }}>between decisions</div>
        </div>
      </div>

      {/* Reviewer Performance */}
      <div style={{ marginBottom: "28px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px", paddingBottom: "8px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-bright)", textTransform: "uppercase", letterSpacing: "0.8px" }}>Reviewer Performance</div>
          <div style={{ fontSize: "10px", fontWeight: "600", padding: "2px 8px", borderRadius: "10px", background: "var(--purple-bg)", color: "var(--purple)" }}>
            {d.byReviewer.length} reviewer{d.byReviewer.length !== 1 ? "s" : ""}
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Reviewer</th>
                <th style={{ textAlign: "right" }}>Decisions</th>
                <th style={{ textAlign: "right" }}>Confirms</th>
                <th style={{ textAlign: "right" }}>Flips</th>
                <th style={{ textAlign: "right" }}>Flip Rate</th>
              </tr>
            </thead>
            <tbody>
              {d.byReviewer.length === 0
                ? (
                  <tr>
                    <td colspan={5} style={{ color: "var(--text-dim)", fontStyle: "italic", textAlign: "center", padding: "20px" }}>No reviewer activity yet</td>
                  </tr>
                )
                : d.byReviewer.map((r) => {
                  const isMe = currentUser.value && r.reviewer === currentUser.value;
                  return (
                    <tr key={r.reviewer} style={isMe ? { background: "var(--purple-bg)" } : {}}>
                      <td>
                        <strong>{r.reviewer}</strong>
                        {isMe && <span class="badge purple" style={{ marginLeft: "6px" }}>you</span>}
                      </td>
                      <td style={{ textAlign: "right" }}>{r.decisions}</td>
                      <td style={{ textAlign: "right" }}><span class="badge green">{r.confirms}</span></td>
                      <td style={{ textAlign: "right" }}><span class="badge red">{r.flips}</span></td>
                      <td style={{ textAlign: "right" }}>{r.flipRate}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Decisions */}
      <div style={{ marginBottom: "28px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px", paddingBottom: "8px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-bright)", textTransform: "uppercase", letterSpacing: "0.8px" }}>Recent Decisions</div>
          <div style={{ fontSize: "10px", fontWeight: "600", padding: "2px 8px", borderRadius: "10px", background: "var(--purple-bg)", color: "var(--purple)" }}>{d.recentDecisions.length}</div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Finding</th>
                <th>Question</th>
                <th>Decision</th>
                <th>Header</th>
              </tr>
            </thead>
            <tbody>
              {d.recentDecisions.length === 0
                ? <tr><td colspan={5} style={{ color: "var(--text-dim)", fontStyle: "italic", textAlign: "center", padding: "20px" }}>No decisions yet</td></tr>
                : d.recentDecisions.map((dec, i) => (
                  <tr key={i}>
                    <td>{formatDate(dec.decidedAt)}</td>
                    <td style={{ fontFamily: "var(--mono)", fontSize: "11px" }}>{(dec.findingId || "").slice(0, 12)}</td>
                    <td>{dec.questionIndex !== undefined ? `#${dec.questionIndex}` : "--"}</td>
                    <td>
                      <span class={`badge ${dec.decision === "confirm" ? "green" : "red"}`}>{dec.decision}</span>
                    </td>
                    <td style={{ maxWidth: "250px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{dec.header || "--"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Badge Showcase */}
      <div style={{ marginBottom: "28px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px", paddingBottom: "8px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-bright)", textTransform: "uppercase", letterSpacing: "0.8px" }}>Badges</div>
          <div style={{ fontSize: "10px", fontWeight: "600", padding: "2px 8px", borderRadius: "10px", background: "var(--purple-bg)", color: "var(--purple)" }}>
            {earnedBadges.value.filter((id) => REV_BADGES.some((b) => b.id === id)).length} / {REV_BADGES.length}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: "10px" }}>
          {REV_BADGES.map((b) => {
            const has = earnedBadges.value.includes(b.id);
            return (
              <div
                key={b.id}
                style={{
                  background: "var(--bg-raised)", border: `1px solid ${has ? "#7c3aed" : "var(--border)"}`,
                  borderRadius: "10px", padding: "14px 12px", textAlign: "center",
                  opacity: has ? 1 : 0.4,
                }}
              >
                <div style={{ fontSize: "28px", marginBottom: "6px" }}>{has ? b.icon : "\u{1F512}"}</div>
                <div style={{ fontSize: "11px", fontWeight: "700", color: "var(--text-bright)", marginBottom: "2px" }}>{b.name}</div>
                <div style={{ fontSize: "9px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.5px", color: TIER_COLORS[b.tier] || "#888" }}>{b.tier}</div>
                <div style={{ fontSize: "9px", color: "var(--text-dim)", marginTop: "4px", lineHeight: "1.3" }}>{b.description}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
