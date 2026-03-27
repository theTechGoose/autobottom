import { assertEquals } from "jsr:@std/assert";
import { AgentStatsGrid } from "./mod.ts";

Deno.test("AgentStatsGrid - can be instantiated", () => {
  const grid = new AgentStatsGrid();
  assertEquals(grid instanceof AgentStatsGrid, true);
});

Deno.test("AgentStatsGrid - default totalAudits is 0", () => {
  const grid = new AgentStatsGrid();
  assertEquals(grid.totalAudits, 0);
});

Deno.test("AgentStatsGrid - default averageScore is 0", () => {
  const grid = new AgentStatsGrid();
  assertEquals(grid.averageScore, 0);
});

Deno.test("AgentStatsGrid - default thisWeek is 0", () => {
  const grid = new AgentStatsGrid();
  assertEquals(grid.thisWeek, 0);
});

Deno.test("AgentStatsGrid - default completionRate is '--'", () => {
  const grid = new AgentStatsGrid();
  assertEquals(grid.completionRate, "--");
});
