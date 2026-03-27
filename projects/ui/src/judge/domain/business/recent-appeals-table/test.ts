import { assertEquals } from "jsr:@std/assert";
import { RecentAppealsTable } from "./mod.ts";

Deno.test("RecentAppealsTable - default appeals is empty array", () => {
  const table = new RecentAppealsTable();
  assertEquals(table.appeals, []);
});

Deno.test("RecentAppealsTable - appeals can be set", () => {
  const table = new RecentAppealsTable();
  const data = [
    {
      findingId: "abc123",
      auditor: "alice",
      judgedBy: "bob",
      originalScore: 80,
      finalScore: 90,
      overturns: 1,
      timestamp: 1700000000000,
    },
  ];
  table.appeals = data;
  assertEquals(table.appeals.length, 1);
  assertEquals(table.appeals[0].findingId, "abc123");
  assertEquals(table.appeals[0].originalScore, 80);
});

Deno.test("RecentAppealsTable - scoreDelta calculates positive delta", () => {
  const table = new RecentAppealsTable();
  assertEquals(table.scoreDelta(80, 90), "+10%");
});

Deno.test("RecentAppealsTable - scoreDelta calculates negative delta", () => {
  const table = new RecentAppealsTable();
  assertEquals(table.scoreDelta(90, 80), "-10%");
});

Deno.test("RecentAppealsTable - scoreDelta calculates zero delta", () => {
  const table = new RecentAppealsTable();
  assertEquals(table.scoreDelta(80, 80), "0%");
});

Deno.test("RecentAppealsTable - deltaClass returns correct class", () => {
  const table = new RecentAppealsTable();
  assertEquals(table.deltaClass(80, 90), "green");
  assertEquals(table.deltaClass(90, 80), "red");
  assertEquals(table.deltaClass(80, 80), "blue");
});
