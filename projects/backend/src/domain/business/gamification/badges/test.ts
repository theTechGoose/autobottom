import { assertEquals, assert } from "@std/assert";
import {
  checkBadges,
  getBadgeCatalogJson,
  BadgeService,
  DEFAULT_BADGE_STATS,
  BADGE_CATALOG,
  type BadgeCheckState,
} from "./mod.ts";

// ---------------------------------------------------------------------------
// DEFAULT_BADGE_STATS
// ---------------------------------------------------------------------------

Deno.test("DEFAULT_BADGE_STATS: all numeric fields are zero", () => {
  assertEquals(DEFAULT_BADGE_STATS.totalDecisions, 0);
  assertEquals(DEFAULT_BADGE_STATS.dayStreak, 0);
  assertEquals(DEFAULT_BADGE_STATS.bestCombo, 0);
  assertEquals(DEFAULT_BADGE_STATS.level, 0);
  assertEquals(DEFAULT_BADGE_STATS.avgSpeedMs, 0);
  assertEquals(DEFAULT_BADGE_STATS.decisionsForAvg, 0);
  assertEquals(DEFAULT_BADGE_STATS.totalOverturns, 0);
  assertEquals(DEFAULT_BADGE_STATS.consecutiveUpholds, 0);
  assertEquals(DEFAULT_BADGE_STATS.totalRemediations, 0);
  assertEquals(DEFAULT_BADGE_STATS.fastRemediations24h, 0);
  assertEquals(DEFAULT_BADGE_STATS.fastRemediations1h, 0);
  assertEquals(DEFAULT_BADGE_STATS.totalAudits, 0);
  assertEquals(DEFAULT_BADGE_STATS.perfectScoreCount, 0);
  assertEquals(DEFAULT_BADGE_STATS.avgScore, 0);
  assertEquals(DEFAULT_BADGE_STATS.auditsForAvg, 0);
  assertEquals(DEFAULT_BADGE_STATS.weeklyImprovement, 0);
  assertEquals(DEFAULT_BADGE_STATS.consecutiveWeeksAbove80, 0);
});

Deno.test("DEFAULT_BADGE_STATS: boolean fields are false", () => {
  assertEquals(DEFAULT_BADGE_STATS.queueCleared, false);
  assertEquals(DEFAULT_BADGE_STATS.allAgentsAbove80, false);
});

Deno.test("DEFAULT_BADGE_STATS: lastActiveDate is empty string", () => {
  assertEquals(DEFAULT_BADGE_STATS.lastActiveDate, "");
});

// ---------------------------------------------------------------------------
// BADGE_CATALOG
// ---------------------------------------------------------------------------

Deno.test("BADGE_CATALOG: is a non-empty array", () => {
  assert(Array.isArray(BADGE_CATALOG));
  assert(BADGE_CATALOG.length > 0);
});

Deno.test("BADGE_CATALOG: every entry has required BadgeDef shape", () => {
  for (const badge of BADGE_CATALOG) {
    assert(typeof badge.id === "string" && badge.id.length > 0, `badge.id invalid: ${badge.id}`);
    assert(typeof badge.role === "string", `badge.role invalid for ${badge.id}`);
    assert(typeof badge.tier === "string", `badge.tier invalid for ${badge.id}`);
    assert(typeof badge.name === "string", `badge.name invalid for ${badge.id}`);
    assert(typeof badge.description === "string", `badge.description invalid for ${badge.id}`);
    assert(typeof badge.icon === "string", `badge.icon invalid for ${badge.id}`);
    assert(typeof badge.category === "string", `badge.category invalid for ${badge.id}`);
    assert(typeof badge.xpReward === "number", `badge.xpReward invalid for ${badge.id}`);
    assert(typeof badge.check === "function", `badge.check invalid for ${badge.id}`);
  }
});

Deno.test("BADGE_CATALOG: all badge IDs are unique", () => {
  const ids = BADGE_CATALOG.map((b) => b.id);
  const unique = new Set(ids);
  assertEquals(unique.size, ids.length, "Duplicate badge IDs found");
});

// ---------------------------------------------------------------------------
// BadgeService class
// ---------------------------------------------------------------------------

Deno.test("BadgeService: can be instantiated", () => {
  const svc = new BadgeService();
  assert(svc instanceof BadgeService);
});

Deno.test("BadgeService.checkBadges: returns newly earned badges", () => {
  const svc = new BadgeService();
  const stats: BadgeCheckState = { ...DEFAULT_BADGE_STATS, totalDecisions: 1 };
  const result = svc.checkBadges("reviewer", stats, new Set());
  const ids = result.map((b) => b.id);
  assert(ids.includes("rev_first_blood"), "Expected rev_first_blood to be earned");
});

Deno.test("BadgeService.getBadgeCatalogJson: returns valid JSON string", () => {
  const svc = new BadgeService();
  const jsonStr = svc.getBadgeCatalogJson();
  const parsed = JSON.parse(jsonStr);
  assert(Array.isArray(parsed));
  assert(parsed.length > 0);
});

Deno.test("BadgeService.getBadgeCatalogJson: excludes check function", () => {
  const svc = new BadgeService();
  const parsed = JSON.parse(svc.getBadgeCatalogJson());
  for (const entry of parsed) {
    assertEquals(entry.check, undefined, `check function should be excluded for ${entry.id}`);
  }
});

// ---------------------------------------------------------------------------
// Wrapper: getBadgeCatalogJson matches class method
// ---------------------------------------------------------------------------

Deno.test("getBadgeCatalogJson wrapper matches BadgeService method", () => {
  const svc = new BadgeService();
  assertEquals(getBadgeCatalogJson(), svc.getBadgeCatalogJson());
});

// ---------------------------------------------------------------------------
// checkBadges (wrapper function)
// ---------------------------------------------------------------------------

Deno.test("checkBadges: returns newly earned badges for reviewer role", () => {
  const stats: BadgeCheckState = { ...DEFAULT_BADGE_STATS, totalDecisions: 1 };
  const result = checkBadges("reviewer", stats, new Set());
  const ids = result.map((b) => b.id);
  assert(ids.includes("rev_first_blood"), "Expected rev_first_blood to be earned");
});

Deno.test("checkBadges: does not return already-earned badges", () => {
  const stats: BadgeCheckState = { ...DEFAULT_BADGE_STATS, totalDecisions: 1 };
  const already = new Set(["rev_first_blood"]);
  const result = checkBadges("reviewer", stats, already);
  const ids = result.map((b) => b.id);
  assert(!ids.includes("rev_first_blood"), "Already-earned badge should not be returned");
});

Deno.test("checkBadges: filters to only the given role", () => {
  const stats: BadgeCheckState = { ...DEFAULT_BADGE_STATS, totalDecisions: 1 };
  const result = checkBadges("reviewer", stats, new Set());
  for (const badge of result) {
    assertEquals(badge.role, "reviewer", `Expected reviewer role but got ${badge.role}`);
  }
});

Deno.test("checkBadges: returns multiple badges when multiple thresholds met", () => {
  const stats: BadgeCheckState = { ...DEFAULT_BADGE_STATS, totalDecisions: 1000 };
  const result = checkBadges("reviewer", stats, new Set());
  const ids = result.map((b) => b.id);
  assert(ids.includes("rev_first_blood"), "Expected rev_first_blood");
  assert(ids.includes("rev_centurion"), "Expected rev_centurion");
  assert(ids.includes("rev_grinder"), "Expected rev_grinder");
});

Deno.test("checkBadges: returns empty array when no badges are newly earned", () => {
  const stats: BadgeCheckState = { ...DEFAULT_BADGE_STATS };
  const result = checkBadges("reviewer", stats, new Set());
  assertEquals(result, []);
});

Deno.test("checkBadges: judge role — totalOverturns badge earned correctly", () => {
  const stats: BadgeCheckState = { ...DEFAULT_BADGE_STATS, totalDecisions: 1, totalOverturns: 10 };
  const result = checkBadges("judge", stats, new Set());
  const ids = result.map((b) => b.id);
  assert(ids.includes("jdg_first_verdict"), "Expected jdg_first_verdict");
  assert(ids.includes("jdg_overturn_10"), "Expected jdg_overturn_10");
});

Deno.test("checkBadges: manager role — queueCleared badge earned when flag is true", () => {
  const stats: BadgeCheckState = { ...DEFAULT_BADGE_STATS, totalRemediations: 1, queueCleared: true };
  const result = checkBadges("manager", stats, new Set());
  const ids = result.map((b) => b.id);
  assert(ids.includes("mgr_clear_queue"), "Expected mgr_clear_queue");
});

Deno.test("checkBadges: agent role — honor roll requires auditsForAvg >= 20 AND avgScore >= 90", () => {
  const statsLow: BadgeCheckState = { ...DEFAULT_BADGE_STATS, totalAudits: 1, auditsForAvg: 10, avgScore: 95 };
  const resultLow = checkBadges("agent", statsLow, new Set());
  assert(!resultLow.map((b) => b.id).includes("agt_honor_roll"), "Should not earn honor roll with < 20 auditsForAvg");

  const statsHigh: BadgeCheckState = { ...DEFAULT_BADGE_STATS, totalAudits: 1, auditsForAvg: 20, avgScore: 90 };
  const resultHigh = checkBadges("agent", statsHigh, new Set());
  assert(resultHigh.map((b) => b.id).includes("agt_honor_roll"), "Should earn honor roll when conditions met");
});

Deno.test("checkBadges: reviewer speed demon requires decisionsForAvg >= 50 and avgSpeedMs < 8000", () => {
  const statsSlow: BadgeCheckState = { ...DEFAULT_BADGE_STATS, decisionsForAvg: 50, avgSpeedMs: 9000 };
  const resultSlow = checkBadges("reviewer", statsSlow, new Set());
  assert(!resultSlow.map((b) => b.id).includes("rev_speed_demon"), "Should not earn speed demon when too slow");

  const statsFewDecisions: BadgeCheckState = { ...DEFAULT_BADGE_STATS, decisionsForAvg: 10, avgSpeedMs: 5000 };
  const resultFew = checkBadges("reviewer", statsFewDecisions, new Set());
  assert(!resultFew.map((b) => b.id).includes("rev_speed_demon"), "Should not earn speed demon with < 50 decisionsForAvg");

  const statsFast: BadgeCheckState = { ...DEFAULT_BADGE_STATS, decisionsForAvg: 50, avgSpeedMs: 7999 };
  const resultFast = checkBadges("reviewer", statsFast, new Set());
  assert(resultFast.map((b) => b.id).includes("rev_speed_demon"), "Should earn speed demon when conditions met");
});

Deno.test("checkBadges: already-earned set prevents all matching badges from being returned", () => {
  const stats: BadgeCheckState = { ...DEFAULT_BADGE_STATS, totalDecisions: 1000 };
  const allRevIds = BADGE_CATALOG
    .filter((b) => b.role === "reviewer")
    .map((b) => b.id);
  const alreadyAll = new Set(allRevIds);
  const result = checkBadges("reviewer", stats, alreadyAll);
  assertEquals(result.length, 0, "No new badges when all are already earned");
});
