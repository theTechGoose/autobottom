import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { RecentDecisionsTable } from "./mod.ts";

Deno.test("RecentDecisionsTable - can be instantiated", () => {
  const table = new RecentDecisionsTable();
  assertEquals(typeof table, "object");
});

Deno.test("RecentDecisionsTable - decisions defaults to empty array", () => {
  const table = new RecentDecisionsTable();
  assertEquals(table.decisions, []);
});

Deno.test("RecentDecisionsTable - decisions can be set", () => {
  const table = new RecentDecisionsTable();
  const data = [{ finding: "abc123", question: "#1", decision: "confirm", reviewer: "alice", time: "2m ago" }];
  table.decisions = data;
  assertEquals(table.decisions.length, 1);
  assertEquals(table.decisions[0].finding, "abc123");
});
