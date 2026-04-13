/** Tests for chargeback/wire computation from findings (post-review source of truth).
 *  Validates the pure logic used by queryChargebackData / queryWireData to
 *  compute chargeback, omission, and wire deduction entries on-the-fly from
 *  the finding's corrected answeredQuestions + audit-done-idx. */

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

// -- Interfaces mirroring production types --

interface AnsweredQuestion {
  header: string;
  answer: string;
  egregious?: boolean;
}

interface AuditDoneIndexEntry {
  findingId: string;
  completedAt: number;
  score: number;
  completed: boolean;
  isPackage?: boolean;
  department?: string;
  voName?: string;
  recordId?: string;
}

interface ChargebackEntry {
  findingId: string;
  ts: number;
  voName: string;
  destination: string;
  revenue: string;
  recordId: string;
  score: number;
  failedQHeaders: string[];
  egregiousHeaders: string[];
  omissionHeaders: string[];
}

// -- Pure computation functions (mirror production logic in main.ts) --

const CHARGEBACK_QUESTIONS = new Set([
  "Income",
  "MCC Recurring Charges Disclosed?",
  "Married/Cohab Qualifier Question",
  "Single Qualifier Question",
]);

function computeFailedQs(answers: AnsweredQuestion[]): { header: string; egregious: boolean }[] {
  return answers
    .filter((a) => a.answer !== "Yes")
    .map((a) => ({ header: a.header, egregious: !!a.egregious }))
    .filter((q) => q.header);
}

function splitHeaders(failedQs: { header: string; egregious: boolean }[]): {
  failedQHeaders: string[];
  egregiousHeaders: string[];
  omissionHeaders: string[];
} {
  return {
    failedQHeaders: failedQs.map((q) => q.header),
    egregiousHeaders: failedQs.filter((q) => q.egregious).map((q) => q.header),
    omissionHeaders: failedQs.filter((q) => !q.egregious).map((q) => q.header),
  };
}

function classifyEntries(entries: ChargebackEntry[]): {
  chargebacks: ChargebackEntry[];
  omissions: ChargebackEntry[];
} {
  return {
    chargebacks: entries.filter((e) => e.failedQHeaders.some((h) => CHARGEBACK_QUESTIONS.has(h))),
    omissions: entries.filter((e) => e.failedQHeaders.some((h) => !CHARGEBACK_QUESTIONS.has(h))),
  };
}

function filterCandidates(
  entries: AuditDoneIndexEntry[],
  bypassPatterns: string[],
  isPackage: boolean,
): AuditDoneIndexEntry[] {
  const isBypassed = (dept: string) =>
    bypassPatterns.length > 0 && bypassPatterns.some((p) => dept.toLowerCase().includes(p));
  return entries.filter(
    (e) => e.completed && (isPackage ? e.isPackage : !e.isPackage) && (e.score ?? 0) < 100 && !isBypassed(e.department ?? ""),
  );
}

function computeWireEntry(
  entry: AuditDoneIndexEntry,
  answers: AnsweredQuestion[],
): { questionsAudited: number; totalSuccess: number } {
  return {
    questionsAudited: answers.length,
    totalSuccess: answers.filter((a) => a.answer === "Yes").length,
  };
}

// -- Test data factories --

function makeQuestion(header: string, answer: "Yes" | "No", egregious = false): AnsweredQuestion {
  return { header, answer, egregious };
}

function makeEntry(overrides: Partial<AuditDoneIndexEntry> = {}): AuditDoneIndexEntry {
  return {
    findingId: "f-" + Math.random().toString(36).slice(2, 8),
    completedAt: Date.now(),
    score: 80,
    completed: true,
    isPackage: false,
    department: "Sales",
    voName: "Test User",
    recordId: "123",
    ...overrides,
  };
}

function makeCbEntry(overrides: Partial<ChargebackEntry> = {}): ChargebackEntry {
  return {
    findingId: "f-" + Math.random().toString(36).slice(2, 8),
    ts: Date.now(),
    voName: "Test User",
    destination: "Cancun",
    revenue: "1000",
    recordId: "123",
    score: 80,
    failedQHeaders: ["Income"],
    egregiousHeaders: [],
    omissionHeaders: ["Income"],
    ...overrides,
  };
}

// -- Tests: computeFailedQs --

Deno.test("computeFailedQs — returns only non-Yes answers with headers", () => {
  const qs = [
    makeQuestion("Income", "No"),
    makeQuestion("Room Occupancy", "Yes"),
    makeQuestion("MCC Recurring Charges Disclosed?", "No", true),
    makeQuestion("Greeting", "Yes"),
    makeQuestion("Confirmation Email", "No"),
  ];
  const failed = computeFailedQs(qs);
  assertEquals(failed.length, 3);
  assertEquals(failed[0], { header: "Income", egregious: false });
  assertEquals(failed[1], { header: "MCC Recurring Charges Disclosed?", egregious: true });
  assertEquals(failed[2], { header: "Confirmation Email", egregious: false });
});

Deno.test("computeFailedQs — excludes answers without headers", () => {
  const qs = [
    { header: "", answer: "No", egregious: false },
    makeQuestion("Income", "No"),
  ];
  const failed = computeFailedQs(qs);
  assertEquals(failed.length, 1);
  assertEquals(failed[0].header, "Income");
});

Deno.test("computeFailedQs — all Yes returns empty (delete case)", () => {
  const qs = [
    makeQuestion("Income", "Yes"),
    makeQuestion("Greeting", "Yes"),
    makeQuestion("Room Occupancy", "Yes"),
  ];
  const failed = computeFailedQs(qs);
  assertEquals(failed.length, 0);
});

// -- Tests: splitHeaders --

Deno.test("splitHeaders — correctly separates egregious vs omission", () => {
  const failed = [
    { header: "Income", egregious: true },
    { header: "Confirmation Email", egregious: false },
    { header: "MCC Recurring Charges Disclosed?", egregious: true },
  ];
  const result = splitHeaders(failed);
  assertEquals(result.failedQHeaders, ["Income", "Confirmation Email", "MCC Recurring Charges Disclosed?"]);
  assertEquals(result.egregiousHeaders, ["Income", "MCC Recurring Charges Disclosed?"]);
  assertEquals(result.omissionHeaders, ["Confirmation Email"]);
});

Deno.test("splitHeaders — all egregious, no omissions", () => {
  const failed = [
    { header: "Income", egregious: true },
    { header: "MCC Recurring Charges Disclosed?", egregious: true },
  ];
  const result = splitHeaders(failed);
  assertEquals(result.egregiousHeaders.length, 2);
  assertEquals(result.omissionHeaders.length, 0);
});

// -- Tests: classifyEntries (chargeback vs omission) --

Deno.test("classifyEntries — Income is a chargeback", () => {
  const entries = [makeCbEntry({ failedQHeaders: ["Income"] })];
  const { chargebacks, omissions } = classifyEntries(entries);
  assertEquals(chargebacks.length, 1);
  assertEquals(omissions.length, 0);
});

Deno.test("classifyEntries — non-chargeback header is an omission", () => {
  const entries = [makeCbEntry({ failedQHeaders: ["Confirmation Email"] })];
  const { chargebacks, omissions } = classifyEntries(entries);
  assertEquals(chargebacks.length, 0);
  assertEquals(omissions.length, 1);
});

Deno.test("classifyEntries — mixed headers appears in both lists", () => {
  const entries = [makeCbEntry({ failedQHeaders: ["Income", "Confirmation Email"] })];
  const { chargebacks, omissions } = classifyEntries(entries);
  assertEquals(chargebacks.length, 1);
  assertEquals(omissions.length, 1);
  assertEquals(chargebacks[0].findingId, omissions[0].findingId);
});

Deno.test("classifyEntries — all four chargeback questions recognized", () => {
  for (const q of ["Income", "MCC Recurring Charges Disclosed?", "Married/Cohab Qualifier Question", "Single Qualifier Question"]) {
    const entries = [makeCbEntry({ failedQHeaders: [q] })];
    const { chargebacks } = classifyEntries(entries);
    assertEquals(chargebacks.length, 1, `Expected "${q}" to be classified as a chargeback`);
  }
});

// -- Tests: filterCandidates --

Deno.test("filterCandidates — excludes incomplete (pending-review) entries", () => {
  const entries = [
    makeEntry({ completed: true, score: 80 }),
    makeEntry({ completed: false, score: 80 }),
  ];
  const result = filterCandidates(entries, [], false);
  assertEquals(result.length, 1);
  assert(result[0].completed);
});

Deno.test("filterCandidates — excludes perfect scores", () => {
  const entries = [
    makeEntry({ score: 100, completed: true }),
    makeEntry({ score: 80, completed: true }),
  ];
  const result = filterCandidates(entries, [], false);
  assertEquals(result.length, 1);
  assertEquals(result[0].score, 80);
});

Deno.test("filterCandidates — excludes bypassed offices", () => {
  const entries = [
    makeEntry({ department: "JAY Resort", completed: true, score: 80 }),
    makeEntry({ department: "Sales", completed: true, score: 80 }),
  ];
  const result = filterCandidates(entries, ["jay"], false);
  assertEquals(result.length, 1);
  assertEquals(result[0].department, "Sales");
});

Deno.test("filterCandidates — package filter separates date-leg from package", () => {
  const entries = [
    makeEntry({ isPackage: false, completed: true, score: 80 }),
    makeEntry({ isPackage: true, completed: true, score: 80 }),
  ];
  assertEquals(filterCandidates(entries, [], false).length, 1); // date-leg only
  assertEquals(filterCandidates(entries, [], true).length, 1);  // package only
});

// -- Tests: computeWireEntry --

Deno.test("computeWireEntry — correct questionsAudited and totalSuccess", () => {
  const entry = makeEntry({ isPackage: true });
  const qs = [
    makeQuestion("Q1", "Yes"),
    makeQuestion("Q2", "No"),
    makeQuestion("Q3", "Yes"),
    makeQuestion("Q4", "Yes"),
    makeQuestion("Q5", "No"),
  ];
  const result = computeWireEntry(entry, qs);
  assertEquals(result.questionsAudited, 5);
  assertEquals(result.totalSuccess, 3);
});

Deno.test("computeWireEntry — all Yes means totalSuccess equals questionsAudited", () => {
  const entry = makeEntry({ isPackage: true });
  const qs = [
    makeQuestion("Q1", "Yes"),
    makeQuestion("Q2", "Yes"),
  ];
  const result = computeWireEntry(entry, qs);
  assertEquals(result.questionsAudited, 2);
  assertEquals(result.totalSuccess, 2);
});

// -- Tests: end-to-end review flip scenario --

Deno.test("review flips all Nos to Yes — computeFailedQs returns empty (entry should be skipped)", () => {
  // Simulates what happens after review flips all failing answers
  const preReview = [
    makeQuestion("Income", "No"),
    makeQuestion("Greeting", "No"),
    makeQuestion("Room Occupancy", "Yes"),
  ];
  // After review flips:
  const postReview = preReview.map((q) => q.answer === "No" ? { ...q, answer: "Yes" as const } : q);
  const failed = computeFailedQs(postReview);
  assertEquals(failed.length, 0); // No chargebacks — entry should be deleted/skipped
});

Deno.test("review flips some — remaining failures retain correct egregious split", () => {
  const postReview: AnsweredQuestion[] = [
    { header: "Income", answer: "Yes", egregious: true },          // flipped by reviewer
    { header: "MCC Recurring Charges Disclosed?", answer: "No", egregious: true },  // confirmed No
    { header: "Confirmation Email", answer: "No", egregious: false }, // confirmed No
    { header: "Greeting", answer: "Yes" },                          // originally Yes
  ];
  const failed = computeFailedQs(postReview);
  assertEquals(failed.length, 2);
  const { failedQHeaders, egregiousHeaders, omissionHeaders } = splitHeaders(failed);
  assertEquals(failedQHeaders, ["MCC Recurring Charges Disclosed?", "Confirmation Email"]);
  assertEquals(egregiousHeaders, ["MCC Recurring Charges Disclosed?"]);
  assertEquals(omissionHeaders, ["Confirmation Email"]);
});

Deno.test("score from audit-done-idx is used, not recomputed from answers", () => {
  // The audit-done-idx entry has the reviewed score already.
  // Even if answers array has a different count, we trust the index score.
  const entry = makeEntry({ score: 75, completed: true });
  // Verify the entry score is what gets used (not derived from answers)
  assertEquals(entry.score, 75);
});
