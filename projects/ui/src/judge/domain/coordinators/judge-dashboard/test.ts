import { assertEquals, assertExists } from "jsr:@std/assert";
import { JudgeDashboard } from "./mod.ts";

Deno.test("JudgeDashboard - class can be instantiated", () => {
  const dash = new JudgeDashboard();
  assertExists(dash);
});

Deno.test("JudgeDashboard - default loading is true", () => {
  const dash = new JudgeDashboard();
  assertEquals(dash.loading, true);
});

Deno.test("JudgeDashboard - default error is empty string", () => {
  const dash = new JudgeDashboard();
  assertEquals(dash.error, "");
});

Deno.test("JudgeDashboard - default data is null", () => {
  const dash = new JudgeDashboard();
  assertEquals(dash.data, null);
});

Deno.test("JudgeDashboard - default reviewers is empty array", () => {
  const dash = new JudgeDashboard();
  assertEquals(dash.reviewers, []);
});

Deno.test("JudgeDashboard - default earnedBadges is empty array", () => {
  const dash = new JudgeDashboard();
  assertEquals(dash.earnedBadges, []);
});

Deno.test("JudgeDashboard - has load method", () => {
  const dash = new JudgeDashboard();
  assertEquals(typeof dash.load, "function");
});

Deno.test("JudgeDashboard - has loadReviewers method", () => {
  const dash = new JudgeDashboard();
  assertEquals(typeof dash.loadReviewers, "function");
});

Deno.test("JudgeDashboard - has loadBadges method", () => {
  const dash = new JudgeDashboard();
  assertEquals(typeof dash.loadBadges, "function");
});

Deno.test("JudgeDashboard - badges constant has expected entries", () => {
  const dash = new JudgeDashboard();
  assertEquals(dash.JDG_BADGES.length, 9);
  assertEquals(dash.JDG_BADGES[0].id, "jdg_first_verdict");
  assertEquals(dash.JDG_BADGES[8].id, "jdg_level_10");
});

Deno.test("JudgeDashboard - TIER_COLORS has expected keys", () => {
  const dash = new JudgeDashboard();
  assertEquals(typeof dash.TIER_COLORS.common, "string");
  assertEquals(typeof dash.TIER_COLORS.legendary, "string");
});

Deno.test("JudgeDashboard - isBadgeEarned returns correct value", () => {
  const dash = new JudgeDashboard();
  dash.earnedBadges = ["jdg_first_verdict", "jdg_arbiter"];
  assertEquals(dash.isBadgeEarned("jdg_first_verdict"), true);
  assertEquals(dash.isBadgeEarned("jdg_supreme"), false);
});

Deno.test("JudgeDashboard - earnedBadgeCount returns correct count", () => {
  const dash = new JudgeDashboard();
  dash.earnedBadges = ["jdg_first_verdict", "jdg_arbiter"];
  assertEquals(dash.earnedBadgeCount(), 2);
});
