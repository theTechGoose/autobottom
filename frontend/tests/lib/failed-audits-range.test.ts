import { assert, assertEquals } from "@std/assert";
import {
  isoWeekParts,
  isoWeekRange,
  parseIsoWeek,
  weekOptions,
  resolveFaRange,
} from "../../lib/failed-audits-range.ts";

const MS_DAY = 86_400_000;
const MS_WEEK = 7 * MS_DAY;

// ── isoWeekParts: ISO-8601 year/week boundary cases ──────────────────────────
// The tricky bits: a week belongs to the ISO year of its Thursday, so late-Dec
// dates can fall in the next year's W01 and early-Jan dates in the prior year's
// W52/W53.

Deno.test("isoWeekParts — Mon 2021-01-04 is 2021-W01", () => {
  assertEquals(isoWeekParts(Date.UTC(2021, 0, 4)), { year: 2021, week: 1 });
});

Deno.test("isoWeekParts — Thu 2020-12-31 belongs to 2020-W53 (53-week year)", () => {
  assertEquals(isoWeekParts(Date.UTC(2020, 11, 31)), { year: 2020, week: 53 });
});

Deno.test("isoWeekParts — Thu 2026-01-01 belongs to 2026-W01 (week starts Mon 2025-12-29)", () => {
  assertEquals(isoWeekParts(Date.UTC(2026, 0, 1)), { year: 2026, week: 1 });
});

// ── isoWeekRange: structural invariants ──────────────────────────────────────

Deno.test("isoWeekRange — since is Monday 00:00 UTC; span is exactly 7d − 1ms", () => {
  for (const [y, w] of [[2021, 1], [2020, 53], [2026, 1], [2024, 26]] as const) {
    const { since, until } = isoWeekRange(y, w);
    const d = new Date(since);
    assertEquals(d.getUTCDay(), 1, `week ${y}-W${w} must start on a Monday`);
    assertEquals(
      [d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()],
      [0, 0, 0, 0],
      `week ${y}-W${w} must start at 00:00:00.000`,
    );
    assertEquals(until - since, MS_WEEK - 1);
  }
});

Deno.test("isoWeekRange — 2021-W01 starts Mon 2021-01-04", () => {
  assertEquals(isoWeekRange(2021, 1).since, Date.UTC(2021, 0, 4));
});

// ── round-trip: a timestamp falls inside the range of its own ISO week ────────

Deno.test("round-trip — isoWeekRange(isoWeekParts(t)) brackets t", () => {
  const samples = [
    Date.UTC(2026, 0, 1),                 // Jan 1 — year boundary
    Date.UTC(2025, 11, 28, 23, 59, 59),   // Sunday, late
    Date.UTC(2024, 5, 12, 13, 30),        // mid-year, midday
    Date.UTC(2021, 0, 4, 0, 0, 0),        // Monday 00:00 — lower edge
  ];
  for (const t of samples) {
    const { year, week } = isoWeekParts(t);
    const { since, until } = isoWeekRange(year, week);
    assert(
      since <= t && t <= until,
      `t=${new Date(t).toISOString()} not within ${year}-W${week}`,
    );
  }
});

// ── parseIsoWeek ─────────────────────────────────────────────────────────────

Deno.test("parseIsoWeek — valid token matches isoWeekRange bounds", () => {
  const r = parseIsoWeek("2021-W01");
  assert(r);
  const { since, until } = isoWeekRange(2021, 1);
  assertEquals(r!.since, since);
  assertEquals(r!.until, until);
});

Deno.test("parseIsoWeek — malformed tokens → null", () => {
  for (const bad of ["2021-1", "garbage", "", "2021W01", "21-W01", "2021-Wxx"]) {
    assertEquals(parseIsoWeek(bad), null, `"${bad}" should not parse`);
  }
});

Deno.test("parseIsoWeek — out-of-range week → null", () => {
  assertEquals(parseIsoWeek("2021-W00"), null);
  assertEquals(parseIsoWeek("2021-W54"), null);
});

// ── weekOptions ──────────────────────────────────────────────────────────────

Deno.test("weekOptions — count, current-first, strictly descending, value=YYYY-Www", () => {
  const now = Date.UTC(2026, 0, 15, 12, 0, 0);
  const opts = weekOptions(now, 16);
  assertEquals(opts.length, 16);

  const cur = isoWeekParts(now);
  assertEquals(opts[0].value, `${cur.year}-W${String(cur.week).padStart(2, "0")}`);

  for (let i = 1; i < opts.length; i++) {
    const prev = parseIsoWeek(opts[i - 1].value)!;
    const next = parseIsoWeek(opts[i].value)!;
    assert(next.since < prev.since, `option ${i} should be an earlier week than ${i - 1}`);
  }
});

// ── resolveFaRange (reads Date.now() internally → assert shape/relative) ──────

Deno.test("resolveFaRange — all-time spans from epoch", () => {
  const r = resolveFaRange("all-time");
  assertEquals(r.since, 0);
  assertEquals(r.label, "All Time");
  assert(r.until > 0);
});

Deno.test("resolveFaRange — this-week starts Monday 00:00 UTC and runs to now", () => {
  const r = resolveFaRange("this-week");
  assertEquals(new Date(r.since).getUTCDay(), 1);
  assert(r.since <= r.until);
  assert(r.until - r.since < MS_WEEK);
  assert(r.label.startsWith("This Week ("));
});

Deno.test("resolveFaRange — last-week is a full ISO week", () => {
  const r = resolveFaRange("last-week");
  assertEquals(r.until - r.since, MS_WEEK - 1);
  assertEquals(new Date(r.since).getUTCDay(), 1);
  assert(r.label.startsWith("Last Week ("));
});

Deno.test("resolveFaRange — last-month ends 1ms before this month starts", () => {
  const last = resolveFaRange("last-month");
  const thisMonth = resolveFaRange("this-month");
  assertEquals(last.until, thisMonth.since - 1);
  const d = new Date(last.since);
  assertEquals(d.getUTCDate(), 1);
  assertEquals(
    [d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()],
    [0, 0, 0, 0],
  );
  assertEquals(last.label, "Last Month");
});

Deno.test("resolveFaRange — unknown preset falls back to this-week", () => {
  const fallback = resolveFaRange("not-a-real-preset");
  const thisWeek = resolveFaRange("this-week");
  assertEquals(fallback.since, thisWeek.since);
  assert(fallback.label.startsWith("This Week ("));
});
