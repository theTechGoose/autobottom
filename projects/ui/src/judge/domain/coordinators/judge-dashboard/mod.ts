import { Component } from "@sprig/kit";

interface AppealStats {
  total: number;
  pending: number;
  completed: number;
  overturnRate: string;
  overturns: number;
  upheld: number;
}
interface QueueStats { pending: number; decided: number; }
interface JudgeRow { judge: string; decisions: number; upholds: number; overturns: number; }
interface AuditorRow { auditor: string; totalAppeals: number; upheld: number; overturned: number; overturnRate: string; }
interface AppealHistoryRow {
  findingId: string;
  auditor: string;
  judgedBy: string;
  originalScore: number;
  finalScore: number;
  overturns: number;
  timestamp: number;
}
interface DashboardData {
  appeals: AppealStats;
  queue: QueueStats;
  byJudge: JudgeRow[];
  byAuditor: AuditorRow[];
  recentAppeals: AppealHistoryRow[];
}
interface ReviewerRow { username: string; createdAt?: number; }

interface Badge {
  id: string;
  name: string;
  tier: string;
  icon: string;
  description: string;
}

const API = "/judge/api";

@Component({ template: "./mod.html", island: true })
export class JudgeDashboard {
  loading = true;
  error = "";
  data: DashboardData | null = null;
  reviewers: ReviewerRow[] = [];
  earnedBadges: string[] = [];

  readonly JDG_BADGES: Badge[] = [
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

  readonly TIER_COLORS: Record<string, string> = {
    common: "#6b7280",
    uncommon: "#22c55e",
    rare: "#3b82f6",
    epic: "#a855f7",
    legendary: "#f59e0b",
  };

  isBadgeEarned(id: string): boolean {
    return this.earnedBadges.includes(id);
  }

  earnedBadgeCount(): number {
    return this.earnedBadges.filter((id) => this.JDG_BADGES.some((b) => b.id === id)).length;
  }

  async load(): Promise<void> {
    try {
      const me = await fetch(`${API}/me`);
      if (me.ok) {
        const meData = await me.json();
        const emailEl = document.getElementById("user-email");
        const avatarEl = document.getElementById("user-avatar");
        if (emailEl) emailEl.textContent = meData.username || "";
        if (avatarEl) avatarEl.textContent = (meData.username || "?")[0].toUpperCase();
      }
      const res = await fetch(`${API}/dashboard`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.data = await res.json();
      this.loading = false;
    } catch (err: unknown) {
      this.loading = false;
      this.error = `Failed to load dashboard: ${(err as Error).message}`;
    }
  }

  async loadReviewers(): Promise<void> {
    try {
      const res = await fetch(`${API}/reviewers`);
      if (!res.ok) return;
      this.reviewers = await res.json();
    } catch { /* ignore */ }
  }

  async loadBadges(): Promise<void> {
    try {
      const res = await fetch("/api/badges");
      if (!res.ok) return;
      const d = await res.json();
      this.earnedBadges = d.earned || [];
    } catch { /* ignore */ }
  }

  async addReviewer(email: string, password: string): Promise<void> {
    const res = await fetch(`${API}/reviewers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const d = await res.json();
      throw new Error(d.error || "Failed");
    }
    await this.loadReviewers();
  }

  async removeReviewer(email: string): Promise<void> {
    const res = await fetch(`${API}/reviewers`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) throw new Error("Failed");
    await this.loadReviewers();
  }
}
