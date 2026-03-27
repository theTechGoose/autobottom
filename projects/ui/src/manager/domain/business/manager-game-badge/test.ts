import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ManagerGameBadge } from "./mod.ts";

Deno.test("ManagerGameBadge - default level is 1", () => {
  const badge = new ManagerGameBadge();
  assertEquals(badge.level, 1);
});

Deno.test("ManagerGameBadge - default totalXp is 0", () => {
  const badge = new ManagerGameBadge();
  assertEquals(badge.totalXp, 0);
});

Deno.test("ManagerGameBadge - default tokenBalance is 0", () => {
  const badge = new ManagerGameBadge();
  assertEquals(badge.tokenBalance, 0);
});

Deno.test("ManagerGameBadge - default badges is empty array", () => {
  const badge = new ManagerGameBadge();
  assertEquals(badge.badges, []);
});

Deno.test("ManagerGameBadge - xpForNextLevel computes from thresholds", () => {
  const badge = new ManagerGameBadge();
  badge.level = 1;
  // MANAGER_LEVEL_THRESHOLDS[2] = 300
  assertEquals(badge.xpForNextLevel, 300);
});

Deno.test("ManagerGameBadge - xpForNextLevel at level 0", () => {
  const badge = new ManagerGameBadge();
  badge.level = 0;
  // MANAGER_LEVEL_THRESHOLDS[1] = 100
  assertEquals(badge.xpForNextLevel, 100);
});

Deno.test("ManagerGameBadge - xpForNextLevel at max level returns last threshold", () => {
  const badge = new ManagerGameBadge();
  badge.level = 20; // beyond array
  // Should return the last threshold value
  assertEquals(badge.xpForNextLevel, 6500);
});

Deno.test("ManagerGameBadge - xpProgress at 0 xp level 0 is 0", () => {
  const badge = new ManagerGameBadge();
  badge.level = 0;
  badge.totalXp = 0;
  assertEquals(badge.xpProgress, 0);
});

Deno.test("ManagerGameBadge - xpProgress at 50 xp level 0 is 50%", () => {
  const badge = new ManagerGameBadge();
  badge.level = 0;
  badge.totalXp = 50;
  // thresholds[0]=0, thresholds[1]=100, range=100, (50-0)/100 = 50%
  assertEquals(badge.xpProgress, 50);
});

Deno.test("ManagerGameBadge - xpProgress caps at 100", () => {
  const badge = new ManagerGameBadge();
  badge.level = 0;
  badge.totalXp = 200; // over threshold[1]=100
  assertEquals(badge.xpProgress, 100);
});

Deno.test("ManagerGameBadge - level can be set", () => {
  const badge = new ManagerGameBadge();
  badge.level = 5;
  assertEquals(badge.level, 5);
});
