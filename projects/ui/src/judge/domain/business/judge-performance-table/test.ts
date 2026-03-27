import { assertEquals } from "jsr:@std/assert";
import { JudgePerformanceTable } from "./mod.ts";

Deno.test("JudgePerformanceTable - default judges is empty array", () => {
  const table = new JudgePerformanceTable();
  assertEquals(table.judges, []);
});

Deno.test("JudgePerformanceTable - judges can be set", () => {
  const table = new JudgePerformanceTable();
  const data = [
    { judge: "alice", decisions: 50, upholds: 40, overturns: 10 },
    { judge: "bob", decisions: 30, upholds: 25, overturns: 5 },
  ];
  table.judges = data;
  assertEquals(table.judges.length, 2);
  assertEquals(table.judges[0].judge, "alice");
  assertEquals(table.judges[1].decisions, 30);
});

Deno.test("JudgePerformanceTable - overturnPct calculates correctly", () => {
  const table = new JudgePerformanceTable();
  assertEquals(table.overturnPct(10, 100), "10.0");
  assertEquals(table.overturnPct(0, 50), "0.0");
  assertEquals(table.overturnPct(5, 0), "0.0");
});
