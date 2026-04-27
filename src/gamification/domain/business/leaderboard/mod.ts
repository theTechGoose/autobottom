/** Leaderboard — top-N users by gamification metrics.
 *  All roles use the same `game-state` prefix; we just sort/format differently
 *  per role. */

import type { OrgId } from "@core/data/deno-kv/mod.ts";
import { listGameStates } from "@gamification/domain/data/gamification-repository/mod.ts";

export interface LeaderboardEntry {
  rank: number;
  email: string;
  totalXp: number;
  level: number;
  dayStreak: number;
}

/** Top N by totalXp (descending). Ties broken by level then alphabetic. */
export async function getLeaderboard(orgId: OrgId, limit = 10): Promise<LeaderboardEntry[]> {
  const all = await listGameStates(orgId);
  const sorted = all
    .map(({ email, state }) => ({
      email,
      totalXp: Number(state?.totalXp ?? 0),
      level: Number(state?.level ?? 1),
      dayStreak: Number(state?.dayStreak ?? 0),
    }))
    .filter((e) => e.totalXp > 0)
    .sort((a, b) => {
      if (b.totalXp !== a.totalXp) return b.totalXp - a.totalXp;
      if (b.level !== a.level) return b.level - a.level;
      return a.email.localeCompare(b.email);
    })
    .slice(0, limit);
  return sorted.map((e, i) => ({ rank: i + 1, ...e }));
}
