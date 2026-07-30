/** Shape-only test for getAuditHistory — keeps the feature folder spec-compliant
 *  (every business/<feature>/ must have mod.ts + test.ts).
 *
 *  The real coverage is integration-shaped (queries audit-done-idx, hydrates from
 *  Firestore, joins reviewed/appeal state, scopes by manager dept/shift), which
 *  belongs in an int.test.ts when we add one. This file pins the exported surface
 *  so renames or signature drift fail fast. */
import { assert, assertEquals } from "#assert";
import { appealStatusFromIndex, getAuditHistory, rollupByDepartment } from "./mod.ts";

Deno.test("audit-history — getAuditHistory is exported and callable", () => {
  assert(typeof getAuditHistory === "function");
});

// appealStatusFromIndex decides whether the page slice can skip a per-row
// getAppeal() read. Getting it wrong shows the wrong appeal badge (or hides a
// real appeal), so each case is pinned.

Deno.test("appealStatusFromIndex — 'none' resolves to null, never a badge", () => {
  // The frontend renders a pill for any truthy status, so "none" leaking
  // through as a string would paint an appeal badge on un-appealed audits.
  assertEquals(appealStatusFromIndex("none"), { resolved: true, status: null });
});

Deno.test("appealStatusFromIndex — pending and complete pass through unchanged", () => {
  // These two strings are exactly what the queue/table renderer matches on.
  assertEquals(appealStatusFromIndex("pending"), { resolved: true, status: "pending" });
  assertEquals(appealStatusFromIndex("complete"), { resolved: true, status: "complete" });
});

Deno.test("appealStatusFromIndex — an unstamped row falls back to the live appeal", () => {
  // Index rows written before appealStatus existed have no opinion; the caller
  // MUST read the appeal doc for these or old audits lose their badge.
  assertEquals(appealStatusFromIndex(undefined), { resolved: false });
});

// rollupByDepartment IS unit-testable (pure), and it feeds the Operations
// Portal's all-departments overview — the numbers an ops manager compares
// their teams by, so wrong ones are worse than none.

Deno.test("rollupByDepartment — counts audits and averages scores per department", () => {
  const rows = rollupByDepartment([
    { department: "ODS WFH", score: 100 },
    { department: "ODS WFH", score: 90 },
    { department: "GS WFH", score: 80 },
  ]);
  assertEquals(rows.map((r) => [r.department, r.count, r.avgScore]), [
    ["GS WFH", 1, 80],
    ["ODS WFH", 2, 95],
  ]);
});

Deno.test("rollupByDepartment — only a perfect 100 counts as a pass", () => {
  // The whole app draws the line here (terminate email, chargeback report), so
  // a 99 is a failed audit, not a rounding-friendly pass.
  const [dept] = rollupByDepartment([
    { department: "ODS WFH", score: 100 },
    { department: "ODS WFH", score: 100 },
    { department: "ODS WFH", score: 99 },
    { department: "ODS WFH", score: 40 },
  ]);
  assertEquals(dept.passed, 2);
  assertEquals(dept.failed, 2);
  assertEquals(dept.failPct, 50);
});

Deno.test("rollupByDepartment — failPct is over SCORED audits, not every audit", () => {
  const [dept] = rollupByDepartment([
    { department: "GS WFH", score: 100 },
    { department: "GS WFH", score: 50 },
    { department: "GS WFH" },
  ]);
  assertEquals(dept.count, 3);       // all three audits
  assertEquals(dept.passed + dept.failed, 2); // only two are scored
  assertEquals(dept.failPct, 50);    // 1 of 2, not 1 of 3
});

Deno.test("rollupByDepartment — failPct is null, never 0, when nothing is scored", () => {
  // A department with no scored audits must not display a reassuring 0% fail.
  const [dept] = rollupByDepartment([{ department: "NIGHT SHIFT" }]);
  assertEquals(dept.failPct, null);
  assertEquals(dept.avgScore, null);
});

Deno.test("rollupByDepartment — worst member is the lowest average, with their audit count", () => {
  const [dept] = rollupByDepartment([
    { department: "ODS WFH", voName: "Ana", score: 100 },
    { department: "ODS WFH", voName: "Ana", score: 90 },
    { department: "ODS WFH", voName: "Bo", score: 60 },
    { department: "ODS WFH", voName: "Bo", score: 80 },
  ]);
  assertEquals(dept.worstMember, { name: "Bo", avgScore: 70, audits: 2 });
});

Deno.test("rollupByDepartment — worst member falls back to the owner's email local-part", () => {
  const [dept] = rollupByDepartment([
    { department: "ODS WFH", owner: "jane.doe@x.com", score: 50 },
    { department: "ODS WFH", voName: "Ana", score: 100 },
  ]);
  assertEquals(dept.worstMember?.name, "jane.doe");
});

Deno.test("rollupByDepartment — the 'api' owner is never named the weakest member", () => {
  // API-triggered audits carry the literal "api" as owner. That's not a person
  // and must never be shown as a department's worst performer.
  const [dept] = rollupByDepartment([
    { department: "ODS WFH", owner: "api", score: 10 },
    { department: "ODS WFH", voName: "Ana", score: 90 },
  ]);
  assertEquals(dept.worstMember, { name: "Ana", avgScore: 90, audits: 1 });
});

Deno.test("rollupByDepartment — worst member is null when nobody has a scored audit", () => {
  const [dept] = rollupByDepartment([{ department: "GS WFH", voName: "Ana" }]);
  assertEquals(dept.worstMember, null);
});

Deno.test("rollupByDepartment — a tie on average prefers the better-evidenced member", () => {
  const [dept] = rollupByDepartment([
    { department: "ODS WFH", voName: "Ana", score: 60 },
    { department: "ODS WFH", voName: "Bo", score: 60 },
    { department: "ODS WFH", voName: "Bo", score: 60 },
  ]);
  assertEquals(dept.worstMember, { name: "Bo", avgScore: 60, audits: 2 });
});

Deno.test("rollupByDepartment — top misses are per department, ranked, capped at 3", () => {
  const rows = rollupByDepartment(
    [
      { findingId: "f1", department: "ODS WFH", score: 50 },
      { findingId: "f2", department: "ODS WFH", score: 50 },
      { findingId: "f3", department: "GS WFH", score: 50 },
    ],
    [
      { findingId: "f1", questionKey: "q1", header: "Verified the account" },
      { findingId: "f2", questionKey: "q1", header: "Verified the account" },
      { findingId: "f1", questionKey: "q2", header: "Offered a rebuttal" },
      { findingId: "f1", questionKey: "q3", header: "Used the closing script" },
      { findingId: "f1", questionKey: "q4", header: "Confirmed the address" },
      // Another department's miss must not leak into ODS WFH's list.
      { findingId: "f3", questionKey: "q9", header: "Greeting" },
    ],
  );
  const ods = rows.find((r) => r.department === "ODS WFH")!;
  assertEquals(ods.topMissed.length, 3);
  assertEquals(ods.topMissed[0], { header: "Verified the account", count: 2 });
  assertEquals(rows.find((r) => r.department === "GS WFH")!.topMissed, [{ header: "Greeting", count: 1 }]);
});

Deno.test("rollupByDepartment — a failed row for an unknown finding is ignored", () => {
  // Outside the filtered window / another manager's scope — must not create a
  // department or inflate a miss count.
  const rows = rollupByDepartment(
    [{ findingId: "f1", department: "ODS WFH", score: 50 }],
    [{ findingId: "ghost", questionKey: "q1", header: "Greeting" }],
  );
  assertEquals(rows.length, 1);
  assertEquals(rows[0].topMissed, []);
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
  assertEquals(rows[0].department, "ODS WFH");
  assertEquals(rows[0].count, 1);
  assertEquals(rows[0].avgScore, 90);
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
