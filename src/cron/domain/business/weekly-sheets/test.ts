/** Tests for weekly sheets date window calculation + cron idempotency. */

import { assertEquals } from "#assert";
import { prevWeekWindow, isWeeklySheetsFireTime, runWeeklySheetsExport } from "./mod.ts";
import { resetFirestoreCredentials } from "@core/data/firestore/mod.ts";

/** Eastern wall clock for an instant — the window is ET-anchored, so asserting
 *  with the runner's local getDay()/getHours() would only pass on an ET box. */
const et = (ms: number) =>
  new Date(ms).toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });

Deno.test("prevWeekWindow — Tuesday's run covers the previous Mon-Sun in ET", () => {
  // Tuesday April 14, 2026, 7am ET (11:00Z, EDT).
  const { since, until } = prevWeekWindow(new Date("2026-04-14T11:00:00Z"));
  assertEquals(et(since), "Mon, 04/06, 00:00:00");
  assertEquals(et(until), "Sun, 04/12, 23:59:59");
});

Deno.test("prevWeekWindow — same week no matter which day it fires", () => {
  // The old form keyed off "yesterday", so a fire-day slip moved the window.
  // Every day of the week of Apr 13-19 must resolve to Apr 6-12.
  for (const day of ["13", "14", "15", "16", "17", "18", "19"]) {
    const { since, until } = prevWeekWindow(new Date(`2026-04-${day}T11:00:00Z`));
    assertEquals(et(since), "Mon, 04/06, 00:00:00", `since drifted on Apr ${day}`);
    assertEquals(et(until), "Sun, 04/12, 23:59:59", `until drifted on Apr ${day}`);
  }
});

Deno.test("prevWeekWindow — spans the spring DST change without losing an hour", () => {
  // US DST began Sun Mar 8, 2026 — inside the Mar 2-8 window this returns.
  const { since, until } = prevWeekWindow(new Date("2026-03-10T11:00:00Z"));
  assertEquals(et(since), "Mon, 03/02, 00:00:00");
  assertEquals(et(until), "Sun, 03/08, 23:59:59");
  // 7 days minus the lost hour, minus the 1ms the end-boundary gives back.
  assertEquals(until - since, 7 * 86_400_000 - 3_600_000 - 1);
});

Deno.test("isWeeklySheetsFireTime — Tuesday 7am ET and after, nothing else", () => {
  assertEquals(isWeeklySheetsFireTime(new Date("2026-04-14T10:59:00Z")), false); // Tue 6:59am ET
  assertEquals(isWeeklySheetsFireTime(new Date("2026-04-14T11:00:00Z")), true);  // Tue 7:00am ET
  assertEquals(isWeeklySheetsFireTime(new Date("2026-04-14T15:00:00Z")), true);  // Tue 11am ET — catch-up
  assertEquals(isWeeklySheetsFireTime(new Date("2026-04-15T11:00:00Z")), false); // Wed
  assertEquals(isWeeklySheetsFireTime(new Date("2026-04-12T11:00:00Z")), false); // Sun — the old misfire day
  // Standard time: 7am ET is 12:00Z, so a fixed-UTC-hour schedule would slip.
  assertEquals(isWeeklySheetsFireTime(new Date("2026-01-13T12:00:00Z")), true);  // Tue 7:00am EST
  assertEquals(isWeeklySheetsFireTime(new Date("2026-01-13T11:00:00Z")), false); // Tue 6:00am EST
});

Deno.test("runWeeklySheetsExport — claims the week so a re-fire is skipped (no double-post)", async () => {
  resetFirestoreCredentials(); // in-memory firestore
  const now = new Date("2026-04-13T13:00:00Z");
  // First run takes the per-week claim. (Sheets aren't configured in tests, so
  // the export itself returns a config error — but the claim is taken first.)
  await runWeeklySheetsExport(now);
  // Second run for the same week must be skipped, never re-appending rows.
  const second = await runWeeklySheetsExport(now);
  assertEquals(second.skipped, true);
  assertEquals(second.appended, 0);
});
