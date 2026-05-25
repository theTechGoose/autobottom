/** Reset-XP — launch-prep tool that wipes per-user gamification progression
 *  (earned-badges, game-state, badge-stats) for selected user roles, with an
 *  optional date-window filter.
 *
 *  Two modes:
 *    full — no fromMs/toMs supplied. Zeroes game-state + badge-stats and
 *           deletes every earned-badge for each affected user.
 *    window — fromMs+toMs supplied. Deletes only earned-badges whose
 *           earnedAt falls in [fromMs, toMs). game-state + badge-stats are
 *           zeroed for users whose lastActiveDate falls in the window
 *           (best-effort — see notes below).
 *
 *  Notes on window semantics: we can't precisely subtract "only the XP
 *  earned during the window" without a per-event audit log of XP grants
 *  (which we don't keep). Window mode therefore zeroes the cumulative
 *  state for users active in the window — operator intent is "wipe this
 *  dev-era activity", not surgical XP arithmetic. The UI documents this.
 *
 *  Dry-run mode skips every write and returns the counts that WOULD have
 *  been applied. */

import type { OrgId } from "@core/data/deno-kv/mod.ts";
import type { Role } from "@core/business/auth/mod.ts";
import { listUsers } from "@core/business/auth/mod.ts";
import {
  getEarnedBadges,
  getGameState,
  getBadgeStats,
  saveGameState,
  updateBadgeStats,
} from "@gamification/domain/data/gamification-repository/mod.ts";
import { deleteStored } from "@core/data/firestore/mod.ts";

export type ResetXpRole = "user" | "reviewer" | "judge" | "manager";

export interface ResetXpOpts {
  orgId: OrgId;
  /** Roles to affect. Empty array = no-op (returns zeros). */
  roles: ResetXpRole[];
  /** Window start (inclusive ms). Omit BOTH fromMs and toMs for full reset. */
  fromMs?: number;
  /** Window end (exclusive ms). */
  toMs?: number;
  /** If true, count only — no writes. */
  dryRun?: boolean;
}

export interface ResetXpReport {
  mode: "full" | "window";
  dryRun: boolean;
  scannedUsers: number;
  affectedUsers: string[];
  earnedBadgesDeleted: number;
  gameStatesReset: number;
  badgeStatsReset: number;
  totalXpRemoved: number;
}

const ZERO_GAME_STATE = {
  xp: 0,
  level: 1,
  dayStreak: 0,
  cosmetics: {},
  totalXp: 0,
  tokenBalance: 0,
  purchases: [] as string[],
  lastActiveDate: "",
  equippedTitle: null,
  equippedTheme: null,
  animBindings: {},
};

const ZERO_BADGE_STATS = {
  totalAudits: 0,
  perfectScoreCount: 0,
  avgScore: 0,
  auditsForAvg: 0,
  dayStreak: 0,
  lastActiveDate: "",
};

function msToYmd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** True if lastActiveDate (YYYY-MM-DD) falls in [fromMs, toMs). */
function activeInWindow(lastActiveDate: string, fromMs: number, toMs: number): boolean {
  if (!lastActiveDate) return false;
  const fromYmd = msToYmd(fromMs);
  const toYmd = msToYmd(toMs - 1);  // inclusive day boundary
  return lastActiveDate >= fromYmd && lastActiveDate <= toYmd;
}

export async function resetXp(opts: ResetXpOpts): Promise<ResetXpReport> {
  const t0 = Date.now();
  const hasWindow = typeof opts.fromMs === "number" && typeof opts.toMs === "number";
  const mode: "full" | "window" = hasWindow ? "window" : "full";
  const dryRun = !!opts.dryRun;

  const report: ResetXpReport = {
    mode, dryRun,
    scannedUsers: 0,
    affectedUsers: [],
    earnedBadgesDeleted: 0,
    gameStatesReset: 0,
    badgeStatsReset: 0,
    totalXpRemoved: 0,
  };

  if (!opts.roles.length) {
    console.log(`🧹 [RESET-XP] no roles selected — no-op`);
    return report;
  }

  const roleSet = new Set<Role>(opts.roles as Role[]);
  const allUsers = await listUsers(opts.orgId);
  const targetUsers = allUsers.filter((u) => roleSet.has(u.role));
  report.scannedUsers = targetUsers.length;

  for (const u of targetUsers) {
    let touched = false;

    // -- earned-badges --
    const earned = await getEarnedBadges(opts.orgId, u.email);
    const toDelete = hasWindow
      ? earned.filter((b) => b.earnedAt >= opts.fromMs! && b.earnedAt < opts.toMs!)
      : earned;

    if (toDelete.length) {
      touched = true;
      report.earnedBadgesDeleted += toDelete.length;
      if (!dryRun) {
        for (const b of toDelete) {
          await deleteStored("earned-badge", opts.orgId, u.email, b.badgeId);
        }
      }
    }

    // -- game-state --
    const state = await getGameState(opts.orgId, u.email) as unknown as {
      totalXp?: number; lastActiveDate?: string;
    };
    const stateHasData = (state.totalXp ?? 0) > 0 || !!state.lastActiveDate;
    const shouldResetState = stateHasData && (
      !hasWindow ||
      toDelete.length > 0 ||
      activeInWindow(state.lastActiveDate ?? "", opts.fromMs!, opts.toMs!)
    );

    if (shouldResetState) {
      touched = true;
      report.gameStatesReset += 1;
      report.totalXpRemoved += state.totalXp ?? 0;
      if (!dryRun) {
        await saveGameState(opts.orgId, u.email, { ...ZERO_GAME_STATE });
      }
    }

    // -- badge-stats --
    const stats = await getBadgeStats(opts.orgId, u.email);
    const statsHasData = stats.totalAudits > 0 || stats.dayStreak > 0 || !!stats.lastActiveDate;
    const shouldResetStats = statsHasData && (
      !hasWindow ||
      toDelete.length > 0 ||
      activeInWindow(stats.lastActiveDate, opts.fromMs!, opts.toMs!)
    );

    if (shouldResetStats) {
      touched = true;
      report.badgeStatsReset += 1;
      if (!dryRun) {
        await updateBadgeStats(opts.orgId, u.email, { ...ZERO_BADGE_STATS });
      }
    }

    if (touched) report.affectedUsers.push(u.email);
  }

  const verb = dryRun ? "DRY" : "LIVE";
  console.log(
    `🧹 [RESET-XP] ${verb} mode=${mode} roles=${opts.roles.join(",")} ` +
    `scanned=${report.scannedUsers} affected=${report.affectedUsers.length} ` +
    `badges=${report.earnedBadgesDeleted} gameStates=${report.gameStatesReset} ` +
    `badgeStats=${report.badgeStatsReset} xpRemoved=${report.totalXpRemoved} ` +
    `tookMs=${Date.now() - t0}`,
  );

  return report;
}
