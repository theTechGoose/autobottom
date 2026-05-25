/** Pure-function tests for the gamification lane — the XP formulas.
 *  Integration of the full bumpStats/checkBadges/award/emit pipeline is
 *  covered by smk.test.ts (TODO) and exercised end-to-end by step-finalize. */

import { assertEquals } from "#assert";
import { computeBaseXp } from "./mod.ts";

Deno.test("computeBaseXp — agent baseline (score 50)", () => {
  assertEquals(computeBaseXp({ orgId: "" as any, email: "x", role: "agent", score: 50 }), 15);
});

Deno.test("computeBaseXp — agent high bonus (score 90)", () => {
  // floor(90 * 0.3) = 27; +20 high = 47
  assertEquals(computeBaseXp({ orgId: "" as any, email: "x", role: "agent", score: 90 }), 47);
});

Deno.test("computeBaseXp — agent high bonus (score 95)", () => {
  // floor(95 * 0.3) = 28; +20 high
  assertEquals(computeBaseXp({ orgId: "" as any, email: "x", role: "agent", score: 95 }), 48);
});

Deno.test("computeBaseXp — agent perfect (score 100)", () => {
  // floor(100 * 0.3) = 30; +50 perfect (perfect supersedes high)
  assertEquals(computeBaseXp({ orgId: "" as any, email: "x", role: "agent", score: 100 }), 80);
});

Deno.test("computeBaseXp — agent without score returns 0", () => {
  assertEquals(computeBaseXp({ orgId: "" as any, email: "x", role: "agent" }), 0);
});

Deno.test("computeBaseXp — agent boundary 89 (no bonus)", () => {
  // floor(89 * 0.3) = 26, no bonus
  assertEquals(computeBaseXp({ orgId: "" as any, email: "x", role: "agent", score: 89 }), 26);
});

Deno.test("computeBaseXp — reviewer base + per-question", () => {
  assertEquals(computeBaseXp({ orgId: "" as any, email: "x", role: "reviewer", questionsReviewed: 0 }), 15);
  assertEquals(computeBaseXp({ orgId: "" as any, email: "x", role: "reviewer", questionsReviewed: 5 }), 40);
  assertEquals(computeBaseXp({ orgId: "" as any, email: "x", role: "reviewer", questionsReviewed: 12 }), 75);
});

Deno.test("computeBaseXp — reviewer with no metric defaults to base 15", () => {
  assertEquals(computeBaseXp({ orgId: "" as any, email: "x", role: "reviewer" }), 15);
});

Deno.test("computeBaseXp — judge is flat 20 regardless of overturn", () => {
  assertEquals(computeBaseXp({ orgId: "" as any, email: "x", role: "judge", overturned: true }), 20);
  assertEquals(computeBaseXp({ orgId: "" as any, email: "x", role: "judge", overturned: false }), 20);
});

Deno.test("computeBaseXp — manager base 30", () => {
  assertEquals(computeBaseXp({ orgId: "" as any, email: "x", role: "manager" }), 30);
});

Deno.test("computeBaseXp — manager same-day bonus (under 24h)", () => {
  assertEquals(
    computeBaseXp({ orgId: "" as any, email: "x", role: "manager", remediationLatencyMs: 3_600_000 }),
    50,
  );
});

Deno.test("computeBaseXp — manager no bonus when over 24h", () => {
  assertEquals(
    computeBaseXp({ orgId: "" as any, email: "x", role: "manager", remediationLatencyMs: 25 * 3_600_000 }),
    30,
  );
});

Deno.test("computeBaseXp — manager exact 24h boundary still bonused", () => {
  assertEquals(
    computeBaseXp({ orgId: "" as any, email: "x", role: "manager", remediationLatencyMs: 86_400_000 }),
    50,
  );
});
