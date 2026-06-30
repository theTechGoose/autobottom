/** Tests for email-report-engine business logic. */
import { assert, assertEquals } from "#assert";
import {
  buildCsv,
  dedupeByRecordKeepNewest,
  findingUrl,
  recordUrl,
  trimSectionsForEmail,
  weeklyReportSlug,
  resolveDateRange,
  queryReportData,
} from "./mod.ts";
import type { SectionResult } from "./mod.ts";
import { writeAuditDoneIndex, _resetQueryAuditDoneIndexCacheForTests } from "@audit/domain/data/stats-repository/mod.ts";
import { resetFirestoreCredentials } from "@core/data/firestore/mod.ts";
import type { AuditDoneIndexEntry } from "@core/dto/types.ts";

function idxEntry(findingId: string, recordId: string, completedAt: number, score: number): AuditDoneIndexEntry {
  return { findingId, recordId, completedAt, score, completed: true };
}

Deno.test("dedupeByRecordKeepNewest — re-audit: keeps the newest finding per record, drops the nullified one", () => {
  const out = dedupeByRecordKeepNewest([
    idxEntry("old0pct", "485896", 1000, 0),   // the nullified 0% (older)
    idxEntry("new96pct", "485896", 2000, 96),  // the re-audit (newer)
  ]);
  assertEquals(out.length, 1);
  assertEquals(out[0].findingId, "new96pct");
  assertEquals(out[0].score, 96);
});

Deno.test("dedupeByRecordKeepNewest — distinct records all survive", () => {
  const out = dedupeByRecordKeepNewest([
    idxEntry("a", "485800", 1000, 100),
    idxEntry("b", "485801", 1000, 84),
    idxEntry("c", "485802", 1000, 72),
  ]);
  assertEquals(out.length, 3);
});

Deno.test("dedupeByRecordKeepNewest — blank/placeholder recordIds are NOT collapsed", () => {
  const out = dedupeByRecordKeepNewest([
    idxEntry("x", "", 1000, 0),
    idxEntry("y", "00000000", 1000, 0),
    idxEntry("z", "   ", 1000, 0),
  ]);
  assertEquals(out.length, 3); // none share a real recordId, so none are dropped
});

Deno.test("dedupeByRecordKeepNewest — newest wins regardless of input order", () => {
  const out = dedupeByRecordKeepNewest([
    idxEntry("new", "R1", 5000, 96),
    idxEntry("old", "R1", 1000, 0),
  ]);
  assertEquals(out.length, 1);
  assertEquals(out[0].findingId, "new");
});

Deno.test("dedupeByRecordKeepNewest — equal completedAt: deterministic tiebreak by findingId (greater wins), order-independent", () => {
  // Same record, identical completedAt — the survivor must NOT depend on input
  // order. Tiebreak keeps the lexicographically greater findingId ("zzz").
  const forward = dedupeByRecordKeepNewest([
    idxEntry("aaa", "R1", 1000, 50),
    idxEntry("zzz", "R1", 1000, 90),
  ]);
  const reversed = dedupeByRecordKeepNewest([
    idxEntry("zzz", "R1", 1000, 90),
    idxEntry("aaa", "R1", 1000, 50),
  ]);
  assertEquals(forward.length, 1);
  assertEquals(reversed.length, 1);
  assertEquals(forward[0].findingId, "zzz");
  assertEquals(reversed[0].findingId, "zzz"); // same winner either way → deterministic
});

Deno.test("dedupeByRecordKeepNewest — undefined completedAt loses to a real one; two undefined fall back to findingId", () => {
  // `?? 0`: an entry with a missing completedAt is treated as oldest, so a real
  // timestamp always supersedes it.
  const out = dedupeByRecordKeepNewest([
    { findingId: "noTs", recordId: "R1", score: 0, completed: true } as AuditDoneIndexEntry,
    idxEntry("hasTs", "R1", 10, 80),
  ]);
  assertEquals(out.length, 1);
  assertEquals(out[0].findingId, "hasTs");

  // Both missing completedAt → 0 === 0 tie → findingId tiebreak ("b" > "a").
  const bothMissing = dedupeByRecordKeepNewest([
    { findingId: "a", recordId: "R2", score: 0, completed: true } as AuditDoneIndexEntry,
    { findingId: "b", recordId: "R2", score: 0, completed: true } as AuditDoneIndexEntry,
  ]);
  assertEquals(bothMissing.length, 1);
  assertEquals(bothMissing[0].findingId, "b");
});

Deno.test("dedupeByRecordKeepNewest — preserves input order (drops superseded rows in place, no reshuffle)", () => {
  // Index order is by completedAt; dedup must keep that order, not hoist the
  // blank-record rows to the front. Winners stay at their own positions.
  const out = dedupeByRecordKeepNewest([
    idxEntry("blank1", "", 1000, 0),
    idxEntry("rOld", "R1", 2000, 40),   // superseded → dropped
    idxEntry("blank2", "", 3000, 0),
    idxEntry("rNew", "R1", 4000, 95),   // winner → stays in place
  ]);
  assertEquals(out.map((e) => e.findingId), ["blank1", "blank2", "rNew"]);
});

Deno.test("email-report-engine — placeholder test", () => {
  assert(true, "email-report-engine test placeholder");
});

const COLS = ["finalizedAt", "voName", "department", "score", "recordId", "findingId"] as const;
function section(header: string, n: number): SectionResult {
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      finalizedAt: 1782000000000 + i * 60000,
      voName: "Marlon Murcia",
      department: header,
      score: 100,
      recordId: String(484960 + i),
      findingId: "fid" + i,
    });
  }
  return { header, columns: [...COLS], rows };
}

Deno.test("weeklyReportSlug — deterministic per (report, week), differs across weeks/reports", async () => {
  const a = await weeklyReportSlug("org", "cfg-1", 1_000);
  const b = await weeklyReportSlug("org", "cfg-1", 1_000); // same → same slug
  const otherWeek = await weeklyReportSlug("org", "cfg-1", 2_000);
  const otherReport = await weeklyReportSlug("org", "cfg-2", 1_000);
  assertEquals(a, b);
  assert(a !== otherWeek, "different week → different slug");
  assert(a !== otherReport, "different report → different slug");
  assert(/^[0-9a-f]{24}$/.test(a), "slug is 24 hex chars, unguessable");
});

Deno.test("buildCsv — clean id columns + appended URL columns", () => {
  const csv = buildCsv([section("DS MB", 2)]);
  const lines = csv.trim().split("\r\n");
  const header = lines[0];
  assert(header.includes("Record ID URL"), "has Record ID URL column");
  assert(header.includes("Audit Report URL"), "has Audit Report URL column");
  // First data row: the id cell stays clean, the URL cell carries the link.
  const row = lines[1];
  assert(row.includes(",484960,"), "record id stays a plain value");
  assert(row.includes("quickbase.com"), "record URL column populated");
  assert(row.includes("/audit/report?id=fid0"), "audit report URL column populated");
});

Deno.test("buildCsv — no URL columns when those id columns aren't in the report", () => {
  const csv = buildCsv([{ header: "x", columns: ["voName", "score"], rows: [{ voName: "A", score: 100 }] }]);
  assert(!csv.includes("Record ID URL"));
  assert(!csv.includes("Audit Report URL"));
});

Deno.test("trimSectionsForEmail — spreads the budget across sections (even split)", () => {
  const { sections, shown, total } = trimSectionsForEmail([section("A", 25), section("B", 25)], 30);
  assertEquals(total, 50);
  assertEquals(shown, 30);
  assertEquals(sections[0].rows.length, 15); // 30 split across 2 sections → 15 each
  assertEquals(sections[1].rows.length, 15);
});

Deno.test("trimSectionsForEmail — a section with audits NEVER shows as empty (the WST Inbound bug)", () => {
  // 74 + 107 = 181, budget 30 → both sections must show rows, neither starved to 0.
  const { sections, shown } = trimSectionsForEmail([section("IDS A3N", 74), section("GS WST", 107)], 30);
  assertEquals(shown, 30);
  assert(sections[0].rows.length > 0, "IDS A3N shows rows");
  assert(sections[1].rows.length > 0, "GS WST shows rows (not a false 'No records')");
});

Deno.test("trimSectionsForEmail — small sections fill fully, only truly-empty stay empty", () => {
  const { sections, shown } = trimSectionsForEmail([section("tiny", 2), section("empty", 0), section("big", 100)], 10);
  assertEquals(sections[0].rows.length, 2); // tiny shows all it has
  assertEquals(sections[1].rows.length, 0); // genuinely empty → stays empty (correct "No records")
  assertEquals(sections[2].rows.length, 8); // big gets the rest
  assertEquals(shown, 10);
});

Deno.test("recordUrl / findingUrl — point at QuickBase and the audit-report page", () => {
  assert(recordUrl("485817").startsWith("https://monsterrg.quickbase.com/"));
  assert(recordUrl("485817").endsWith("485817"));
  assert(findingUrl("abc").includes("/audit/report?id=abc"));
});

// ── resolveDateRange — weekly window anchored to Eastern wall-clock (DST-safe) ─
// Pure function, no live services; asserts the Monday→Sunday window resets at
// Eastern midnight, not UTC. (Merged from the former date-range.test.ts.)

const WEEKLY = { mode: "weekly", startDay: 1 } as const; // Monday

Deno.test("weekly window — winter (EST, UTC-5): Wed maps to Mon 00:00 → Sun 23:59:59.999 EST", () => {
  const now = Date.UTC(2026, 0, 7, 14, 0, 0); // Wed 2026-01-07 09:00 EST
  const { from, to } = resolveDateRange(WEEKLY, now);
  assertEquals(from, Date.UTC(2026, 0, 5, 5, 0, 0, 0)); // Mon 2026-01-05 00:00 EST
  assertEquals(to, Date.UTC(2026, 0, 12, 4, 59, 59, 999)); // Sun 2026-01-11 23:59:59.999 EST
});

Deno.test("weekly window — summer (EDT, UTC-4): DST offset is honored", () => {
  const now = Date.UTC(2026, 6, 8, 13, 0, 0); // Wed 2026-07-08 09:00 EDT
  const { from, to } = resolveDateRange(WEEKLY, now);
  assertEquals(from, Date.UTC(2026, 6, 6, 4, 0, 0, 0)); // Mon 2026-07-06 00:00 EDT
  assertEquals(to, Date.UTC(2026, 6, 13, 3, 59, 59, 999)); // Sun 2026-07-12 23:59:59.999 EDT
});

Deno.test("weekly window — Sunday 23:30 EST is still the same (ending) week", () => {
  const now = Date.UTC(2026, 0, 12, 4, 30, 0); // Sun 2026-01-11 23:30 EST
  const { from, to } = resolveDateRange(WEEKLY, now);
  assertEquals(from, Date.UTC(2026, 0, 5, 5, 0, 0, 0)); // still Mon 2026-01-05
  assertEquals(to, Date.UTC(2026, 0, 12, 4, 59, 59, 999)); // through Sun 2026-01-11
});

Deno.test("weekly window — Monday 00:30 EST has reset to the new week", () => {
  const now = Date.UTC(2026, 0, 12, 5, 30, 0); // Mon 2026-01-12 00:30 EST
  const { from, to } = resolveDateRange(WEEKLY, now);
  assertEquals(from, Date.UTC(2026, 0, 12, 5, 0, 0, 0)); // Mon 2026-01-12 00:00 EST
  assertEquals(to, Date.UTC(2026, 0, 19, 4, 59, 59, 999)); // Sun 2026-01-18 23:59:59.999 EST
});

Deno.test("rolling + fixed modes are unaffected (use the injected now)", () => {
  const now = 1_700_000_000_000;
  assertEquals(resolveDateRange({ mode: "rolling", hours: 24 }, now), { from: now - 86_400_000, to: now });
  assertEquals(resolveDateRange({ mode: "fixed", from: 100, to: 200 }, now), { from: 100, to: 200 });
});

// ── queryReportData — index-only row building (no finding hydration) ──────────
// Proves rows are built straight from the audit index (department / shift /
// score / voName / appealStatus) WITHOUT hydrating the finding — by writing an
// index row but NO finding doc — and still falls back to hydration when a
// report needs the guestName column. (Merged from the former index-only.test.ts.)

const IDX_COLUMNS = ["finalizedAt", "voName", "department", "score", "recordId", "findingId"];

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
    reportSections: [{ header: "t", columns: IDX_COLUMNS, criteria: [] }],
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
    reportSections: [{ header: "t", columns: IDX_COLUMNS, criteria: [] }],
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

Deno.test({ name: "queryReportData — dedup runs BEFORE failedOnly: a fail→pass re-audit is judged on its newest result", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  _resetQueryAuditDoneIndexCacheForTests();
  const ORG = "test-dedup-failed-" + crypto.randomUUID().slice(0, 8);
  const now = Date.now();
  const at = (offset: number) => now + offset;
  const seed = async (findingId: string, recordId: string, completedAt: number, score: number) => {
    await writeAuditDoneIndex(ORG as any, {
      findingId, completedAt, doneAt: completedAt, completed: true, reason: "reviewed",
      score, recordId, voName: "VO", department: "DEPT-A", isPackage: false,
    } as any, { assumeFinished: true });
  };

  // RWIN: failed first, re-audited to a pass — newest is 100, so a failedOnly
  // report must NOT include it (dedup drops the old fail before failedOnly runs).
  await seed("rwin-old-fail", "RWIN", at(-2000), 40);
  await seed("rwin-new-pass", "RWIN", at(-1000), 100);
  // RP2F: passed first, re-audited to a fail — newest is 55, so it SHOULD appear.
  await seed("rp2f-old-pass", "RP2F", at(-2000), 100);
  await seed("rp2f-new-fail", "RP2F", at(-1000), 55);
  // RFAIL: a plain single failing audit — the control that always appears.
  await seed("rfail", "RFAIL", at(-1500), 60);

  const config = {
    name: "t", recipients: ["x@y.com"],
    reportSections: [{ header: "t", columns: IDX_COLUMNS, criteria: [] }],
    dateRange: { mode: "fixed", from: at(-5000), to: at(5000) },
    onlyCompleted: true,
    failedOnly: true,
  };

  const sections = await queryReportData(ORG as any, config as any);
  const ids = sections[0].rows.map((r) => r.recordId).sort();
  // If dedup ran AFTER failedOnly, RWIN's old 40% would survive → ["RFAIL","RP2F","RWIN"].
  assertEquals(ids, ["RFAIL", "RP2F"], "fail→pass re-audit (RWIN) is excluded; pass→fail (RP2F) and plain fail (RFAIL) remain");
}});
