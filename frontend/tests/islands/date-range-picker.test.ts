/** Preset windows for the audit-history date picker.
 *
 *  Boundaries are the viewer's LOCAL day — a manager asking for "today" means
 *  their today — so these build the expectations from local Date parts too. */
import { assertEquals } from "@std/assert";
import { presetRange, rangeLabel } from "../../islands/DateRangePicker.tsx";

/** Thursday 2026-07-30, 14:30 local. */
const NOW = new Date(2026, 6, 30, 14, 30, 0, 0);
const at = (y: number, m: number, d: number, h = 0, mi = 0, s = 0, ms = 0) =>
  new Date(y, m, d, h, mi, s, ms).getTime();

Deno.test("Today — local midnight through now", () => {
  const [since, until] = presetRange("today", NOW);
  assertEquals(since, at(2026, 6, 30));
  assertEquals(until, NOW.getTime());
});

Deno.test("This week — Monday midnight through now", () => {
  const [since, until] = presetRange("week", NOW);
  assertEquals(since, at(2026, 6, 27), "Mon 2026-07-27");
  assertEquals(until, NOW.getTime());
});

Deno.test("Last week — previous Monday through Sunday 23:59:59.999", () => {
  const [since, until] = presetRange("lastweek", NOW);
  assertEquals(since, at(2026, 6, 20), "Mon 2026-07-20");
  assertEquals(until, at(2026, 6, 26, 23, 59, 59, 999), "Sun 2026-07-26 end of day");
});

Deno.test("This/last week on a Sunday reach back to Monday, not forward", () => {
  // getDay() is Sunday-based, so Sunday is the case that breaks naive math.
  const sunday = new Date(2026, 7, 2, 9, 0, 0, 0);
  assertEquals(presetRange("week", sunday)[0], at(2026, 6, 27), "week started Mon 07-27");
  const [lwSince, lwUntil] = presetRange("lastweek", sunday);
  assertEquals(lwSince, at(2026, 6, 20));
  assertEquals(lwUntil, at(2026, 6, 26, 23, 59, 59, 999));
});

Deno.test("This/last week on a Monday: this week starts today, last week is the 7 days before", () => {
  const monday = new Date(2026, 6, 27, 8, 0, 0, 0);
  assertEquals(presetRange("week", monday)[0], at(2026, 6, 27));
  assertEquals(presetRange("lastweek", monday)[0], at(2026, 6, 20));
  assertEquals(presetRange("lastweek", monday)[1], at(2026, 6, 26, 23, 59, 59, 999));
});

Deno.test("Rolling and all-time windows", () => {
  const nowMs = NOW.getTime();
  assertEquals(presetRange("7d", NOW), [nowMs - 7 * 86_400_000, nowMs]);
  assertEquals(presetRange("30d", NOW), [nowMs - 30 * 86_400_000, nowMs]);
  assertEquals(presetRange("all", NOW), [0, nowMs], "all-time starts at the epoch");
});

Deno.test("rangeLabel — reads as a range, and says so for all-time", () => {
  const label = rangeLabel(at(2026, 6, 27), at(2026, 6, 31));
  assertEquals(label.includes("→"), true);
  assertEquals(label.startsWith("Jul 27"), true);
  assertEquals(rangeLabel(0, at(2026, 6, 31)).startsWith("All time"), true);
});
