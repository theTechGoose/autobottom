/**
 * JudgeDashboard island — appeal stats, per-judge performance, auditor stats,
 * reviewer management, and badge showcase.
 *
 * Fetches from /judge/api/me, /judge/api/dashboard, /judge/api/reviewers.
 * Auto-refreshes every 15s.
 */
import type { ComponentChildren } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";

interface AppealStats { total: number; pending: number; completed: number; overturnRate: string; overturns: number; upheld: number; }
interface QueueStats { pending: number; decided: number; }
interface JudgeRow { judge: string; decisions: number; upholds: number; overturns: number; }
interface AuditorRow { auditor: string; totalAppeals: number; upheld: number; overturned: number; overturnRate: string; }
interface AppealHistoryRow { findingId: string; auditor: string; judgedBy: string; originalScore: number; finalScore: number; overturns: number; timestamp: number; }
interface DashboardData {
  appeals: AppealStats;
  queue: QueueStats;
  byJudge: JudgeRow[];
  byAuditor: AuditorRow[];
  recentAppeals: AppealHistoryRow[];
}
interface ReviewerRow { username: string; createdAt?: number; }

const JDG_BADGES = [
  { id: "jdg_first_verdict", name: "First Verdict", tier: "common", icon: "\u{2696}", description: "Judge your first question" },
  { id: "jdg_arbiter", name: "The Arbiter", tier: "uncommon", icon: "\u{1F3DB}", description: "Judge 100 questions" },
  { id: "jdg_supreme", name: "Supreme Court", tier: "rare", icon: "\u{1F451}", description: "Judge 1,000 questions" },
  { id: "jdg_overturn_10", name: "Objection!", tier: "uncommon", icon: "\u{270B}", description: "Overturn 10 decisions" },
  { id: "jdg_overturn_50", name: "Court of Appeals", tier: "rare", icon: "\u{1F4DC}", description: "Overturn 50 decisions" },
  { id: "jdg_uphold_20", name: "Stamp of Approval", tier: "uncommon", icon: "\u{2705}", description: "Uphold 20 in a row" },
  { id: "jdg_combo_10", name: "Swift Justice", tier: "uncommon", icon: "\u{26A1}", description: "Reach a 10x combo" },
  { id: "jdg_streak_14", name: "Fortnight Judge", tier: "rare", icon: "\u{1F525}", description: "14-day judging streak" },
  { id: "jdg_level_10", name: "Grand Magistrate", tier: "legendary", icon: "\u{1F48E}", description: "Reach level 10" },
];
const TIER_COLORS: Record<string, string> = {
  common: "#6b7280", uncommon: "#22c55e", rare: "#3b82f6", epic: "#a855f7", legendary: "#f59e0b",
};

export default function JudgeDashboard() {
  const loading = useSignal(true);
  const error = useSignal("");
  const data = useSignal<DashboardData | null>(null);
  const reviewers = useSignal<ReviewerRow[]>([]);
  const earnedBadges = useSignal<string[]>([]);
  const addModalOpen = useSignal(false);
  const revEmail = useSignal("");
  const revPassword = useSignal("");
  const addLoading = useSignal(false);
  const addError = useSignal("");

  async function load() {
    try {
      const me = await fetch("/judge/api/me");
      if (me.ok) {
        const meData = await me.json();
        const emailEl = document.getElementById("user-email");
        const avatarEl = document.getElementById("user-avatar");
        if (emailEl) emailEl.textContent = meData.username || "";
        if (avatarEl) avatarEl.textContent = (meData.username || "?")[0].toUpperCase();
      }
      const res = await fetch("/judge/api/dashboard");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data.value = await res.json();
      loading.value = false;
    } catch (err: unknown) {
      loading.value = false;
      error.value = `Failed to load dashboard: ${(err as Error).message}`;
    }
  }

  async function loadReviewers() {
    try {
      const res = await fetch("/judge/api/reviewers");
      if (!res.ok) return;
      reviewers.value = await res.json();
    } catch { /* ignore */ }
  }

  async function loadBadges() {
    try {
      const res = await fetch("/api/badges");
      if (!res.ok) return;
      const d = await res.json();
      earnedBadges.value = d.earned || [];
    } catch { /* ignore */ }
  }

  async function removeReviewer(email: string) {
    if (!confirm(`Remove reviewer ${email}?`)) return;
    try {
      const res = await fetch("/judge/api/reviewers", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error("Failed");
      await loadReviewers();
    } catch (err: unknown) {
      alert((err as Error).message);
    }
  }

  async function addReviewer() {
    if (!revEmail.value.trim() || !revPassword.value) {
      addError.value = "Email and password required";
      return;
    }
    addLoading.value = true;
    addError.value = "";
    try {
      const res = await fetch("/judge/api/reviewers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: revEmail.value.trim(), password: revPassword.value }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Failed"); }
      revEmail.value = "";
      revPassword.value = "";
      addModalOpen.value = false;
      await loadReviewers();
    } catch (err: unknown) {
      addError.value = (err as Error).message;
    }
    addLoading.value = false;
  }

  useEffect(() => {
    load();
    loadReviewers();
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

  const rate = parseFloat(d.appeals.overturnRate);
  const rateColor = isNaN(rate) ? "var(--text-bright)" : rate > 30 ? "var(--red)" : rate > 15 ? "var(--yellow)" : "var(--green)";

  return (
    <div>
      {/* Stat cards */}
      <div class="stat-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
        <div class="stat-card">
          <div class="stat-label">Total Appeals</div>
          <div class="stat-value" style={{ color: "#14b8a6" }}>{d.appeals.total}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Pending</div>
          <div class="stat-value" style={{ color: "var(--yellow)" }}>{d.appeals.pending}</div>
          <div style={{ fontSize: "11px", color: "var(--text-dim)", marginTop: "2px" }}>{d.queue.pending} questions in queue</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Completed</div>
          <div class="stat-value" style={{ color: "var(--green)" }}>{d.appeals.completed}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Overturn Rate</div>
          <div class="stat-value" style={{ color: rateColor }}>{d.appeals.overturnRate}</div>
          <div style={{ fontSize: "11px", color: "var(--text-dim)", marginTop: "2px" }}>{d.appeals.overturns} overturned / {d.appeals.upheld} upheld</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Queue Pending</div>
          <div class="stat-value">{d.queue.pending}</div>
          <div style={{ fontSize: "11px", color: "var(--text-dim)", marginTop: "2px" }}>questions awaiting judge</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Decided</div>
          <div class="stat-value" style={{ color: "var(--green)" }}>{d.queue.decided}</div>
          <div style={{ fontSize: "11px", color: "var(--text-dim)", marginTop: "2px" }}>questions judged</div>
        </div>
      </div>

      {/* Judge Performance */}
      <SectionTable
        title="Judge Performance"
        badge={`${d.byJudge.length} judge${d.byJudge.length !== 1 ? "s" : ""}`}
        badgeColor="#14b8a6"
        headers={["Judge", "Decisions", "Upheld", "Overturned", "Overturn %"]}
        empty="No judge activity yet"
        cols={5}
      >
        {d.byJudge.sort((a, b) => b.decisions - a.decisions).map((j) => {
          const pct = j.decisions > 0 ? ((j.overturns / j.decisions) * 100).toFixed(1) : "0.0";
          return (
            <tr key={j.judge}>
              <td><strong>{j.judge}</strong></td>
              <td style={{ textAlign: "right" }}>{j.decisions}</td>
              <td style={{ textAlign: "right" }}><span class="badge green">{j.upholds}</span></td>
              <td style={{ textAlign: "right" }}><span class="badge red">{j.overturns}</span></td>
              <td style={{ textAlign: "right" }}>{pct}%</td>
            </tr>
          );
        })}
      </SectionTable>

      {/* Auditor Stats */}
      <SectionTable
        title="Auditor Appeal Stats"
        badge={`${d.byAuditor.length} auditor${d.byAuditor.length !== 1 ? "s" : ""}`}
        badgeColor="#14b8a6"
        headers={["Auditor", "Appeals", "Upheld", "Overturned", "Overturn Rate"]}
        empty="No auditor appeal data yet"
        cols={5}
      >
        {d.byAuditor.sort((a, b) => b.totalAppeals - a.totalAppeals).map((a) => (
          <tr key={a.auditor}>
            <td><strong>{a.auditor}</strong></td>
            <td style={{ textAlign: "right" }}>{a.totalAppeals}</td>
            <td style={{ textAlign: "right" }}><span class="badge green">{a.upheld}</span></td>
            <td style={{ textAlign: "right" }}><span class="badge red">{a.overturned}</span></td>
            <td style={{ textAlign: "right" }}>{a.overturnRate}</td>
          </tr>
        ))}
      </SectionTable>

      {/* Recent Appeals */}
      <div style={{ marginBottom: "28px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px", paddingBottom: "8px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-bright)", textTransform: "uppercase", letterSpacing: "0.8px" }}>Recent Appeals</div>
          <div style={{ fontSize: "10px", fontWeight: "600", padding: "2px 8px", borderRadius: "10px", background: "rgba(20,184,166,0.10)", color: "#14b8a6" }}>
            {d.recentAppeals.length} completed
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Finding</th><th>Auditor</th><th>Judge</th>
                <th style={{ textAlign: "right" }}>Original</th>
                <th style={{ textAlign: "right" }}>Final</th>
                <th style={{ textAlign: "right" }}>Overturns</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {d.recentAppeals.length === 0
                ? <tr><td colspan={7} style={{ color: "var(--text-dim)", fontStyle: "italic", textAlign: "center", padding: "20px" }}>No completed appeals yet</td></tr>
                : d.recentAppeals.map((h, i) => {
                  const delta = h.finalScore - h.originalScore;
                  const deltaCls = delta > 0 ? "green" : delta < 0 ? "red" : "blue";
                  const deltaText = `${delta > 0 ? "+" : ""}${delta}%`;
                  const dateStr = new Date(h.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
                  return (
                    <tr key={i}>
                      <td style={{ fontFamily: "var(--mono)", fontSize: "11px" }}>{h.findingId.slice(0, 12)}...</td>
                      <td>{h.auditor}</td>
                      <td>{h.judgedBy}</td>
                      <td style={{ textAlign: "right" }}>{h.originalScore}%</td>
                      <td style={{ textAlign: "right" }}>{h.finalScore}% <span class={`badge ${deltaCls}`}>{deltaText}</span></td>
                      <td style={{ textAlign: "right" }}>{h.overturns}</td>
                      <td>{dateStr}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      {/* My Reviewers */}
      <div style={{ marginBottom: "28px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px", paddingBottom: "8px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-bright)", textTransform: "uppercase", letterSpacing: "0.8px" }}>My Reviewers</div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div style={{ fontSize: "10px", fontWeight: "600", padding: "2px 8px", borderRadius: "10px", background: "rgba(20,184,166,0.10)", color: "#14b8a6" }}>{reviewers.value.length}</div>
            <button
              class="btn"
              style={{ fontSize: "11px", padding: "4px 12px", background: "#0d9488" }}
              onClick={() => { addModalOpen.value = true; addError.value = ""; revEmail.value = ""; revPassword.value = ""; }}
            >+ Add</button>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Email</th><th>Created</th><th></th></tr>
            </thead>
            <tbody>
              {reviewers.value.length === 0
                ? <tr><td colspan={3} style={{ color: "var(--text-dim)", fontStyle: "italic", textAlign: "center", padding: "20px" }}>No reviewers assigned</td></tr>
                : reviewers.value.map((r) => {
                  const dateStr = r.createdAt
                    ? new Date(r.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                    : "--";
                  return (
                    <tr key={r.username}>
                      <td><strong>{r.username}</strong></td>
                      <td>{dateStr}</td>
                      <td>
                        <button class="btn danger" style={{ fontSize: "10px", padding: "3px 10px" }} onClick={() => removeReviewer(r.username)}>Remove</button>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Badge Showcase */}
      <div style={{ marginBottom: "28px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px", paddingBottom: "8px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-bright)", textTransform: "uppercase", letterSpacing: "0.8px" }}>Badges</div>
          <div style={{ fontSize: "10px", fontWeight: "600", padding: "2px 8px", borderRadius: "10px", background: "rgba(20,184,166,0.10)", color: "#14b8a6" }}>
            {earnedBadges.value.filter((id) => JDG_BADGES.some((b) => b.id === id)).length} / {JDG_BADGES.length}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: "10px" }}>
          {JDG_BADGES.map((b) => {
            const has = earnedBadges.value.includes(b.id);
            return (
              <div key={b.id} style={{ background: "var(--bg-raised)", border: `1px solid ${has ? "#0d9488" : "var(--border)"}`, borderRadius: "10px", padding: "14px 12px", textAlign: "center", opacity: has ? 1 : 0.4 }}>
                <div style={{ fontSize: "28px", marginBottom: "6px" }}>{has ? b.icon : "\u{1F512}"}</div>
                <div style={{ fontSize: "11px", fontWeight: "700", color: "var(--text-bright)", marginBottom: "2px" }}>{b.name}</div>
                <div style={{ fontSize: "9px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.5px", color: TIER_COLORS[b.tier] || "#888" }}>{b.tier}</div>
                <div style={{ fontSize: "9px", color: "var(--text-dim)", marginTop: "4px", lineHeight: "1.3" }}>{b.description}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Gamification link */}
      <div style={{ marginBottom: "28px" }}>
        <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-bright)", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: "12px", paddingBottom: "8px", borderBottom: "1px solid var(--border)" }}>Gamification</div>
        <a href="/gamification" style={{ display: "flex", alignItems: "center", gap: "10px", padding: "14px 20px", background: "var(--bg-raised)", border: "1px solid var(--border)", borderRadius: "10px", color: "var(--text)", textDecoration: "none" }}>
          <span style={{ fontSize: "13px" }}>Sound packs, streaks, and combo settings</span>
          <span style={{ marginLeft: "auto", color: "var(--text-dim)", fontSize: "16px" }}>&rsaquo;</span>
        </a>
      </div>

      {/* Add Reviewer Modal */}
      {addModalOpen.value && (
        <div
          style={{ position: "fixed", inset: "0", background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", zIndex: "100", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={(e) => { if (e.target === e.currentTarget) addModalOpen.value = false; }}
        >
          <div style={{ background: "var(--bg-raised)", border: "1px solid var(--border)", borderRadius: "12px", width: "380px", maxWidth: "90vw", padding: "24px" }}>
            <div style={{ fontSize: "14px", fontWeight: "700", color: "var(--text-bright)", marginBottom: "14px" }}>Add Reviewer</div>
            <div class="form-group">
              <label>Email</label>
              <input type="email" placeholder="reviewer@example.com" value={revEmail.value} onInput={(e) => { revEmail.value = (e.target as HTMLInputElement).value; }} />
            </div>
            <div class="form-group">
              <label>Password</label>
              <input type="password" placeholder="Password" value={revPassword.value} onInput={(e) => { revPassword.value = (e.target as HTMLInputElement).value; }} />
            </div>
            {addError.value && <div class="error-msg">{addError.value}</div>}
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "16px", paddingTop: "12px", borderTop: "1px solid var(--border)" }}>
              <button class="btn ghost" onClick={() => { addModalOpen.value = false; }}>Cancel</button>
              <button
                class="btn"
                style={{ background: "#0d9488" }}
                disabled={addLoading.value}
                onClick={addReviewer}
              >
                {addLoading.value ? "Adding..." : "Add Reviewer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Reusable section table sub-component
function SectionTable({ title, badge, badgeColor, headers, children, empty, cols }: {
  title: string;
  badge: string;
  badgeColor: string;
  headers: string[];
  children: ComponentChildren;
  empty: string;
  cols: number;
}) {
  const hasChildren = Array.isArray(children) ? (children as unknown[]).length > 0 : !!children;
  return (
    <div style={{ marginBottom: "28px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px", paddingBottom: "8px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-bright)", textTransform: "uppercase", letterSpacing: "0.8px" }}>{title}</div>
        <div style={{ fontSize: "10px", fontWeight: "600", padding: "2px 8px", borderRadius: "10px", background: "rgba(20,184,166,0.10)", color: badgeColor }}>{badge}</div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={i} style={i > 0 ? { textAlign: "right" } : {}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hasChildren
              ? children
              : <tr><td colspan={cols} style={{ color: "var(--text-dim)", fontStyle: "italic", textAlign: "center", padding: "20px" }}>{empty}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
