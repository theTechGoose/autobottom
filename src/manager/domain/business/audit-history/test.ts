/** Shape-only test for getAuditHistory — keeps the feature folder spec-compliant
 *  (every business/<feature>/ must have mod.ts + test.ts).
 *
 *  The real coverage is integration-shaped (queries audit-done-idx, hydrates from
 *  Firestore, joins reviewed/appeal state, scopes by manager dept/shift), which
 *  belongs in an int.test.ts when we add one. This file pins the exported surface
 *  so renames or signature drift fail fast. */
import { assert, assertEquals } from "#assert";
import { getAuditHistory, rollupByDepartment } from "./mod.ts";

Deno.test("audit-history — getAuditHistory is exported and callable", () => {
  assert(typeof getAuditHistory === "function");
});

// rollupByDepartment IS unit-testable (pure), and it feeds the Operations
// Portal's all-departments overview — the numbers an ops manager compares
// their teams by, so wrong ones are worse than none.

Deno.test("rollupByDepartment — counts audits and averages scores per department", () => {
  assertEquals(
    rollupByDepartment([
      { department: "ODS WFH", score: 100 },
      { department: "ODS WFH", score: 90 },
      { department: "GS WFH", score: 80 },
    ]),
    [
      { department: "GS WFH", count: 1, avgScore: 80 },
      { department: "ODS WFH", count: 2, avgScore: 95 },
    ],
  );
});

Deno.test("rollupByDepartment — averages only the scored rows, but counts them all", () => {
  const [ods] = rollupByDepartment([
    { department: "ODS WFH", score: 100 },
    { department: "ODS WFH", score: 50 },
    { department: "ODS WFH" },
    { department: "ODS WFH", score: null },
  ]);
  assertEquals(ods.count, 4);
  assertEquals(ods.avgScore, 75);
});

Deno.test("rollupByDepartment — a department with no scores averages null, never 0", () => {
  // 0% would read as "this team is failing everything" rather than "no data".
  const [dept] = rollupByDepartment([{ department: "NIGHT SHIFT" }, { department: "NIGHT SHIFT", score: null }]);
  assertEquals(dept.count, 2);
  assertEquals(dept.avgScore, null);
});

Deno.test("rollupByDepartment — rows with no department are skipped, not bucketed as ''", () => {
  const rows = rollupByDepartment([
    { department: "ODS WFH", score: 90 },
    { score: 10 },
    { department: "", score: 10 },
  ]);
  assertEquals(rows.length, 1);
  assertEquals(rows[0], { department: "ODS WFH", count: 1, avgScore: 90 });
});

Deno.test("rollupByDepartment — average is rounded to one decimal", () => {
  const [dept] = rollupByDepartment([
    { department: "GS WFH", score: 100 },
    { department: "GS WFH", score: 99 },
    { department: "GS WFH", score: 98 },
  ]);
  assertEquals(dept.avgScore, 99);
  const [other] = rollupByDepartment([
    { department: "GS WFH", score: 100 },
    { department: "GS WFH", score: 99 },
  ]);
  assertEquals(other.avgScore, 99.5);
});

Deno.test("rollupByDepartment — empty input yields no rows", () => {
  assertEquals(rollupByDepartment([]), []);
});
