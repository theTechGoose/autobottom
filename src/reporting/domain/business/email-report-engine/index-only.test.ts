/** Phase 2 guard: the report engine builds rows straight from the audit index
 *  (department / shift / score / voName / appealStatus) WITHOUT hydrating the
 *  finding — and still falls back to hydration when a report needs question-
 *  level criteria or the guestName column. We prove "no hydration" by writing
 *  an index row but NO finding doc: if the engine still hydrated, getFinding
 *  would be null and the row would be dropped. */
import { assertEquals } from "#assert";
import { queryReportData } from "./mod.ts";
import { writeAuditDoneIndex, _resetQueryAuditDoneIndexCacheForTests } from "@audit/domain/data/stats-repository/mod.ts";
import { resetFirestoreCredentials } from "@core/data/firestore/mod.ts";

const COLUMNS = ["finalizedAt", "voName", "department", "score", "recordId", "findingId"];

Deno.test({ name: "queryReportData — builds rows from the index with NO finding hydration", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  _resetQueryAuditDoneIndexCacheForTests();
  const ORG = "test-idxonly-" + crypto.randomUUID().slice(0, 8);
  const now = Date.now();

  // A reviewed, completed internal audit on the index — but NO finding doc saved.
  await writeAuditDoneIndex(ORG as any, {
    findingId: "f1", completedAt: now, doneAt: now, completed: true, reason: "reviewed",
    score: 80, recordId: "R1", voName: "Jane Doe", department: "DEPT-A", shift: "AM", isPackage: false,
  } as any, { assumeFinished: true });

  const config = {
    name: "t", recipients: ["x@y.com"],
    reportSections: [{ header: "t", columns: COLUMNS, criteria: [] }],
    dateRange: { mode: "fixed", from: now - 1000, to: now + 1000 },
    onlyCompleted: true,
    topLevelFilters: [
      { field: "auditType", operator: "equals", value: "internal" },
      { field: "department", operator: "equals", value: "DEPT-A" },
      { field: "shift", operator: "equals", value: "AM" },
      { field: "appealStatus", operator: "not_equals", value: "pending" },
    ],
  };

  const sections = await queryReportData(ORG as any, config as any);
  assertEquals(sections.length, 1);
  assertEquals(sections[0].rows.length, 1, "row built from the index without a finding doc");
  const row = sections[0].rows[0];
  assertEquals(row.department, "DEPT-A");
  assertEquals(row.voName, "Jane Doe");
  assertEquals(row.score, 80);
  assertEquals(row.recordId, "R1");
  assertEquals(row.findingId, "f1");
}});

Deno.test({ name: "queryReportData — wrong department/shift filters drop the index row (no hydration needed)", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  _resetQueryAuditDoneIndexCacheForTests();
  const ORG = "test-idxfilter-" + crypto.randomUUID().slice(0, 8);
  const now = Date.now();
  await writeAuditDoneIndex(ORG as any, {
    findingId: "f1", completedAt: now, doneAt: now, completed: true, reason: "reviewed",
    score: 80, recordId: "R1", voName: "Jane", department: "DEPT-A", shift: "AM", isPackage: false,
  } as any, { assumeFinished: true });

  const config = {
    name: "t", recipients: ["x@y.com"],
    reportSections: [{ header: "t", columns: COLUMNS, criteria: [] }],
    dateRange: { mode: "fixed", from: now - 1000, to: now + 1000 },
    onlyCompleted: true,
    topLevelFilters: [{ field: "department", operator: "equals", value: "DEPT-B" }],
  };
  const sections = await queryReportData(ORG as any, config as any);
  assertEquals(sections[0].rows.length, 0, "department mismatch filtered out via index fields");
}});

Deno.test({ name: "queryReportData — shift-criteria sections group audits by shift (the all-shifts report), no hydration", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  _resetQueryAuditDoneIndexCacheForTests();
  const ORG = "test-shiftsec-" + crypto.randomUUID().slice(0, 8);
  const now = Date.now();
  // Same department, two shifts — and no finding docs (proves index-only).
  await writeAuditDoneIndex(ORG as any, {
    findingId: "fa", completedAt: now, doneAt: now, completed: true, reason: "reviewed",
    score: 90, recordId: "RA", voName: "Amy", department: "DEPT-A", shift: "AM", isPackage: false,
  } as any, { assumeFinished: true });
  await writeAuditDoneIndex(ORG as any, {
    findingId: "fp", completedAt: now, doneAt: now, completed: true, reason: "reviewed",
    score: 70, recordId: "RP", voName: "Pat", department: "DEPT-A", shift: "PM", isPackage: false,
  } as any, { assumeFinished: true });

  const config = {
    name: "t", recipients: ["x@y.com"],
    reportSections: [
      { header: "AM", columns: ["voName", "score"], criteria: [{ field: "shift", operator: "equals", value: "AM" }] },
      { header: "PM", columns: ["voName", "score"], criteria: [{ field: "shift", operator: "equals", value: "PM" }] },
    ],
    dateRange: { mode: "fixed", from: now - 1000, to: now + 1000 },
    onlyCompleted: true,
    topLevelFilters: [{ field: "department", operator: "equals", value: "DEPT-A" }],
  };
  const sections = await queryReportData(ORG as any, config as any);
  assertEquals(sections.map((s) => s.header), ["AM", "PM"]);
  assertEquals(sections[0].rows.map((r) => r.voName), ["Amy"]);
  assertEquals(sections[1].rows.map((r) => r.voName), ["Pat"]);
}});

Deno.test({ name: "queryReportData — guestName column forces finding hydration (row dropped when finding absent)", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  _resetQueryAuditDoneIndexCacheForTests();
  const ORG = "test-needsfind-" + crypto.randomUUID().slice(0, 8);
  const now = Date.now();
  await writeAuditDoneIndex(ORG as any, {
    findingId: "f2", completedAt: now, doneAt: now, completed: true, reason: "reviewed",
    score: 80, recordId: "R2", voName: "Bob", department: "DEPT-B", isPackage: false,
  } as any, { assumeFinished: true });

  const config = {
    name: "t", recipients: ["x@y.com"],
    reportSections: [{ header: "t", columns: ["guestName", "voName"], criteria: [] }],
    dateRange: { mode: "fixed", from: now - 1000, to: now + 1000 },
    onlyCompleted: true,
  };
  const sections = await queryReportData(ORG as any, config as any);
  // guestName isn't on the index → engine hydrates → finding absent → row skipped.
  assertEquals(sections[0].rows.length, 0, "guestName report hydrates; no finding → no row");
}});
