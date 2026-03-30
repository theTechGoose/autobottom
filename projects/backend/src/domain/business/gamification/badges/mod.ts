/** Badge definitions, catalog, types, and checker for the gamification system. */

// -- Types --

export type BadgeTier = "common" | "uncommon" | "rare" | "epic" | "legendary";
export type BadgeRole = "reviewer" | "judge" | "manager" | "agent";
export type BadgeCategory = "milestone" | "speed" | "streak" | "combo" | "level" | "quality" | "special";

export interface BadgeDef {
  id: string;
  role: BadgeRole;
  tier: BadgeTier;
  name: string;
  description: string;
  icon: string;
  category: BadgeCategory;
  xpReward: number;
  /** Check function receives stats and returns true if badge is earned */
  check: (stats: BadgeCheckState) => boolean;
}

export interface EarnedBadge {
  badgeId: string;
  earnedAt: number;
  earnedValue?: number;
}

export interface BadgeCheckState {
  // Shared
  totalDecisions: number;
  dayStreak: number;
  lastActiveDate: string; // ISO date YYYY-MM-DD
  bestCombo: number;
  level: number;

  // Reviewer-specific
  avgSpeedMs: number;
  decisionsForAvg: number;

  // Judge-specific
  totalOverturns: number;
  consecutiveUpholds: number;

  // Manager-specific
  totalRemediations: number;
  fastRemediations24h: number;
  fastRemediations1h: number;
  queueCleared: boolean;
  allAgentsAbove80: boolean;

  // Agent-specific
  totalAudits: number;
  perfectScoreCount: number;
  avgScore: number;
  auditsForAvg: number;
  weeklyImprovement: number;
  consecutiveWeeksAbove80: number;
}

export const DEFAULT_BADGE_STATS: BadgeCheckState = {
  totalDecisions: 0,
  dayStreak: 0,
  lastActiveDate: "",
  bestCombo: 0,
  level: 0,
  avgSpeedMs: 0,
  decisionsForAvg: 0,
  totalOverturns: 0,
  consecutiveUpholds: 0,
  totalRemediations: 0,
  fastRemediations24h: 0,
  fastRemediations1h: 0,
  queueCleared: false,
  allAgentsAbove80: false,
  totalAudits: 0,
  perfectScoreCount: 0,
  avgScore: 0,
  auditsForAvg: 0,
  weeklyImprovement: 0,
  consecutiveWeeksAbove80: 0,
};

// -- Tier Colors --

export const TIER_COLORS: Record<BadgeTier, string> = {
  common: "#6b7280",
  uncommon: "#22c55e",
  rare: "#3b82f6",
  epic: "#a855f7",
  legendary: "#f59e0b",
};

export const TIER_GLOW: Record<BadgeTier, string> = {
  common: "rgba(107,114,128,0.2)",
  uncommon: "rgba(34,197,94,0.3)",
  rare: "rgba(59,130,246,0.35)",
  epic: "rgba(168,85,247,0.4)",
  legendary: "rgba(245,158,11,0.5)",
};

// -- Badge Catalog --

export const BADGE_CATALOG: BadgeDef[] = [
  // === REVIEWER (10) ===
  {
    id: "rev_first_blood", role: "reviewer", tier: "common", name: "First Blood",
    description: "Complete your first review", icon: "\uD83E\uDE78",
    category: "milestone", xpReward: 25,
    check: (s) => s.totalDecisions >= 1,
  },
  {
    id: "rev_centurion", role: "reviewer", tier: "uncommon", name: "Centurion",
    description: "Complete 100 reviews", icon: "\uD83D\uDEE1\uFE0F",
    category: "milestone", xpReward: 100,
    check: (s) => s.totalDecisions >= 100,
  },
  {
    id: "rev_grinder", role: "reviewer", tier: "rare", name: "The Grinder",
    description: "Complete 1,000 reviews", icon: "\u2699\uFE0F",
    category: "milestone", xpReward: 500,
    check: (s) => s.totalDecisions >= 1000,
  },
  {
    id: "rev_speed_demon", role: "reviewer", tier: "uncommon", name: "Speed Demon",
    description: "Average under 8s per decision (50+ reviews)", icon: "\u26A1",
    category: "speed", xpReward: 150,
    check: (s) => s.decisionsForAvg >= 50 && s.avgSpeedMs > 0 && s.avgSpeedMs < 8000,
  },
  {
    id: "rev_streak_7", role: "reviewer", tier: "uncommon", name: "Week Warrior",
    description: "7-day decision streak", icon: "\uD83D\uDCC5",
    category: "streak", xpReward: 75,
    check: (s) => s.dayStreak >= 7,
  },
  {
    id: "rev_streak_30", role: "reviewer", tier: "rare", name: "Iron Will",
    description: "30-day decision streak", icon: "\uD83D\uDD25",
    category: "streak", xpReward: 300,
    check: (s) => s.dayStreak >= 30,
  },
  {
    id: "rev_combo_10", role: "reviewer", tier: "uncommon", name: "Combo Breaker",
    description: "Reach a 10x combo", icon: "\uD83D\uDCA5",
    category: "combo", xpReward: 50,
    check: (s) => s.bestCombo >= 10,
  },
  {
    id: "rev_combo_20", role: "reviewer", tier: "rare", name: "Unstoppable",
    description: "Reach a 20x combo", icon: "\uD83C\uDF2A\uFE0F",
    category: "combo", xpReward: 150,
    check: (s) => s.bestCombo >= 20,
  },
  {
    id: "rev_combo_50", role: "reviewer", tier: "epic", name: "Beyond Godlike",
    description: "Reach a 50x combo", icon: "\uD83D\uDC51",
    category: "combo", xpReward: 500,
    check: (s) => s.bestCombo >= 50,
  },
  {
    id: "rev_level_10", role: "reviewer", tier: "legendary", name: "Max Level",
    description: "Reach level 10", icon: "\uD83D\uDC8E",
    category: "level", xpReward: 1000,
    check: (s) => s.level >= 10,
  },

  // === JUDGE (9) ===
  {
    id: "jdg_first_verdict", role: "judge", tier: "common", name: "First Verdict",
    description: "Judge your first question", icon: "\u2696\uFE0F",
    category: "milestone", xpReward: 25,
    check: (s) => s.totalDecisions >= 1,
  },
  {
    id: "jdg_arbiter", role: "judge", tier: "uncommon", name: "The Arbiter",
    description: "Judge 100 questions", icon: "\uD83C\uDFDB\uFE0F",
    category: "milestone", xpReward: 100,
    check: (s) => s.totalDecisions >= 100,
  },
  {
    id: "jdg_supreme", role: "judge", tier: "rare", name: "Supreme Court",
    description: "Judge 1,000 questions", icon: "\uD83C\uDFDB\uFE0F",
    category: "milestone", xpReward: 500,
    check: (s) => s.totalDecisions >= 1000,
  },
  {
    id: "jdg_overturn_10", role: "judge", tier: "uncommon", name: "Objection!",
    description: "Overturn 10 decisions", icon: "\uD83D\uDD04",
    category: "quality", xpReward: 75,
    check: (s) => s.totalOverturns >= 10,
  },
  {
    id: "jdg_overturn_50", role: "judge", tier: "rare", name: "Court of Appeals",
    description: "Overturn 50 decisions", icon: "\uD83D\uDD04",
    category: "quality", xpReward: 250,
    check: (s) => s.totalOverturns >= 50,
  },
  {
    id: "jdg_uphold_20", role: "judge", tier: "uncommon", name: "Stamp of Approval",
    description: "Uphold 20 in a row", icon: "\u2705",
    category: "quality", xpReward: 100,
    check: (s) => s.consecutiveUpholds >= 20,
  },
  {
    id: "jdg_combo_10", role: "judge", tier: "uncommon", name: "Swift Justice",
    description: "Reach a 10x combo", icon: "\u26A1",
    category: "combo", xpReward: 50,
    check: (s) => s.bestCombo >= 10,
  },
  {
    id: "jdg_streak_14", role: "judge", tier: "rare", name: "Fortnight Judge",
    description: "14-day judging streak", icon: "\uD83D\uDD25",
    category: "streak", xpReward: 200,
    check: (s) => s.dayStreak >= 14,
  },
  {
    id: "jdg_level_10", role: "judge", tier: "legendary", name: "Grand Magistrate",
    description: "Reach level 10", icon: "\uD83D\uDC8E",
    category: "level", xpReward: 1000,
    check: (s) => s.level >= 10,
  },

  // === MANAGER (9) ===
  {
    id: "mgr_first_fix", role: "manager", tier: "common", name: "First Response",
    description: "Submit your first remediation", icon: "\uD83D\uDD27",
    category: "milestone", xpReward: 25,
    check: (s) => s.totalRemediations >= 1,
  },
  {
    id: "mgr_fifty", role: "manager", tier: "uncommon", name: "Firefighter",
    description: "Remediate 50 items", icon: "\uD83D\uDE92",
    category: "milestone", xpReward: 100,
    check: (s) => s.totalRemediations >= 50,
  },
  {
    id: "mgr_two_hundred", role: "manager", tier: "rare", name: "Zero Tolerance",
    description: "Remediate 200 items", icon: "\uD83C\uDFAF",
    category: "milestone", xpReward: 500,
    check: (s) => s.totalRemediations >= 200,
  },
  {
    id: "mgr_fast_24h", role: "manager", tier: "uncommon", name: "Rapid Response",
    description: "Remediate 10 items within 24h of arrival", icon: "\u23F1\uFE0F",
    category: "speed", xpReward: 150,
    check: (s) => s.fastRemediations24h >= 10,
  },
  {
    id: "mgr_fast_1h", role: "manager", tier: "rare", name: "Lightning Manager",
    description: "Remediate 5 items within 1 hour", icon: "\u26A1",
    category: "speed", xpReward: 300,
    check: (s) => s.fastRemediations1h >= 5,
  },
  {
    id: "mgr_clear_queue", role: "manager", tier: "rare", name: "Queue Slayer",
    description: "Clear entire queue to zero", icon: "\uD83D\uDDE1\uFE0F",
    category: "special", xpReward: 250,
    check: (s) => s.queueCleared,
  },
  {
    id: "mgr_streak_5", role: "manager", tier: "uncommon", name: "Consistent Manager",
    description: "5 consecutive days with remediations", icon: "\uD83D\uDCC5",
    category: "streak", xpReward: 75,
    check: (s) => s.dayStreak >= 5,
  },
  {
    id: "mgr_streak_20", role: "manager", tier: "rare", name: "Relentless",
    description: "20 consecutive days with remediations", icon: "\uD83D\uDD25",
    category: "streak", xpReward: 300,
    check: (s) => s.dayStreak >= 20,
  },
  {
    id: "mgr_mentor", role: "manager", tier: "epic", name: "Team Builder",
    description: "All supervised agents above 80% pass rate", icon: "\uD83C\uDF1F",
    category: "special", xpReward: 500,
    check: (s) => s.allAgentsAbove80,
  },

  // === AGENT (7) ===
  {
    id: "agt_first_audit", role: "agent", tier: "common", name: "Rookie",
    description: "Complete your first audit", icon: "\uD83C\uDF93",
    category: "milestone", xpReward: 25,
    check: (s) => s.totalAudits >= 1,
  },
  {
    id: "agt_fifty", role: "agent", tier: "uncommon", name: "Seasoned Agent",
    description: "Complete 50 audits", icon: "\uD83C\uDF96",
    category: "milestone", xpReward: 100,
    check: (s) => s.totalAudits >= 50,
  },
  {
    id: "agt_hundred", role: "agent", tier: "rare", name: "Road Warrior",
    description: "Complete 100 audits", icon: "\uD83D\uDEE1\uFE0F",
    category: "milestone", xpReward: 500,
    check: (s) => s.totalAudits >= 100,
  },
  {
    id: "agt_perfect_10", role: "agent", tier: "rare", name: "Perfect Ten",
    description: "Score 100% on 10 audits", icon: "\uD83D\uDCAF",
    category: "quality", xpReward: 300,
    check: (s) => s.perfectScoreCount >= 10,
  },
  {
    id: "agt_honor_roll", role: "agent", tier: "uncommon", name: "Honor Roll",
    description: "90%+ avg score across 20+ audits", icon: "\uD83D\uDCDC",
    category: "quality", xpReward: 200,
    check: (s) => s.auditsForAvg >= 20 && s.avgScore >= 90,
  },
  {
    id: "agt_comeback", role: "agent", tier: "uncommon", name: "Comeback Kid",
    description: "Weekly avg improves by 15+ points", icon: "\uD83D\uDCC8",
    category: "special", xpReward: 150,
    check: (s) => s.weeklyImprovement >= 15,
  },
  {
    id: "agt_consistent", role: "agent", tier: "rare", name: "Consistent Performer",
    description: "5 consecutive weeks above 80%", icon: "\uD83D\uDCCA",
    category: "quality", xpReward: 300,
    check: (s) => s.consecutiveWeeksAbove80 >= 5,
  },
];

// -- Badge Service --

/** Service class wrapping badge logic. */
export class BadgeService {
  /** Returns badges newly earned by role + stats, excluding already-earned. */
  checkBadges(
    role: BadgeRole,
    stats: BadgeCheckState,
    alreadyEarned: Set<string>,
  ): BadgeDef[] {
    return BADGE_CATALOG
      .filter((b) => b.role === role)
      .filter((b) => !alreadyEarned.has(b.id))
      .filter((b) => b.check(stats));
  }

  /** Serialized badge catalog for embedding in client pages. Excludes check fn. */
  getBadgeCatalogJson(): string {
    return JSON.stringify(
      BADGE_CATALOG.map(({ check: _, ...rest }) => rest),
    );
  }
}

// Old API preserved as wrappers
const _svc = new BadgeService();
export function checkBadges(
  ...args: Parameters<BadgeService["checkBadges"]>
): BadgeDef[] {
  return _svc.checkBadges(...args);
}
export function getBadgeCatalogJson(
  ...args: Parameters<BadgeService["getBadgeCatalogJson"]>
): string {
  return _svc.getBadgeCatalogJson(...args);
}
