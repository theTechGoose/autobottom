import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ReviewerPerformanceTable } from "./mod.ts";

Deno.test("ReviewerPerformanceTable - can be instantiated", () => {
  const table = new ReviewerPerformanceTable();
  assertEquals(typeof table, "object");
});

Deno.test("ReviewerPerformanceTable - reviewers defaults to empty array", () => {
  const table = new ReviewerPerformanceTable();
  assertEquals(table.reviewers, []);
});

Deno.test("ReviewerPerformanceTable - reviewers can be set", () => {
  const table = new ReviewerPerformanceTable();
  const data = [{ reviewer: "alice@test.com", total: 50, confirmed: 30, flipped: 20, accuracy: "60%" }];
  table.reviewers = data;
  assertEquals(table.reviewers.length, 1);
  assertEquals(table.reviewers[0].reviewer, "alice@test.com");
});
