import { assertEquals } from "jsr:@std/assert";
import { AuditReportsTable } from "./mod.ts";

Deno.test("AuditReportsTable - can be instantiated", () => {
  const table = new AuditReportsTable();
  assertEquals(table instanceof AuditReportsTable, true);
});

Deno.test("AuditReportsTable - default audits is empty array", () => {
  const table = new AuditReportsTable();
  assertEquals(table.audits, []);
});

Deno.test("AuditReportsTable - scoreColor returns green for >= 80", () => {
  const table = new AuditReportsTable();
  assertEquals(table.scoreColor(80), "green");
  assertEquals(table.scoreColor(100), "green");
});

Deno.test("AuditReportsTable - scoreColor returns yellow for >= 60 and < 80", () => {
  const table = new AuditReportsTable();
  assertEquals(table.scoreColor(60), "yellow");
  assertEquals(table.scoreColor(79), "yellow");
});

Deno.test("AuditReportsTable - scoreColor returns red for < 60", () => {
  const table = new AuditReportsTable();
  assertEquals(table.scoreColor(59), "red");
  assertEquals(table.scoreColor(0), "red");
});

Deno.test("AuditReportsTable - formatDate handles missing value", () => {
  const table = new AuditReportsTable();
  assertEquals(table.formatDate(undefined), "--");
});

Deno.test("AuditReportsTable - formatDate formats valid date", () => {
  const table = new AuditReportsTable();
  const result = table.formatDate("2025-03-15T00:00:00Z");
  assertEquals(typeof result, "string");
  assertEquals(result.includes("2025"), true);
});
