import { assertEquals } from "@std/assert";
import { timeAgo, scoreColor } from "../../lib/format.ts";

Deno.test("timeAgo — just now for < 60s", () => {
  assertEquals(timeAgo(Date.now() - 30_000), "just now");
});

Deno.test("timeAgo — minutes for < 1h", () => {
  assertEquals(timeAgo(Date.now() - 300_000), "5m ago");
});

Deno.test("timeAgo — hours for < 24h", () => {
  assertEquals(timeAgo(Date.now() - 7_200_000), "2h ago");
});

Deno.test("timeAgo — days for >= 24h", () => {
  assertEquals(timeAgo(Date.now() - 172_800_000), "2d ago");
});

Deno.test("timeAgo — em-dash for 0/falsy", () => {
  assertEquals(timeAgo(0), "\u2014");
});

Deno.test("scoreColor — green for >= 90", () => {
  assertEquals(scoreColor(90), "green");
  assertEquals(scoreColor(100), "green");
});

Deno.test("scoreColor — yellow for 70-89, red for < 70", () => {
  assertEquals(scoreColor(85), "yellow");
  assertEquals(scoreColor(70), "yellow");
  assertEquals(scoreColor(69), "red");
  assertEquals(scoreColor(0), "red");
});
