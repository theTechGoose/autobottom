/** Gamification lane — shared XP / badge / prefab-event orchestration that
 *  runs out-of-band of the request that earned it.
 *
 *  Caller (step-finalize, finalizeReviewedAudit, submitRemediation, ...)
 *  invokes `awardForCompletion(ctx)` and either fire-and-forgets or awaits.
 *  All Firestore work is wrapped in `runInBackgroundLane` so the request
 *  thread is never blocked and foreground latency stays clean.
 *
 *  Per-role inputs and XP formulas:
 *    agent     → score (0-100), questionsAnswered. XP = floor(score*0.3)
 *                +50 perfect / +20 high.
 *    reviewer  → questionsReviewed. XP = 15 + 5 per question.
 *    judge     → overturned (bool). XP = 20 flat.
 *    manager   → remediationLatencyMs. XP = 30 + 20 same-day bonus.
 *
 *  Per-user `animBindings[prefabType]` (set in /gamification UI) is passed
 *  through to `checkAndEmitPrefab` so toast clients can play the user's
 *  equipped sound/animation when their event broadcasts. */

import type { OrgId } from "@core/data/deno-kv/mod.ts";
import { runInBackgroundLane } from "@core/data/firestore/mod.ts";
import {
  getBadgeStats, updateBadgeStats, getEarnedBadges, awardBadge,
  awardXp, getGameState,
} from "@gamification/domain/data/gamification-repository/mod.ts";
import {
  checkBadges, type BadgeCheckState, type BadgeRole,
} from "@gamification/domain/business/badge-system/mod.ts";
import { checkAndEmitPrefab } from "@events/domain/data/events-repository/mod.ts";

export type LaneRole = "agent" | "reviewer" | "judge" | "manager";

export interface CompletionContext {
  orgId: OrgId;
  email: string;
  role: LaneRole;
  /** Agent only — 0-100 score of the completed audit. */
  score?: number;
  /** Reviewer only — number of questions reviewed in the finalized audit. */
  questionsReviewed?: number;
  /** Judge only — whether the decision overturned the reviewer. */
  overturned?: boolean;
  /** Manager only — ms between finding arrival and remediation submit. */
  remediationLatencyMs?: number;
}

interface AwardResult {
  baseXp: number;
  badgeXp: number;
  newBadgeIds: string[];
  leveledUp: boolean;
  newLevel: number;
  dayStreak: number;
  emitted: string[];
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const STREAK_MILESTONES = new Set([7, 14, 30, 60, 100]);

function ymdToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function ymdYesterday(): string {
  return new Date(Date.now() - DAY_MS).toISOString().slice(0, 10);
}

/** Compute base XP per role + context. Pure. Exported for unit tests. */
export function computeBaseXp(ctx: CompletionContext): number {
  switch (ctx.role) {
    case "agent": {
      if (typeof ctx.score !== "number") return 0;
      let xp = Math.floor(ctx.score * 0.3);
      if (ctx.score === 100) xp += 50;
      else if (ctx.score >= 90) xp += 20;
      return xp;
    }
    case "reviewer":
      return 15 + (ctx.questionsReviewed ?? 0) * 5;
    case "judge":
      return 20;
    case "manager": {
      let xp = 30;
      if (typeof ctx.remediationLatencyMs === "number" && ctx.remediationLatencyMs <= DAY_MS) xp += 20;
      return xp;
    }
  }
}

/** Update + persist BadgeStats with role-appropriate counters. Returns the
 *  updated stats object as it now lives in Firestore. */
async function bumpStats(ctx: CompletionContext): Promise<Record<string, unknown>> {
  const stats = await getBadgeStats(ctx.orgId, ctx.email) as unknown as Record<string, unknown>;
  const today = ymdToday();

  // Day streak — shared across all roles.
  const lastActive = (stats.lastActiveDate as string | undefined) ?? "";
  if (lastActive !== today) {
    stats.dayStreak = lastActive === ymdYesterday() ? ((stats.dayStreak as number ?? 0) + 1) : 1;
    stats.lastActiveDate = today;
  }

  if (ctx.role === "agent" && typeof ctx.score === "number") {
    stats.totalAudits = (stats.totalAudits as number ?? 0) + 1;
    if (ctx.score === 100) stats.perfectScoreCount = (stats.perfectScoreCount as number ?? 0) + 1;
    const prevAvg = (stats.avgScore as number) ?? 0;
    const prevForAvg = (stats.auditsForAvg as number) ?? 0;
    const newForAvg = prevForAvg + 1;
    stats.auditsForAvg = newForAvg;
    stats.avgScore = Math.round((prevAvg * prevForAvg + ctx.score) / newForAvg * 100) / 100;
  } else if (ctx.role === "reviewer") {
    stats.totalDecisions = (stats.totalDecisions as number ?? 0) + 1;
  } else if (ctx.role === "judge") {
    stats.totalDecisions = (stats.totalDecisions as number ?? 0) + 1;
    if (ctx.overturned) {
      stats.totalOverturns = (stats.totalOverturns as number ?? 0) + 1;
      stats.consecutiveUpholds = 0;
    } else {
      stats.consecutiveUpholds = (stats.consecutiveUpholds as number ?? 0) + 1;
    }
  } else if (ctx.role === "manager") {
    stats.totalRemediations = (stats.totalRemediations as number ?? 0) + 1;
    if (typeof ctx.remediationLatencyMs === "number") {
      if (ctx.remediationLatencyMs <= HOUR_MS) {
        stats.fastRemediations1h = (stats.fastRemediations1h as number ?? 0) + 1;
      }
      if (ctx.remediationLatencyMs <= DAY_MS) {
        stats.fastRemediations24h = (stats.fastRemediations24h as number ?? 0) + 1;
      }
    }
  }

  // Surface the user's current level into the stats blob so level-gated
  // badge predicates evaluate correctly without needing a separate read.
  const currentState = await getGameState(ctx.orgId, ctx.email);
  stats.level = currentState.level ?? 0;

  await updateBadgeStats(ctx.orgId, ctx.email, stats as never);
  return stats;
}

/** Run the lane. Returns a promise that resolves to an AwardResult so callers
 *  that want to inspect the outcome (tests, debug routes) can; production
 *  call sites should `.catch(() => {})` and not await. */
export function awardForCompletion(ctx: CompletionContext): Promise<AwardResult | null> {
  return runInBackgroundLane(async () => {
    const t0 = Date.now();
    try {
      const stats = await bumpStats(ctx);

      const earned = await getEarnedBadges(ctx.orgId, ctx.email);
      const earnedSet = new Set(earned.map((b) => b.badgeId));
      const checkRole: BadgeRole = ctx.role;
      const newBadges = checkBadges(checkRole, stats as unknown as BadgeCheckState, earnedSet);

      let badgeXp = 0;
      for (const badge of newBadges) {
        // `badge` is the badge-system BadgeDef (with `tier`); the repo
        // takes the core dto BadgeDef (with `rarity`). Same field
        // semantics, different names — cast to keep the lane lean.
        const fresh = await awardBadge(ctx.orgId, ctx.email, badge as never);
        if (fresh) badgeXp += badge.xpReward;
      }

      const baseXp = computeBaseXp(ctx);
      const award = await awardXp(
        ctx.orgId, ctx.email, baseXp + badgeXp,
        ctx.role === "agent" ? "agent" : ctx.role,
      );

      // Pull animBindings from the user's saved game-state so each prefab
      // emit can carry the user's equipped animation/sound ID.
      const stateForBindings = await getGameState(ctx.orgId, ctx.email) as unknown as {
        animBindings?: Record<string, string>;
      };
      const bindings = stateForBindings.animBindings ?? {};
      const animId = (type: string): string | null => bindings[type] ?? null;

      const displayName = ctx.email.split("@")[0];
      const emitted: string[] = [];

      // Badge-earned per badge.
      for (const badge of newBadges) {
        await checkAndEmitPrefab(
          ctx.orgId, "badge_earned", ctx.email,
          `${displayName} earned ${badge.name}!`, animId("badge_earned"),
        );
        emitted.push(`badge_earned:${badge.id}`);
      }

      // Per-role completion events.
      if (ctx.role === "agent") {
        await checkAndEmitPrefab(
          ctx.orgId, "sale_completed", ctx.email,
          `${displayName} completed an audit!`, animId("sale_completed"),
        );
        emitted.push("sale_completed");
        if (ctx.score === 100) {
          await checkAndEmitPrefab(
            ctx.orgId, "perfect_score", ctx.email,
            `${displayName} got a perfect score!`, animId("perfect_score"),
          );
          emitted.push("perfect_score");
        }
      }

      // Streak milestones at 7/14/30/60/100.
      if (STREAK_MILESTONES.has(award.state.dayStreak)) {
        await checkAndEmitPrefab(
          ctx.orgId, "streak_milestone", ctx.email,
          `${displayName} hit a ${award.state.dayStreak}-day streak!`,
          animId("streak_milestone"),
        );
        emitted.push(`streak_milestone:${award.state.dayStreak}`);
      }

      // Level-up.
      if (award.leveledUp) {
        await checkAndEmitPrefab(
          ctx.orgId, "level_up", ctx.email,
          `${displayName} reached level ${award.state.level}!`,
          animId("level_up"),
        );
        emitted.push(`level_up:${award.state.level}`);
      }

      const result: AwardResult = {
        baseXp, badgeXp,
        newBadgeIds: newBadges.map((b) => b.id),
        leveledUp: award.leveledUp,
        newLevel: award.state.level,
        dayStreak: award.state.dayStreak,
        emitted,
      };
      console.log(
        `🎮 [GAMIFICATION-LANE] ${ctx.role}/${ctx.email} ` +
        `xp=${baseXp}+${badgeXp} badges=${newBadges.length} ` +
        `lvl=${award.state.level}${award.leveledUp ? "↑" : ""} ` +
        `streak=${award.state.dayStreak} tookMs=${Date.now() - t0}`,
      );
      return result;
    } catch (err) {
      console.error(`❌ [GAMIFICATION-LANE] ${ctx.role}/${ctx.email}:`, err);
      return null;
    }
  });
}
