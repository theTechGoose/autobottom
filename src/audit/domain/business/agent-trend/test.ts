import { assertEquals, assert } from "#assert";
import { bucketWeeklyTrend } from "./mod.ts";

const DAY = 24 * 60 * 60 * 1000;

function fixedNow(): number {
  // Pin to a deterministic instant: noon UTC, 2026-04-15 (Wed).
  // Local-time bucketing depends on the test machine's timezone, so we anchor
  // assertions to the boundary math rather than absolute date strings where
  // possible.
  return new Date("2026-04-15T12:00:00Z").getTime();
}

Deno.test("bucketWeeklyTrend — empty input gives 7 zero buckets", () => {
  const out = bucketWeeklyTrend([], fixedNow());
  assertEquals(out.length, 7);
  assert(out.every((b) => b.avgScore === 0 && b.count === 0));
});

Deno.test("bucketWeeklyTrend — last bucket holds today's audits", () => {
  const now = fixedNow();
  const out = bucketWeeklyTrend(
    [
      { completedAt: now, score: 100 },
      { completedAt: now - 1000, score: 80 },
    ],
    now,
  );
  assertEquals(out[6].count, 2);
  assertEquals(out[6].avgScore, 90); // (100 + 80) / 2
});

Deno.test("bucketWeeklyTrend — averages multiple audits per day", () => {
  const now = fixedNow();
  const yesterday = now - DAY;
  const out = bucketWeeklyTrend(
    [
      { completedAt: yesterday, score: 70 },
      { completedAt: yesterday + 60_000, score: 80 },
      { completedAt: yesterday + 120_000, score: 90 },
    ],
    now,
  );
  assertEquals(out[5].count, 3);
  assertEquals(out[5].avgScore, 80);
});

Deno.test("bucketWeeklyTrend — drops audits older than 7 days", () => {
  const now = fixedNow();
  const out = bucketWeeklyTrend(
    [
      { completedAt: now - 10 * DAY, score: 100 },  // way too old
      { completedAt: now - 6 * DAY, score: 50 },    // edge — within window
    ],
    now,
  );
  // Sum of all counts should be 1 (only the 6-day-old audit landed)
  const totalCount = out.reduce((s, b) => s + b.count, 0);
  assertEquals(totalCount, 1);
});

Deno.test("bucketWeeklyTrend — empty days have count=0 and avgScore=0", () => {
  const now = fixedNow();
  const out = bucketWeeklyTrend(
    [{ completedAt: now, score: 100 }],
    now,
  );
  // Today filled, the other six should be zeroes.
  assertEquals(out[6].count, 1);
  for (let i = 0; i < 6; i++) {
    assertEquals(out[i].count, 0);
    assertEquals(out[i].avgScore, 0);
  }
});

Deno.test("bucketWeeklyTrend — date strings are unique and chronological", () => {
  const out = bucketWeeklyTrend([], fixedNow());
  const dates = out.map((b) => b.date);
  assertEquals(new Set(dates).size, 7);
  for (let i = 0; i < 6; i++) assert(dates[i] < dates[i + 1]);
});
