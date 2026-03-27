import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AdminStatsBar } from "./mod.ts";

Deno.test("AdminStatsBar - default inPipeline is 0", () => {
  const bar = new AdminStatsBar();
  assertEquals(bar.inPipeline, 0);
});

Deno.test("AdminStatsBar - default completed24h is 0", () => {
  const bar = new AdminStatsBar();
  assertEquals(bar.completed24h, 0);
});

Deno.test("AdminStatsBar - default errors24h is 0", () => {
  const bar = new AdminStatsBar();
  assertEquals(bar.errors24h, 0);
});

Deno.test("AdminStatsBar - default retries24h is 0", () => {
  const bar = new AdminStatsBar();
  assertEquals(bar.retries24h, 0);
});

Deno.test("AdminStatsBar - default statusDot is 'ok'", () => {
  const bar = new AdminStatsBar();
  assertEquals(bar.statusDot, "ok");
});

Deno.test("AdminStatsBar - default countdown is 30", () => {
  const bar = new AdminStatsBar();
  assertEquals(bar.countdown, 30);
});

Deno.test("AdminStatsBar - properties can be set", () => {
  const bar = new AdminStatsBar();
  bar.inPipeline = 42;
  bar.completed24h = 100;
  bar.errors24h = 5;
  bar.retries24h = 3;
  bar.statusDot = "error";
  bar.countdown = 15;
  assertEquals(bar.inPipeline, 42);
  assertEquals(bar.completed24h, 100);
  assertEquals(bar.errors24h, 5);
  assertEquals(bar.retries24h, 3);
  assertEquals(bar.statusDot, "error");
  assertEquals(bar.countdown, 15);
});
