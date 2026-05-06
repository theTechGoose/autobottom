/** Tests for weekly sheets date window calculation. */

import { assertEquals } from "#assert";
import { prevWeekWindow } from "./mod.ts";

Deno.test("prevWeekWindow — Monday gives previous Mon-Sun", () => {
  // Monday April 13, 2026
  const monday = new Date("2026-04-13T11:00:00Z");
  const { since, until } = prevWeekWindow(monday);
  const sinceDate = new Date(since);
  const untilDate = new Date(until);
  // Should be April 6 (Mon) through April 12 (Sun)
  assertEquals(sinceDate.getDay(), 1); // Monday
  assertEquals(untilDate.getDay(), 0); // Sunday
});

Deno.test("prevWeekWindow — Tuesday gives Tue-Mon (yesterday back 6 days)", () => {
  // Tuesday April 14, 2026 — yesterday = Monday April 13
  const tuesday = new Date("2026-04-14T11:00:00Z");
  const { since, until } = prevWeekWindow(tuesday);
  const sinceDate = new Date(since);
  const untilDate = new Date(until);
  // until = yesterday (Monday) end of day, since = 6 days before that (Tuesday)
  assertEquals(untilDate.getDay(), 1); // Monday
  assertEquals(sinceDate.getDay(), 2); // Tuesday
});

Deno.test("prevWeekWindow — since is start of day, until is end of day", () => {
  const now = new Date("2026-04-13T15:00:00Z");
  const { since, until } = prevWeekWindow(now);
  const sinceDate = new Date(since);
  const untilDate = new Date(until);
  assertEquals(sinceDate.getHours(), 0);
  assertEquals(sinceDate.getMinutes(), 0);
  assertEquals(untilDate.getHours(), 23);
  assertEquals(untilDate.getMinutes(), 59);
});
