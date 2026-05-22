/** Cron-presets math — pins DST safety + permissive grammar + POSIX OR. */

import { assert, assertEquals } from "#assert";
import {
  matchesCron, nextFireAt, presetToCron, parseCronToPreset, DEFAULT_TZ,
} from "./mod.ts";

const EST = DEFAULT_TZ;

// Build a UTC ms-epoch for a given wall-clock instant in a tz. Verifies the
// matcher against KNOWN clock positions rather than against `Date.now()`.
function utcMsForWallClock(tz: string, isoLocal: string): number {
  // Trick: walk Intl backwards. Format the candidate UTC ms in tz and adjust
  // until the projected wall-clock matches the target. For our test points
  // (8am-EST on fixed calendar dates) the offset is unambiguous within ~1h,
  // so a single Intl-based adjustment lands.
  const target = new Date(isoLocal + "Z").getTime();
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", hour12: false,
  });
  const projected = (ms: number) => {
    const parts = dtf.formatToParts(new Date(ms));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    let h = get("hour"); if (h === 24) h = 0;
    return Date.UTC(get("year"), get("month") - 1, get("day"), h, get("minute"));
  };
  // Two-pass adjustment is enough for stable tz transitions.
  let candidate = target;
  for (let i = 0; i < 3; i++) {
    candidate = target + (target - projected(candidate));
  }
  return candidate;
}

Deno.test("matchesCron — Daily 8am EST fires at 8am wall-clock in BOTH seasons (DST proof)", () => {
  // Cron: `0 8 * * *` interpreted in America/New_York.
  // January 15 2026 — winter (EST = UTC-5)
  const winter8am = utcMsForWallClock(EST, "2026-01-15T08:00:00.000");
  assert(matchesCron("0 8 * * *", EST, winter8am), "should fire 8am EST in January");

  // June 15 2026 — summer (EDT = UTC-4)
  const summer8am = utcMsForWallClock(EST, "2026-06-15T08:00:00.000");
  assert(matchesCron("0 8 * * *", EST, summer8am), "should fire 8am EST in June");

  // And does NOT fire at 9am wall-clock (the DST-drift footgun)
  const summer9am = utcMsForWallClock(EST, "2026-06-15T09:00:00.000");
  assert(!matchesCron("0 8 * * *", EST, summer9am), "should NOT fire 9am wall-clock");
});

Deno.test("matchesCron — Weekly Monday 8am", () => {
  // 2026-01-12 is a Monday.
  const mon = utcMsForWallClock(EST, "2026-01-12T08:00:00.000");
  assert(matchesCron("0 8 * * 1", EST, mon));
  // 2026-01-13 is a Tuesday — same hour, no fire.
  const tue = utcMsForWallClock(EST, "2026-01-13T08:00:00.000");
  assert(!matchesCron("0 8 * * 1", EST, tue));
});

Deno.test("matchesCron — Monthly 1st 8am", () => {
  const firstOfMonth = utcMsForWallClock(EST, "2026-03-01T08:00:00.000");
  assert(matchesCron("0 8 1 * *", EST, firstOfMonth));
  const secondOfMonth = utcMsForWallClock(EST, "2026-03-02T08:00:00.000");
  assert(!matchesCron("0 8 1 * *", EST, secondOfMonth));
});

Deno.test("matchesCron — Custom weekdays 1-5 @ 9am EST", () => {
  // 2026-01-12 Monday, 9am EST
  const monday = utcMsForWallClock(EST, "2026-01-12T09:00:00.000");
  assert(matchesCron("0 9 * * 1-5", EST, monday));
  // 2026-01-17 Saturday — should NOT fire
  const saturday = utcMsForWallClock(EST, "2026-01-17T09:00:00.000");
  assert(!matchesCron("0 9 * * 1-5", EST, saturday));
});

Deno.test("matchesCron — step `*/15`", () => {
  const t00 = utcMsForWallClock(EST, "2026-01-15T08:00:00.000");
  const t15 = utcMsForWallClock(EST, "2026-01-15T08:15:00.000");
  const t10 = utcMsForWallClock(EST, "2026-01-15T08:10:00.000");
  assert(matchesCron("*/15 * * * *", EST, t00));
  assert(matchesCron("*/15 * * * *", EST, t15));
  assert(!matchesCron("*/15 * * * *", EST, t10));
});

Deno.test("matchesCron — comma list `0,15,30,45`", () => {
  const t00 = utcMsForWallClock(EST, "2026-01-15T08:00:00.000");
  const t15 = utcMsForWallClock(EST, "2026-01-15T08:15:00.000");
  const t10 = utcMsForWallClock(EST, "2026-01-15T08:10:00.000");
  assert(matchesCron("0,15,30,45 * * * *", EST, t00));
  assert(matchesCron("0,15,30,45 * * * *", EST, t15));
  assert(!matchesCron("0,15,30,45 * * * *", EST, t10));
});

Deno.test("matchesCron — Sunday: 0 and 7 are equivalent", () => {
  // 2026-01-11 is a Sunday.
  const sunday = utcMsForWallClock(EST, "2026-01-11T08:00:00.000");
  assert(matchesCron("0 8 * * 0", EST, sunday));
  assert(matchesCron("0 8 * * 7", EST, sunday));
});

Deno.test("matchesCron — POSIX OR for dom × dow", () => {
  // `0 8 15 * 1`: fire if it's the 15th OR it's a Monday at 8am
  // 2026-01-15 is a Thursday (dom matches, dow doesn't → match)
  const t15 = utcMsForWallClock(EST, "2026-01-15T08:00:00.000");
  assert(matchesCron("0 8 15 * 1", EST, t15));
  // 2026-01-12 is a Monday (dow matches, dom doesn't → match)
  const t12 = utcMsForWallClock(EST, "2026-01-12T08:00:00.000");
  assert(matchesCron("0 8 15 * 1", EST, t12));
  // 2026-01-13 is Tuesday the 13th → neither matches
  const t13 = utcMsForWallClock(EST, "2026-01-13T08:00:00.000");
  assert(!matchesCron("0 8 15 * 1", EST, t13));
});

Deno.test("matchesCron — Feb-31 never fires", () => {
  // `0 0 31 * *` should only fire Jan/Mar/May/Jul/Aug/Oct/Dec.
  // Walk every day of Feb 2026 — should be zero matches.
  let fires = 0;
  for (let day = 1; day <= 28; day++) {
    const t = utcMsForWallClock(EST, `2026-02-${String(day).padStart(2, "0")}T00:00:00.000`);
    if (matchesCron("0 0 31 * *", EST, t)) fires++;
  }
  assertEquals(fires, 0);
});

Deno.test("matchesCron — unparseable cron never matches (no throw)", () => {
  const t = utcMsForWallClock(EST, "2026-01-15T08:00:00.000");
  assertEquals(matchesCron("bogus", EST, t), false);
  assertEquals(matchesCron("60 0 1 1 0", EST, t), false); // 60 is out of range
  assertEquals(matchesCron("", EST, t), false);
});

Deno.test("presetToCron — Daily / Weekly / Monthly emit the expected strings", () => {
  assertEquals(presetToCron({ preset: "Daily", timeOfDay: "08:00" }), { cron: "0 8 * * *", tz: EST });
  assertEquals(presetToCron({ preset: "Weekly", dayOfWeek: 1, timeOfDay: "08:00" }), { cron: "0 8 * * 1", tz: EST });
  assertEquals(presetToCron({ preset: "Monthly", dayOfMonth: 15, timeOfDay: "08:00" }), { cron: "0 8 15 * *", tz: EST });
  assertEquals(presetToCron({ preset: "Disabled" }), null);
  assertEquals(presetToCron({ preset: "Custom" }), null);
});

Deno.test("parseCronToPreset — recovers UI shape from canonical cron strings", () => {
  assertEquals(parseCronToPreset("0 8 * * *", EST), { preset: "Daily", timeOfDay: "08:00" });
  assertEquals(parseCronToPreset("0 8 * * 1", EST), { preset: "Weekly", dayOfWeek: 1, timeOfDay: "08:00" });
  assertEquals(parseCronToPreset("0 8 15 * *", EST), { preset: "Monthly", dayOfMonth: 15, timeOfDay: "08:00" });
  // Non-canonical → Custom
  assertEquals(parseCronToPreset("*/15 * * * *", EST).preset, "Custom");
  assertEquals(parseCronToPreset("0 8 * * 1-5", EST).preset, "Custom");
});

Deno.test("nextFireAt — finds the next match within a week", () => {
  // From Monday 8:01am EST, next Daily 8am should be Tuesday 8am.
  const monday801 = utcMsForWallClock(EST, "2026-01-12T08:01:00.000");
  const next = nextFireAt("0 8 * * *", EST, monday801, 60 * 24 * 8);
  assert(next !== null);
  const tuesday8am = utcMsForWallClock(EST, "2026-01-13T08:00:00.000");
  // Allow a 60s slop because of Intl projection rounding.
  assert(Math.abs(next! - tuesday8am) < 60_000, `expected ~${tuesday8am} got ${next}`);
});

Deno.test("nextFireAt — returns null if no match within horizon", () => {
  // Cron that never fires: minute=99 doesn't even parse → null.
  assertEquals(nextFireAt("99 * * * *", EST, Date.now(), 60 * 24), null);
});
