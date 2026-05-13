/** Leaderboard — top-N users by gamification metrics.
 *  All roles use the same `game-state` prefix; we just sort/format differently
 *  per role.
 *
 *  Eligibility: only role="user" (default agents) appear on the leaderboard.
 *  Admins, managers, judges, reviewers, and api accounts are excluded — the
 *  leaderboard is a peer-competition view for agents, not a system-wide XP
 *  scoreboard. Game states without a matching user record are skipped (covers
 *  stale `api` entries from before this filter was in place). */

import type { OrgId } from "@core/data/deno-kv/mod.ts";
import { listGameStates } from "@gamification/domain/data/gamification-repository/mod.ts";
import { listUsers } from "@core/business/auth/mod.ts";

export interface LeaderboardEntry {
  rank: number;
  email: string;
  totalXp: number;
  level: number;
  dayStreak: number;
}

/** Top N by totalXp (descending). Ties broken by level then alphabetic.
 *  Only role="user" (agent) accounts are eligible. */
export async function getLeaderboard(orgId: OrgId, limit = 10): Promise<LeaderboardEntry[]> {
  const [all, agents] = await Promise.all([
    listGameStates(orgId),
    listUsers(orgId, "user").catch(() => [] as Array<{ email: string }>),
  ]);
  const agentEmails = new Set(agents.map((u) => u.email.toLowerCase()));
  const sorted = all
    .map(({ email, state }) => ({
      email,
      totalXp: Number(state?.totalXp ?? 0),
      level: Number(state?.level ?? 1),
      dayStreak: Number(state?.dayStreak ?? 0),
    }))
    .filter((e) => e.totalXp > 0 && agentEmails.has(e.email.toLowerCase()))
    .sort((a, b) => {
      if (b.totalXp !== a.totalXp) return b.totalXp - a.totalXp;
      if (b.level !== a.level) return b.level - a.level;
      return a.email.localeCompare(b.email);
    })
    .slice(0, limit);
  return sorted.map((e, i) => ({ rank: i + 1, ...e }));
}
