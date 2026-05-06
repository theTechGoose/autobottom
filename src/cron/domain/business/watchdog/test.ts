/** Tests for watchdog stuck-finding detection logic. */

import { assertEquals, assert } from "#assert";

interface StuckFinding {
  orgId: string; findingId: string; step: string; ts: number; ageMs: number;
}

/** Pure detection logic extracted for testing (no KV dependency). */
function detectStuck(
  entries: Array<{ orgId: string; findingId: string; step: string; ts: number }>,
  now: number,
  thresholdMs: number,
): StuckFinding[] {
  return entries
    .map((e) => ({ ...e, ageMs: now - e.ts }))
    .filter((e) => e.ageMs > thresholdMs);
}

Deno.test("watchdog — detects stuck findings over threshold", () => {
  const now = Date.now();
  const entries = [
    { orgId: "o1", findingId: "f1", step: "transcribe", ts: now - 35 * 60 * 1000 }, // 35 min old
    { orgId: "o1", findingId: "f2", step: "ask-all", ts: now - 5 * 60 * 1000 },     // 5 min old (ok)
    { orgId: "o1", findingId: "f3", step: "finalize", ts: now - 60 * 60 * 1000 },   // 60 min old
  ];
  const stuck = detectStuck(entries, now, 30 * 60 * 1000);
  assertEquals(stuck.length, 2);
  assertEquals(stuck[0].findingId, "f1");
  assertEquals(stuck[1].findingId, "f3");
});

Deno.test("watchdog — no stuck findings returns empty", () => {
  const now = Date.now();
  const entries = [
    { orgId: "o1", findingId: "f1", step: "init", ts: now - 1000 },
  ];
  assertEquals(detectStuck(entries, now, 30 * 60 * 1000).length, 0);
});

Deno.test("watchdog — empty entries returns empty", () => {
  assertEquals(detectStuck([], Date.now(), 30 * 60 * 1000).length, 0);
});

Deno.test("watchdog — ageMs calculated correctly", () => {
  const now = 100_000;
  const entries = [{ orgId: "o1", findingId: "f1", step: "init", ts: 50_000 }];
  const stuck = detectStuck(entries, now, 10_000);
  assertEquals(stuck[0].ageMs, 50_000);
});
