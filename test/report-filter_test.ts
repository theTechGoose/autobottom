/** Tests for report filtering logic shared across chargeback/wire endpoints.
 *  Validates that unreviewed, bypassed, and perfect-score entries are correctly
 *  excluded from reports, and that chargeback vs omission classification works. */

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

// -- Interfaces --

interface AuditDoneIndexEntry {
  findingId: string;
  completedAt: number;
  score: number;
  completed: boolean;
  isPackage?: boolean;
  department?: string;
}

interface ChargebackEntry {
  findingId: string;
  failedQHeaders: string[];
  destination?: string;
  office?: string;
  score: number;
}

interface WireEntry {
  findingId: string;
  score: number;
  office: string;
}

// -- Pure filtering functions (mirror production logic) --

const CHARGEBACK_QUESTIONS = new Set([
  "Income",
  "MCC Recurring Charges Disclosed?",
  "Married/Cohab Qualifier Question",
  "Single Qualifier Question",
]);

/** Filters index entries for chargeback report (date-leg, completed, failed, non-bypassed). */
function filterForChargebacks(
  entries: AuditDoneIndexEntry[],
  bypassPatterns: string[],
): AuditDoneIndexEntry[] {
  const isBypassed = (dept: string) =>
    bypassPatterns.length > 0 && bypassPatterns.some((p) => dept.toLowerCase().includes(p));
  return entries.filter(
    (e) => e.completed && !e.isPackage && e.score < 100 && !isBypassed(e.department ?? ""),
  );
}

/** Filters index entries for wire deduction report (package, completed, failed, non-bypassed). */
function filterForWire(
  entries: AuditDoneIndexEntry[],
  bypassPatterns: string[],
): AuditDoneIndexEntry[] {
  const isBypassed = (dept: string) =>
    bypassPatterns.length > 0 && bypassPatterns.some((p) => dept.toLowerCase().includes(p));
  return entries.filter(
    (e) => e.completed && e.isPackage && e.score < 100 && !isBypassed(e.department ?? ""),
  );
}

function classifyChargebacks(entries: ChargebackEntry[]): {
  chargebacks: ChargebackEntry[];
  omissions: ChargebackEntry[];
} {
  return {
    chargebacks: entries.filter((e) => e.failedQHeaders.some((h) => CHARGEBACK_QUESTIONS.has(h))),
    omissions: entries.filter((e) => e.failedQHeaders.some((h) => !CHARGEBACK_QUESTIONS.has(h))),
  };
}

// -- Test data factory --

function makeIdx(overrides: Partial<AuditDoneIndexEntry> = {}): AuditDoneIndexEntry {
  return {
    findingId: "f-" + Math.random().toString(36).slice(2, 8),
    completedAt: Date.now(),
    score: 80,
    completed: true,
    isPackage: false,
    department: "Sales",
    ...overrides,
  };
}

// -- Tests: filterForChargebacks --

Deno.test("chargeback filter — excludes unreviewed (completed=false)", () => {
  const entries = [
    makeIdx({ completed: false, score: 80 }),
    makeIdx({ completed: true, score: 80 }),
  ];
  const result = filterForChargebacks(entries, []);
  assertEquals(result.length, 1);
  assert(result[0].completed);
});

Deno.test("chargeback filter — excludes perfect scores (100)", () => {
  const entries = [
    makeIdx({ score: 100, completed: true }),
    makeIdx({ score: 80, completed: true }),
    makeIdx({ score: 0, completed: true }),
  ];
  const result = filterForChargebacks(entries, []);
  assertEquals(result.length, 2);
  assert(result.every((e) => e.score < 100));
});

Deno.test("chargeback filter — excludes package (partner) audits", () => {
  const entries = [
    makeIdx({ isPackage: true, completed: true, score: 80 }),
    makeIdx({ isPackage: false, completed: true, score: 80 }),
  ];
  const result = filterForChargebacks(entries, []);
  assertEquals(result.length, 1);
  assert(!result[0].isPackage);
});

Deno.test("chargeback filter — excludes bypassed offices", () => {
  const entries = [
    makeIdx({ department: "JAY Resort", completed: true, score: 80 }),
    makeIdx({ department: "GUN Lodge", completed: true, score: 80 }),
    makeIdx({ department: "Sales HQ", completed: true, score: 80 }),
  ];
  const result = filterForChargebacks(entries, ["jay", "gun"]);
  assertEquals(result.length, 1);
  assertEquals(result[0].department, "Sales HQ");
});

Deno.test("chargeback filter — bypass is case-insensitive", () => {
  const entries = [
    makeIdx({ department: "JAY RESORT", completed: true, score: 80 }),
    makeIdx({ department: "jay resort", completed: true, score: 80 }),
    makeIdx({ department: "Other", completed: true, score: 80 }),
  ];
  const result = filterForChargebacks(entries, ["jay"]);
  assertEquals(result.length, 1);
  assertEquals(result[0].department, "Other");
});

Deno.test("chargeback filter — empty bypass patterns lets everything through", () => {
  const entries = [
    makeIdx({ department: "JAY", completed: true, score: 80 }),
    makeIdx({ department: "GUN", completed: true, score: 80 }),
  ];
  const result = filterForChargebacks(entries, []);
  assertEquals(result.length, 2);
});

// -- Tests: filterForWire --

Deno.test("wire filter — only includes package audits", () => {
  const entries = [
    makeIdx({ isPackage: true, completed: true, score: 80 }),
    makeIdx({ isPackage: false, completed: true, score: 80 }),
  ];
  const result = filterForWire(entries, []);
  assertEquals(result.length, 1);
  assert(result[0].isPackage);
});

Deno.test("wire filter — excludes unreviewed and perfect scores", () => {
  const entries = [
    makeIdx({ isPackage: true, completed: false, score: 80 }),
    makeIdx({ isPackage: true, completed: true, score: 100 }),
    makeIdx({ isPackage: true, completed: true, score: 60 }),
  ];
  const result = filterForWire(entries, []);
  assertEquals(result.length, 1);
  assertEquals(result[0].score, 60);
});

Deno.test("wire filter — excludes bypassed offices", () => {
  const entries = [
    makeIdx({ isPackage: true, department: "GUN Lodge", completed: true, score: 80 }),
    makeIdx({ isPackage: true, department: "East", completed: true, score: 80 }),
  ];
  const result = filterForWire(entries, ["gun"]);
  assertEquals(result.length, 1);
  assertEquals(result[0].department, "East");
});

// -- Tests: classifyChargebacks --

Deno.test("classify — entry with only chargeback headers is a chargeback only", () => {
  const entries: ChargebackEntry[] = [{
    findingId: "f1", failedQHeaders: ["Income", "Single Qualifier Question"], score: 60,
  }];
  const { chargebacks, omissions } = classifyChargebacks(entries);
  assertEquals(chargebacks.length, 1);
  assertEquals(omissions.length, 0);
});

Deno.test("classify — entry with only non-chargeback headers is an omission only", () => {
  const entries: ChargebackEntry[] = [{
    findingId: "f1", failedQHeaders: ["Confirmation Email", "Greeting"], score: 60,
  }];
  const { chargebacks, omissions } = classifyChargebacks(entries);
  assertEquals(chargebacks.length, 0);
  assertEquals(omissions.length, 1);
});

Deno.test("classify — entry with mixed headers appears in both", () => {
  const entries: ChargebackEntry[] = [{
    findingId: "f1", failedQHeaders: ["Income", "Confirmation Email"], score: 60,
  }];
  const { chargebacks, omissions } = classifyChargebacks(entries);
  assertEquals(chargebacks.length, 1);
  assertEquals(omissions.length, 1);
});

Deno.test("classify — multiple entries classified independently", () => {
  const entries: ChargebackEntry[] = [
    { findingId: "f1", failedQHeaders: ["Income"], score: 80 },
    { findingId: "f2", failedQHeaders: ["Greeting"], score: 60 },
    { findingId: "f3", failedQHeaders: ["MCC Recurring Charges Disclosed?", "Greeting"], score: 70 },
  ];
  const { chargebacks, omissions } = classifyChargebacks(entries);
  assertEquals(chargebacks.length, 2); // f1, f3
  assertEquals(omissions.length, 2);   // f2, f3
});
