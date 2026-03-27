import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ManagerStatsBar } from "./mod.ts";

Deno.test("ManagerStatsBar - default outstanding is 0", () => {
  const bar = new ManagerStatsBar();
  assertEquals(bar.outstanding, 0);
});

Deno.test("ManagerStatsBar - default addressedThisWeek is 0", () => {
  const bar = new ManagerStatsBar();
  assertEquals(bar.addressedThisWeek, 0);
});

Deno.test("ManagerStatsBar - default totalAudits is 0", () => {
  const bar = new ManagerStatsBar();
  assertEquals(bar.totalAudits, 0);
});

Deno.test("ManagerStatsBar - default avgResolution is '--'", () => {
  const bar = new ManagerStatsBar();
  assertEquals(bar.avgResolution, "--");
});

Deno.test("ManagerStatsBar - outstanding can be set", () => {
  const bar = new ManagerStatsBar();
  bar.outstanding = 42;
  assertEquals(bar.outstanding, 42);
});

Deno.test("ManagerStatsBar - addressedThisWeek can be set", () => {
  const bar = new ManagerStatsBar();
  bar.addressedThisWeek = 15;
  assertEquals(bar.addressedThisWeek, 15);
});

Deno.test("ManagerStatsBar - totalAudits can be set", () => {
  const bar = new ManagerStatsBar();
  bar.totalAudits = 1200;
  assertEquals(bar.totalAudits, 1200);
});

Deno.test("ManagerStatsBar - avgResolution can be set", () => {
  const bar = new ManagerStatsBar();
  bar.avgResolution = "2h 30m";
  assertEquals(bar.avgResolution, "2h 30m");
});
