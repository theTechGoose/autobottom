import { z } from "zod";

export const BadgeTierSchema = z.enum(["common", "uncommon", "rare", "epic", "legendary"]);
export const BadgeRoleSchema = z.enum(["reviewer", "judge", "manager", "agent"]);
export const BadgeCategorySchema = z.enum(["milestone", "speed", "streak", "combo", "level", "quality", "special"]);

export const BadgeDefSchema = z.object({
  id: z.string(),
  role: BadgeRoleSchema,
  tier: BadgeTierSchema,
  name: z.string(),
  description: z.string(),
  icon: z.string(),
  category: BadgeCategorySchema,
  xpReward: z.number(),
  check: z.function(),
});

export const EarnedBadgeSchema = z.object({
  badgeId: z.string(),
  earnedAt: z.number(),
  earnedValue: z.number().optional(),
});

export const BadgeCheckStateSchema = z.object({
  totalDecisions: z.number(),
  dayStreak: z.number(),
  lastActiveDate: z.string(),
  bestCombo: z.number(),
  level: z.number(),
  avgSpeedMs: z.number(),
  decisionsForAvg: z.number(),
  totalOverturns: z.number(),
  consecutiveUpholds: z.number(),
  totalRemediations: z.number(),
  fastRemediations24h: z.number(),
  fastRemediations1h: z.number(),
  queueCleared: z.boolean(),
  allAgentsAbove80: z.boolean(),
  totalAudits: z.number(),
  perfectScoreCount: z.number(),
  avgScore: z.number(),
  auditsForAvg: z.number(),
  weeklyImprovement: z.number(),
  consecutiveWeeksAbove80: z.number(),
});

export const GameStateSchema = z.object({
  totalXp: z.number(),
  tokenBalance: z.number(),
  level: z.number(),
  dayStreak: z.number(),
  lastActiveDate: z.string(),
  purchases: z.array(z.string()),
  equippedTitle: z.string().nullable(),
  equippedTheme: z.string().nullable(),
  animBindings: z.record(z.string(), z.string()),
});

export type BadgeTier = z.infer<typeof BadgeTierSchema>;
export type BadgeRole = z.infer<typeof BadgeRoleSchema>;
export type BadgeCategory = z.infer<typeof BadgeCategorySchema>;
export type EarnedBadge = z.infer<typeof EarnedBadgeSchema>;
export type BadgeCheckState = z.infer<typeof BadgeCheckStateSchema>;
export type GameState = z.infer<typeof GameStateSchema>;
