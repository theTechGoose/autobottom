import { assertEquals } from "jsr:@std/assert";
import { AgentGameBar } from "./mod.ts";

Deno.test("AgentGameBar - can be instantiated", () => {
  const bar = new AgentGameBar();
  assertEquals(bar instanceof AgentGameBar, true);
});

Deno.test("AgentGameBar - default level is 1", () => {
  const bar = new AgentGameBar();
  assertEquals(bar.level, 1);
});

Deno.test("AgentGameBar - default totalXp is 0", () => {
  const bar = new AgentGameBar();
  assertEquals(bar.totalXp, 0);
});

Deno.test("AgentGameBar - default tokenBalance is 0", () => {
  const bar = new AgentGameBar();
  assertEquals(bar.tokenBalance, 0);
});

Deno.test("AgentGameBar - xpForNextLevel returns correct threshold", () => {
  const bar = new AgentGameBar();
  // Level 1 -> next level threshold is AGENT_LEVELS[2] = 150
  assertEquals(bar.xpForNextLevel, 150);
});

Deno.test("AgentGameBar - xpForNextLevel at max level returns last threshold", () => {
  const bar = new AgentGameBar();
  bar.level = 9;
  assertEquals(bar.xpForNextLevel, 7000);
});

Deno.test("AgentGameBar - xpProgress at 0 xp returns 0", () => {
  const bar = new AgentGameBar();
  bar.level = 0;
  bar.totalXp = 0;
  assertEquals(bar.xpProgress, 0);
});

Deno.test("AgentGameBar - xpProgress calculates correctly mid-level", () => {
  const bar = new AgentGameBar();
  bar.level = 1;
  bar.totalXp = 100;
  // AGENT_LEVELS[1] = 50, AGENT_LEVELS[2] = 150
  // progress = (100 - 50) / (150 - 50) * 100 = 50
  assertEquals(bar.xpProgress, 50);
});

Deno.test("AgentGameBar - xpProgress caps at 100", () => {
  const bar = new AgentGameBar();
  bar.level = 1;
  bar.totalXp = 999;
  assertEquals(bar.xpProgress, 100);
});
