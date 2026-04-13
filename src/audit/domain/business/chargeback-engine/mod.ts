/** Chargeback/omission/wire deduction classification engine.
 *  Pure functions — no KV or external dependencies. */

import type { ChargebackEntry, WireDeductionEntry, IAnsweredQuestion } from "@core/dto/types.ts";

export const CHARGEBACK_QUESTIONS = new Set([
  "Income",
  "MCC Recurring Charges Disclosed?",
  "Married/Cohab Qualifier Question",
  "Single Qualifier Question",
]);

export interface FailedQuestion {
  header: string;
  egregious: boolean;
}

/**
 * Extract failed questions from answered questions.
 * Returns questions where answer !== "Yes" that have a header.
 */
export function computeFailedQuestions(answers: IAnsweredQuestion[]): FailedQuestion[] {
  return answers
    .filter((a) => a.answer !== "Yes")
    .map((a) => ({ header: a.header, egregious: !!a.egregious }))
    .filter((q) => q.header);
}

/**
 * Split failed questions into header arrays.
 */
export function splitHeaders(failedQs: FailedQuestion[]): {
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

/**
 * Build a ChargebackEntry from audit data.
 * Returns null if no failed questions (all passed after review).
 */
export function buildChargebackEntry(opts: {
  findingId: string;
  completedAt: number;
  voName: string;
  destination: string;
  revenue: string;
  recordId: string;
  score: number;
  answers: IAnsweredQuestion[];
}): ChargebackEntry | null {
  const failedQs = computeFailedQuestions(opts.answers);
  if (failedQs.length === 0) return null;
  const { failedQHeaders, egregiousHeaders, omissionHeaders } = splitHeaders(failedQs);
  return {
    findingId: opts.findingId,
    ts: opts.completedAt,
    voName: opts.voName,
    destination: opts.destination,
    revenue: opts.revenue,
    recordId: opts.recordId,
    score: opts.score,
    failedQHeaders,
    egregiousHeaders,
    omissionHeaders,
  };
}

/**
 * Build a WireDeductionEntry from audit data.
 */
export function buildWireDeductionEntry(opts: {
  findingId: string;
  completedAt: number;
  score: number;
  answers: IAnsweredQuestion[];
  recordId: string;
  office: string;
  excellenceAuditor: string;
  guestName: string;
}): WireDeductionEntry {
  const totalSuccess = opts.answers.filter((a) => a.answer === "Yes").length;
  return {
    findingId: opts.findingId,
    ts: opts.completedAt,
    score: opts.score,
    questionsAudited: opts.answers.length,
    totalSuccess,
    recordId: opts.recordId,
    office: opts.office,
    excellenceAuditor: opts.excellenceAuditor,
    guestName: opts.guestName,
  };
}

/**
 * Classify chargeback entries into chargebacks vs omissions.
 * An entry can appear in both if it has headers matching both categories.
 */
export function classifyChargebacks(entries: ChargebackEntry[]): {
  chargebacks: ChargebackEntry[];
  omissions: ChargebackEntry[];
} {
  return {
    chargebacks: entries.filter((e) => e.failedQHeaders.some((h) => CHARGEBACK_QUESTIONS.has(h))),
    omissions: entries.filter((e) => e.failedQHeaders.some((h) => !CHARGEBACK_QUESTIONS.has(h))),
  };
}

/**
 * Check if an office should be bypassed based on configured patterns.
 * Case-insensitive substring match.
 */
export function isOfficeBypassed(department: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  const dept = department.toLowerCase();
  return patterns.some((p) => dept.includes(p.toLowerCase()));
}
