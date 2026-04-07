import { assertEquals } from "jsr:@std/assert";
import {
  DEFAULT_GAME_STATE,
  LEVEL_THRESHOLDS,
  AGENT_LEVEL_THRESHOLDS,
  LevelService,
  getLevel,
} from "./mod.ts";

Deno.test("DEFAULT_GAME_STATE has correct default values", () => {
  assertEquals(DEFAULT_GAME_STATE.totalXp, 0);
  assertEquals(DEFAULT_GAME_STATE.tokenBalance, 0);
  assertEquals(DEFAULT_GAME_STATE.level, 0);
  assertEquals(DEFAULT_GAME_STATE.dayStreak, 0);
  assertEquals(DEFAULT_GAME_STATE.lastActiveDate, "");
  assertEquals(DEFAULT_GAME_STATE.purchases, []);
  assertEquals(DEFAULT_GAME_STATE.equippedTitle, null);
  assertEquals(DEFAULT_GAME_STATE.equippedTheme, null);
  assertEquals(DEFAULT_GAME_STATE.animBindings, {});
});

Deno.test("LEVEL_THRESHOLDS has 10 entries starting at 0", () => {
  assertEquals(LEVEL_THRESHOLDS.length, 10);
  assertEquals(LEVEL_THRESHOLDS[0], 0);
});

Deno.test("AGENT_LEVEL_THRESHOLDS has 10 entries starting at 0", () => {
  assertEquals(AGENT_LEVEL_THRESHOLDS.length, 10);
  assertEquals(AGENT_LEVEL_THRESHOLDS[0], 0);
});

// -- LevelService tests --

Deno.test("LevelService.getLevel returns 0 for xp=0", () => {
  const svc = new LevelService();
  assertEquals(svc.getLevel(0), 0);
});

Deno.test("LevelService.getLevel returns correct level at each threshold boundary", () => {
  const svc = new LevelService();
  // LEVEL_THRESHOLDS = [0, 100, 300, 600, 1000, 1500, 2200, 3200, 4500, 6500]
  assertEquals(svc.getLevel(0), 0);
  assertEquals(svc.getLevel(99), 0);
  assertEquals(svc.getLevel(100), 1);
  assertEquals(svc.getLevel(299), 1);
  assertEquals(svc.getLevel(300), 2);
  assertEquals(svc.getLevel(599), 2);
  assertEquals(svc.getLevel(600), 3);
  assertEquals(svc.getLevel(999), 3);
  assertEquals(svc.getLevel(1000), 4);
  assertEquals(svc.getLevel(1499), 4);
  assertEquals(svc.getLevel(1500), 5);
  assertEquals(svc.getLevel(2199), 5);
  assertEquals(svc.getLevel(2200), 6);
  assertEquals(svc.getLevel(3199), 6);
  assertEquals(svc.getLevel(3200), 7);
  assertEquals(svc.getLevel(4499), 7);
  assertEquals(svc.getLevel(4500), 8);
  assertEquals(svc.getLevel(6499), 8);
  assertEquals(svc.getLevel(6500), 9);
});

Deno.test("LevelService.getLevel returns max level (9) for very high xp", () => {
  const svc = new LevelService();
  assertEquals(svc.getLevel(999999), 9);
});

Deno.test("LevelService.getLevel works with custom thresholds (AGENT_LEVEL_THRESHOLDS)", () => {
  const svc = new LevelService();
  // AGENT_LEVEL_THRESHOLDS = [0, 50, 150, 350, 700, 1200, 2000, 3000, 4500, 7000]
  assertEquals(svc.getLevel(0, AGENT_LEVEL_THRESHOLDS), 0);
  assertEquals(svc.getLevel(49, AGENT_LEVEL_THRESHOLDS), 0);
  assertEquals(svc.getLevel(50, AGENT_LEVEL_THRESHOLDS), 1);
  assertEquals(svc.getLevel(149, AGENT_LEVEL_THRESHOLDS), 1);
  assertEquals(svc.getLevel(150, AGENT_LEVEL_THRESHOLDS), 2);
  assertEquals(svc.getLevel(7000, AGENT_LEVEL_THRESHOLDS), 9);
});

Deno.test("LevelService.getLevel returns 0 for negative xp", () => {
  const svc = new LevelService();
  assertEquals(svc.getLevel(-1), 0);
  assertEquals(svc.getLevel(-100), 0);
});

// -- Wrapper function tests --

Deno.test("Wrapper function getLevel matches class method behavior", () => {
  const svc = new LevelService();
  // Default thresholds
  assertEquals(getLevel(0), svc.getLevel(0));
  assertEquals(getLevel(100), svc.getLevel(100));
  assertEquals(getLevel(6500), svc.getLevel(6500));
  assertEquals(getLevel(999999), svc.getLevel(999999));
  assertEquals(getLevel(-1), svc.getLevel(-1));
  // Custom thresholds
  assertEquals(
    getLevel(50, AGENT_LEVEL_THRESHOLDS),
    svc.getLevel(50, AGENT_LEVEL_THRESHOLDS),
  );
});
