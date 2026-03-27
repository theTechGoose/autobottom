import { assertEquals } from "jsr:@std/assert";
import { AuditorStatsTable } from "./mod.ts";

Deno.test("AuditorStatsTable - default auditors is empty array", () => {
  const table = new AuditorStatsTable();
  assertEquals(table.auditors, []);
});

Deno.test("AuditorStatsTable - auditors can be set", () => {
  const table = new AuditorStatsTable();
  const data = [
    { auditor: "carol", totalAppeals: 20, upheld: 15, overturned: 5, overturnRate: "25.0%" },
  ];
  table.auditors = data;
  assertEquals(table.auditors.length, 1);
  assertEquals(table.auditors[0].auditor, "carol");
  assertEquals(table.auditors[0].overturnRate, "25.0%");
});
