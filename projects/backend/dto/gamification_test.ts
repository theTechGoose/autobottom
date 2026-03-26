import { assertEquals } from "@std/assert";
import {
  BadgeCheckStateSchema,
  BadgeDefSchema,
  EarnedBadgeSchema,
  GameStateSchema,
} from "./gamification.ts";

Deno.test("BadgeDef schema snapshot — check field is a function", () => {
  const fixture = {
    id: "reviewer-first-decision",
    role: "reviewer" as const,
    tier: "common" as const,
    name: "First Step",
    description: "Make your first decision.",
    icon: "star",
    category: "milestone" as const,
    xpReward: 50,
    check: (_stats: unknown) => true,
  };
  const parsed = BadgeDefSchema.parse(fixture);
  assertEquals(parsed.id, fixture.id);
  assertEquals(parsed.role, fixture.role);
  assertEquals(parsed.tier, fixture.tier);
  assertEquals(parsed.name, fixture.name);
  assertEquals(parsed.description, fixture.description);
  assertEquals(parsed.icon, fixture.icon);
  assertEquals(parsed.category, fixture.category);
  assertEquals(parsed.xpReward, fixture.xpReward);
  assertEquals(typeof parsed.check, "function");
});

Deno.test("EarnedBadge schema snapshot — required fields only", () => {
  const fixture = {
    badgeId: "reviewer-first-decision",
    earnedAt: 1700000000000,
  };
  const parsed = EarnedBadgeSchema.parse(fixture);
  assertEquals(parsed, fixture);
});

Deno.test("EarnedBadge schema snapshot — with earnedValue", () => {
  const fixture = {
    badgeId: "reviewer-speed-demon",
    earnedAt: 1700000000000,
    earnedValue: 42,
  };
  const parsed = EarnedBadgeSchema.parse(fixture);
  assertEquals(parsed, fixture);
});

Deno.test("BadgeCheckState schema snapshot", () => {
  const fixture = {
    totalDecisions: 100,
    dayStreak: 5,
    lastActiveDate: "2024-01-15",
    bestCombo: 10,
    level: 3,
    avgSpeedMs: 1200,
    decisionsForAvg: 50,
    totalOverturns: 8,
    consecutiveUpholds: 3,
    totalRemediations: 12,
    fastRemediations24h: 4,
    fastRemediations1h: 1,
    queueCleared: false,
    allAgentsAbove80: true,
    totalAudits: 20,
    perfectScoreCount: 5,
    avgScore: 87.5,
    auditsForAvg: 20,
    weeklyImprovement: 2.5,
    consecutiveWeeksAbove80: 3,
  };
  const parsed = BadgeCheckStateSchema.parse(fixture);
  assertEquals(parsed, fixture);
});

Deno.test("GameState schema snapshot — nulls for equipped fields", () => {
  const fixture = {
    totalXp: 500,
    tokenBalance: 120,
    level: 2,
    dayStreak: 3,
    lastActiveDate: "2024-01-15",
    purchases: ["title-ace", "theme-dark"],
    equippedTitle: null,
    equippedTheme: null,
    animBindings: {},
  };
  const parsed = GameStateSchema.parse(fixture);
  assertEquals(parsed, fixture);
});

Deno.test("GameState schema snapshot — with equipped fields and animBindings", () => {
  const fixture = {
    totalXp: 2000,
    tokenBalance: 350,
    level: 7,
    dayStreak: 14,
    lastActiveDate: "2024-06-01",
    purchases: ["title-ace", "theme-dark", "anim-confetti"],
    equippedTitle: "title-ace",
    equippedTheme: "theme-dark",
    animBindings: { decision_made: "anim-confetti" },
  };
  const parsed = GameStateSchema.parse(fixture);
  assertEquals(parsed, fixture);
});
