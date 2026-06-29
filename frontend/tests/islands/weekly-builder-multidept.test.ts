/** Unit tests for the multi-department report logic in the Weekly Builder:
 *  resolving a config's department set, marking every covered department as
 *  published, auto-naming, one-section-per-department layout, and merging
 *  staged reports into one combined report. */
import { assertEquals } from "@std/assert";
import {
  autoNameForDepts,
  buildMultiSections,
  coversDept,
  deptsOfConfig,
  deptsOfStaged,
  mergeDepartments,
  multiDeptFilters,
  sameDeptSet,
} from "../../islands/WeeklyBuilderEditor.tsx";

Deno.test("deptsOfConfig — multi list wins; else the single dept; else empty", () => {
  assertEquals(deptsOfConfig({ weeklyDepartments: ["DS MB", "DS FTL"] }), ["DS MB", "DS FTL"]);
  assertEquals(deptsOfConfig({ weeklyDepartment: "Conf" }), ["Conf"]);
  assertEquals(deptsOfConfig({ weeklyDepartment: "Conf", weeklyDepartments: ["A", "B"] }), ["A", "B"]);
  assertEquals(deptsOfConfig({}), []);
});

Deno.test("deptsOfStaged — multi list wins; else the single dept; else empty", () => {
  assertEquals(deptsOfStaged({ departments: ["GS MB", "VO MB"] }), ["GS MB", "VO MB"]);
  assertEquals(deptsOfStaged({ department: "ODS" }), ["ODS"]);
  assertEquals(deptsOfStaged({}), []);
});

Deno.test("coversDept — marks every department of a multi-dept report as published (all-shifts)", () => {
  const cfg = { weeklyType: "internal", weeklyDepartments: ["DS MB", "DS FTL"] };
  assertEquals(coversDept(cfg, "DS MB", null), true);
  assertEquals(coversDept(cfg, "DS FTL", null), true);
  assertEquals(coversDept(cfg, "ODS", null), false);
});

Deno.test("coversDept — single-dept config still works (back-compat)", () => {
  const cfg = { weeklyType: "internal", weeklyDepartment: "Conf" };
  assertEquals(coversDept(cfg, "Conf", null), true);
  assertEquals(coversDept(cfg, "Conf", "AM"), false); // all-shifts report ≠ a specific-shift row
});

Deno.test("coversDept — shift must match; partner configs never cover internal depts", () => {
  assertEquals(coversDept({ weeklyType: "internal", weeklyDepartment: "ODR", weeklyShift: "AM" }, "ODR", "AM"), true);
  assertEquals(coversDept({ weeklyType: "internal", weeklyDepartment: "ODR", weeklyShift: "AM" }, "ODR", null), false);
  assertEquals(coversDept({ weeklyType: "partner", weeklyOffice: "ECG" } as never, "ECG", null), false);
});

Deno.test("sameDeptSet — order-insensitive set equality", () => {
  assertEquals(sameDeptSet(["A", "B"], ["B", "A"]), true);
  assertEquals(sameDeptSet(["A", "B"], ["A"]), false);
  assertEquals(sameDeptSet([], []), true);
});

Deno.test("autoNameForDepts — joins departments with ' + '", () => {
  assertEquals(autoNameForDepts("Weekly Audit Summary", ["DS MB", "DS FTL"]), "Weekly Audit Summary — DS MB + DS FTL");
  assertEquals(autoNameForDepts("X", ["ODS"]), "X — ODS");
});

Deno.test("buildMultiSections — one section per department, each filtered to that department", () => {
  const secs = buildMultiSections(["GS MB", "VO MB"]);
  assertEquals(secs.length, 2);
  assertEquals(secs[0].header, "GS MB");
  assertEquals(secs[0].criteria, [{ field: "department", operator: "equals", value: "GS MB" }]);
  assertEquals(secs[1].criteria, [{ field: "department", operator: "equals", value: "VO MB" }]);
  // every section carries the standard columns
  assertEquals(secs[0].columns.includes("voName"), true);
});

Deno.test("multiDeptFilters — internal audit type + drop pending appeals, no single-dept filter", () => {
  assertEquals(multiDeptFilters(), [
    { field: "auditType", operator: "equals", value: "internal" },
    { field: "appealStatus", operator: "not_equals", value: "pending" },
  ]);
});

Deno.test("mergeDepartments — unions staged items (single + multi), dedupes, keeps first-seen order", () => {
  const merged = mergeDepartments([
    { department: "GS MB" },
    { departments: ["VO MB", "IDS"] },
    { department: "GS MB" }, // dup ignored
  ]);
  assertEquals(merged, ["GS MB", "VO MB", "IDS"]);
});
