import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AdminChartPanel } from "./mod.ts";

Deno.test("AdminChartPanel - default completedTs is empty array", () => {
  const panel = new AdminChartPanel();
  assertEquals(panel.completedTs, []);
});

Deno.test("AdminChartPanel - default errorsTs is empty array", () => {
  const panel = new AdminChartPanel();
  assertEquals(panel.errorsTs, []);
});

Deno.test("AdminChartPanel - default retriesTs is empty array", () => {
  const panel = new AdminChartPanel();
  assertEquals(panel.retriesTs, []);
});

Deno.test("AdminChartPanel - default reviewPending is 0", () => {
  const panel = new AdminChartPanel();
  assertEquals(panel.reviewPending, 0);
});

Deno.test("AdminChartPanel - default reviewDecided is 0", () => {
  const panel = new AdminChartPanel();
  assertEquals(panel.reviewDecided, 0);
});

Deno.test("AdminChartPanel - has drawActivityChart method", () => {
  const panel = new AdminChartPanel();
  assertEquals(typeof panel.drawActivityChart, "function");
});

Deno.test("AdminChartPanel - has drawDonut method", () => {
  const panel = new AdminChartPanel();
  assertEquals(typeof panel.drawDonut, "function");
});
