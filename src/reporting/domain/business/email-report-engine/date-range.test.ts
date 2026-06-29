/** Unit tests for the weekly date-range window. Pure function, no live
 *  services — asserts the Monday→Sunday window is anchored to Eastern
 *  wall-clock (DST-safe) and resets at Eastern midnight, not UTC. */
import { assertEquals } from "#assert";
import { resolveDateRange } from "./mod.ts";

const WEEKLY = { mode: "weekly", startDay: 1 } as const; // Monday

Deno.test("weekly window — winter (EST, UTC-5): Wed maps to Mon 00:00 → Sun 23:59:59.999 EST", () => {
  // Wed 2026-01-07 09:00 EST
  const now = Date.UTC(2026, 0, 7, 14, 0, 0);
  const { from, to } = resolveDateRange(WEEKLY, now);
  assertEquals(from, Date.UTC(2026, 0, 5, 5, 0, 0, 0)); // Mon 2026-01-05 00:00 EST
  assertEquals(to, Date.UTC(2026, 0, 12, 4, 59, 59, 999)); // Sun 2026-01-11 23:59:59.999 EST
});

Deno.test("weekly window — summer (EDT, UTC-4): DST offset is honored", () => {
  // Wed 2026-07-08 09:00 EDT
  const now = Date.UTC(2026, 6, 8, 13, 0, 0);
  const { from, to } = resolveDateRange(WEEKLY, now);
  assertEquals(from, Date.UTC(2026, 6, 6, 4, 0, 0, 0)); // Mon 2026-07-06 00:00 EDT
  assertEquals(to, Date.UTC(2026, 6, 13, 3, 59, 59, 999)); // Sun 2026-07-12 23:59:59.999 EDT
});

Deno.test("weekly window — Sunday 23:30 EST is still the same (ending) week", () => {
  // Sun 2026-01-11 23:30 EST
  const now = Date.UTC(2026, 0, 12, 4, 30, 0);
  const { from, to } = resolveDateRange(WEEKLY, now);
  assertEquals(from, Date.UTC(2026, 0, 5, 5, 0, 0, 0)); // still Mon 2026-01-05
  assertEquals(to, Date.UTC(2026, 0, 12, 4, 59, 59, 999)); // through Sun 2026-01-11
});

Deno.test("weekly window — Monday 00:30 EST has reset to the new week", () => {
  // Mon 2026-01-12 00:30 EST
  const now = Date.UTC(2026, 0, 12, 5, 30, 0);
  const { from, to } = resolveDateRange(WEEKLY, now);
  assertEquals(from, Date.UTC(2026, 0, 12, 5, 0, 0, 0)); // Mon 2026-01-12 00:00 EST
  assertEquals(to, Date.UTC(2026, 0, 19, 4, 59, 59, 999)); // Sun 2026-01-18 23:59:59.999 EST
});

Deno.test("rolling + fixed modes are unaffected (use the injected now)", () => {
  const now = 1_700_000_000_000;
  assertEquals(resolveDateRange({ mode: "rolling", hours: 24 }, now), { from: now - 86_400_000, to: now });
  assertEquals(resolveDateRange({ mode: "fixed", from: 100, to: 200 }, now), { from: 100, to: 200 });
});
