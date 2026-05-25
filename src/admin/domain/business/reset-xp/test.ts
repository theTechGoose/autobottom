/** Smoke tests for resetXp — exercises Firestore-backed gamification ops
 *  via the existing repository helpers. Uses a fresh ORG per test so runs
 *  in parallel without cross-test interference. */

import { assertEquals, assert } from "#assert";
import { resetXp } from "./mod.ts";
import {
  saveGameState,
  updateBadgeStats,
  getGameState,
  getBadgeStats,
  getEarnedBadges,
  awardBadge,
} from "@gamification/domain/data/gamification-repository/mod.ts";
import { createOrg, createUser } from "@core/business/auth/mod.ts";

const kvOpts = { sanitizeResources: false, sanitizeOps: false };
const DAY_MS = 86_400_000;

async function setupOrg(prefix: string) {
  const orgId = await createOrg(`reset-xp ${prefix} ${crypto.randomUUID().slice(0, 6)}`, "test@x.com");
  return orgId;
}

Deno.test({ name: "resetXp — no roles selected is a no-op", ...kvOpts, fn: async () => {
  const orgId = await setupOrg("noop");
  const report = await resetXp({ orgId, roles: [], dryRun: false });
  assertEquals(report.scannedUsers, 0);
  assertEquals(report.affectedUsers.length, 0);
  assertEquals(report.earnedBadgesDeleted, 0);
}});

Deno.test({ name: "resetXp — full reset wipes game-state / badge-stats / earned-badges for matching roles", ...kvOpts, fn: async () => {
  const orgId = await setupOrg("full");
  await createUser(orgId, "agent1@x.com", "pw", "user");
  await createUser(orgId, "judge1@x.com", "pw", "judge");

  await saveGameState(orgId, "agent1@x.com", {
    xp: 0, level: 5, dayStreak: 7, cosmetics: {},
    totalXp: 500, tokenBalance: 500, purchases: ["x"], lastActiveDate: "2026-05-20",
  });
  await updateBadgeStats(orgId, "agent1@x.com", { totalAudits: 42, dayStreak: 7, lastActiveDate: "2026-05-20", avgScore: 95, auditsForAvg: 42, perfectScoreCount: 10 });
  await awardBadge(orgId, "agent1@x.com", { id: "b1", name: "First", description: "", icon: "", xpReward: 10, rarity: "common" } as any);

  // judge should NOT be touched (role not selected)
  await saveGameState(orgId, "judge1@x.com", {
    xp: 0, level: 3, dayStreak: 2, cosmetics: {},
    totalXp: 200, tokenBalance: 200, purchases: [], lastActiveDate: "2026-05-20",
  });

  const report = await resetXp({ orgId, roles: ["user"], dryRun: false });

  assertEquals(report.mode, "full");
  assertEquals(report.scannedUsers, 1);
  assertEquals(report.affectedUsers, ["agent1@x.com"]);
  assertEquals(report.earnedBadgesDeleted, 1);
  assertEquals(report.gameStatesReset, 1);
  assertEquals(report.badgeStatsReset, 1);
  assertEquals(report.totalXpRemoved, 500);

  const agentState = await getGameState(orgId, "agent1@x.com");
  assertEquals(agentState.totalXp, 0);
  assertEquals(agentState.level, 1);
  assertEquals(agentState.dayStreak, 0);
  assertEquals(agentState.tokenBalance, 0);
  assertEquals(agentState.purchases.length, 0);

  const agentStats = await getBadgeStats(orgId, "agent1@x.com");
  assertEquals(agentStats.totalAudits, 0);
  assertEquals(agentStats.perfectScoreCount, 0);

  const agentBadges = await getEarnedBadges(orgId, "agent1@x.com");
  assertEquals(agentBadges.length, 0);

  // Judge untouched
  const judgeState = await getGameState(orgId, "judge1@x.com");
  assertEquals(judgeState.totalXp, 200);
}});

Deno.test({ name: "resetXp — dry run never writes", ...kvOpts, fn: async () => {
  const orgId = await setupOrg("dry");
  await createUser(orgId, "a@x.com", "pw", "user");
  await saveGameState(orgId, "a@x.com", {
    xp: 0, level: 4, dayStreak: 3, cosmetics: {},
    totalXp: 300, tokenBalance: 300, purchases: [], lastActiveDate: "2026-05-20",
  });

  const report = await resetXp({ orgId, roles: ["user"], dryRun: true });
  assertEquals(report.dryRun, true);
  assertEquals(report.gameStatesReset, 1);
  assertEquals(report.totalXpRemoved, 300);

  // State preserved.
  const state = await getGameState(orgId, "a@x.com");
  assertEquals(state.totalXp, 300);
}});

Deno.test({ name: "resetXp — window mode deletes only in-window earned-badges", ...kvOpts, fn: async () => {
  const orgId = await setupOrg("window-badges");
  await createUser(orgId, "agent@x.com", "pw", "user");

  // earnedAt timestamps spread across two days
  const oldDay = Date.parse("2026-05-01T12:00:00Z");
  const newDay = Date.parse("2026-05-20T12:00:00Z");

  await awardBadge(orgId, "agent@x.com", { id: "old-badge", name: "Old", description: "", icon: "", xpReward: 10, rarity: "common" } as any);
  // Overwrite earnedAt by saving manually via the underlying setStored is messy;
  // instead use awardBadge which sets earnedAt=Date.now(). For the window
  // semantics test we feed fromMs/toMs that bracket Date.now() exactly:
  // window covers right now, so the just-awarded badge IS in-window.
  const justAwarded = await getEarnedBadges(orgId, "agent@x.com");
  const earnedTs = justAwarded[0]?.earnedAt ?? Date.now();

  const report = await resetXp({
    orgId, roles: ["user"],
    fromMs: earnedTs - 1000,
    toMs: earnedTs + 1000,
    dryRun: false,
  });

  assertEquals(report.mode, "window");
  assertEquals(report.earnedBadgesDeleted, 1);

  const remaining = await getEarnedBadges(orgId, "agent@x.com");
  assertEquals(remaining.length, 0);

  // Demonstrate the other direction: window that excludes earnedTs leaves badges alone.
  await awardBadge(orgId, "agent@x.com", { id: "new-badge", name: "New", description: "", icon: "", xpReward: 10, rarity: "common" } as any);
  const farPast = oldDay;
  const report2 = await resetXp({
    orgId, roles: ["user"],
    fromMs: farPast - DAY_MS,
    toMs: farPast,
    dryRun: false,
  });
  assertEquals(report2.earnedBadgesDeleted, 0);
  const stillThere = await getEarnedBadges(orgId, "agent@x.com");
  assertEquals(stillThere.length, 1);
}});

Deno.test({ name: "resetXp — window mode resets state when lastActiveDate falls in window", ...kvOpts, fn: async () => {
  const orgId = await setupOrg("window-state");
  await createUser(orgId, "in@x.com", "pw", "user");
  await createUser(orgId, "out@x.com", "pw", "user");

  await saveGameState(orgId, "in@x.com", {
    xp: 0, level: 3, dayStreak: 2, cosmetics: {},
    totalXp: 150, tokenBalance: 150, purchases: [], lastActiveDate: "2026-05-15",
  });
  await saveGameState(orgId, "out@x.com", {
    xp: 0, level: 3, dayStreak: 2, cosmetics: {},
    totalXp: 100, tokenBalance: 100, purchases: [], lastActiveDate: "2026-04-01",
  });

  const fromMs = Date.parse("2026-05-10T00:00:00Z");
  const toMs = Date.parse("2026-05-25T00:00:00Z");

  const report = await resetXp({ orgId, roles: ["user"], fromMs, toMs, dryRun: false });

  // Only "in" user should be affected.
  assert(report.affectedUsers.includes("in@x.com"));
  assert(!report.affectedUsers.includes("out@x.com"));

  const inState = await getGameState(orgId, "in@x.com");
  assertEquals(inState.totalXp, 0);

  const outState = await getGameState(orgId, "out@x.com");
  assertEquals(outState.totalXp, 100);
}});
