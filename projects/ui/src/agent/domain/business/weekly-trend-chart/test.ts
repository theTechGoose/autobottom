import { assertEquals } from "jsr:@std/assert";
import { WeeklyTrendChart } from "./mod.ts";

Deno.test("WeeklyTrendChart - can be instantiated", () => {
  const chart = new WeeklyTrendChart();
  assertEquals(chart instanceof WeeklyTrendChart, true);
});

Deno.test("WeeklyTrendChart - default weeklyData is empty array", () => {
  const chart = new WeeklyTrendChart();
  assertEquals(chart.weeklyData, []);
});

Deno.test("WeeklyTrendChart - maxValue returns 0 for empty data", () => {
  const chart = new WeeklyTrendChart();
  assertEquals(chart.maxValue, 0);
});

Deno.test("WeeklyTrendChart - maxValue returns highest value", () => {
  const chart = new WeeklyTrendChart();
  chart.weeklyData = [
    { label: "W1", value: 30 },
    { label: "W2", value: 85 },
    { label: "W3", value: 60 },
  ];
  assertEquals(chart.maxValue, 85);
});

Deno.test("WeeklyTrendChart - maxValue with single item", () => {
  const chart = new WeeklyTrendChart();
  chart.weeklyData = [{ label: "W1", value: 42 }];
  assertEquals(chart.maxValue, 42);
});
