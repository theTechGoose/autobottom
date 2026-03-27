import { Component } from "@sprig/kit";

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
  common: "#6b7280",
  uncommon: "#22c55e",
  rare: "#3b82f6",
  epic: "#a855f7",
  legendary: "#f59e0b",
};

@Component({ template: "./mod.html", island: true })
export class AgentDashboard {
  activeTab: "dashboard" | "badges" = "dashboard";
  data: DashboardData | null = null;
  gameState: GameState | null = null;
  loading = true;
  error = "";
  userEmail = "--";

  readonly badges = AGT_BADGES;
  readonly tierColors = TIER_COLORS;

  async load() {
    try {
      const [meRes, dataRes] = await Promise.all([
        fetch("/agent/api/me", { credentials: "same-origin" }),
        fetch("/agent/api/dashboard", { credentials: "same-origin" }),
      ]);

      if (!meRes.ok) {
        globalThis.location.href = "/login";
        return;
      }

      const me = await meRes.json();
      this.userEmail = me.username || me.email || "--";

      const navAvatar = document.getElementById("nav-avatar");
      const navUsername = document.getElementById("nav-username");
      if (navAvatar) {
        navAvatar.textContent = (this.userEmail[0] || "A").toUpperCase();
      }
      if (navUsername) navUsername.textContent = this.userEmail;

      if (!dataRes.ok) throw new Error("Failed to load dashboard data");
      this.data = await dataRes.json();
    } catch (err) {
      this.error = "Failed to load dashboard: " +
        ((err as Error).message || "Unknown error");
    } finally {
      this.loading = false;
    }
  }

  async loadGameState() {
    try {
      const res = await fetch("/agent/api/game-state", {
        credentials: "same-origin",
      });
      if (!res.ok) return;
      this.gameState = await res.json();
    } catch {
      /* non-critical */
    }
  }

  getThisWeekCount(): number {
    if (!this.data) return 0;
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);
    return (this.data.recentAudits || []).filter(
      (a) => new Date(a.completedAt || a.jobTimestamp || 0) >= weekStart,
    ).length;
  }

  getWeeklyChartData(): { label: string; value: number }[] {
    if (!this.data?.weeklyTrend) return [];
    return this.data.weeklyTrend.map((w) => ({
      label: this.formatWeekLabel(w.weekStart),
      value: Math.round(w.avgScore || 0),
    }));
  }

  formatWeekLabel(dateStr?: string): string {
    if (!dateStr) return "--";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return (d.getMonth() + 1) + "/" + d.getDate();
  }

  earnedBadgeCount(): number {
    if (!this.gameState) return 0;
    return AGT_BADGES.filter((b) =>
      (this.gameState?.badges || []).includes(b.id)
    ).length;
  }

  isBadgeEarned(badgeId: string): boolean {
    return (this.gameState?.badges || []).includes(badgeId);
  }

  getBadgeTierColor(tier: string): string {
    return TIER_COLORS[tier] || "#6e7681";
  }
}
