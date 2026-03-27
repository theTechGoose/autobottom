import { assertEquals, assertExists } from "jsr:@std/assert";
import { ReviewDashboard } from "./mod.ts";

Deno.test("ReviewDashboard - can be instantiated", () => {
  const dashboard = new ReviewDashboard();
  assertExists(dashboard);
});

Deno.test("ReviewDashboard - loading defaults to true", () => {
  const dashboard = new ReviewDashboard();
  assertEquals(dashboard.loading, true);
});

Deno.test("ReviewDashboard - error defaults to empty string", () => {
  const dashboard = new ReviewDashboard();
  assertEquals(dashboard.error, "");
});

Deno.test("ReviewDashboard - currentUser defaults to empty string", () => {
  const dashboard = new ReviewDashboard();
  assertEquals(dashboard.currentUser, "");
});

Deno.test("ReviewDashboard - data defaults to null", () => {
  const dashboard = new ReviewDashboard();
  assertEquals(dashboard.data, null);
});

Deno.test("ReviewDashboard - earnedBadges defaults to empty array", () => {
  const dashboard = new ReviewDashboard();
  assertEquals(dashboard.earnedBadges, []);
});

Deno.test("ReviewDashboard - has load method", () => {
  const dashboard = new ReviewDashboard();
  assertEquals(typeof dashboard.load, "function");
});

Deno.test("ReviewDashboard - has loadBadges method", () => {
  const dashboard = new ReviewDashboard();
  assertEquals(typeof dashboard.loadBadges, "function");
});
