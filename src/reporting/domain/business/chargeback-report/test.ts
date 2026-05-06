/** Tests for chargeback report filtering and classification. */

import { assertEquals } from "#assert";
import type { ChargebackEntry, WireDeductionEntry } from "@core/dto/types.ts";

// Inline the pure filtering logic to test without KV
function filterReviewedChargebacks(
  entries: ChargebackEntry[], reviewedIds: Set<string>, bypassPatterns: string[],
): ChargebackEntry[] {
  const isBypassed = (dept: string) =>
    bypassPatterns.length > 0 && bypassPatterns.some((p) => dept.toLowerCase().includes(p.toLowerCase()));
  return entries.filter((e) => reviewedIds.has(e.findingId) && !isBypassed(e.destination ?? ""));
}

function filterWire(
  entries: WireDeductionEntry[], reviewedIds: Set<string>, bypassPatterns: string[],
): WireDeductionEntry[] {
  const isBypassed = (office: string) =>
    bypassPatterns.length > 0 && bypassPatterns.some((p) => office.toLowerCase().includes(p.toLowerCase()));
  return entries.filter((e) => e.score < 100 && reviewedIds.has(e.findingId) && !isBypassed(e.office ?? ""));
}

const CHARGEBACK_QUESTIONS = new Set(["Income", "MCC Recurring Charges Disclosed?", "Married/Cohab Qualifier Question", "Single Qualifier Question"]);

function classify(entries: ChargebackEntry[]) {
  return {
    chargebacks: entries.filter((e) => e.failedQHeaders.some((h) => CHARGEBACK_QUESTIONS.has(h))),
    omissions: entries.filter((e) => e.failedQHeaders.some((h) => !CHARGEBACK_QUESTIONS.has(h))),
  };
}

function cb(id: string, headers: string[], dest = "CUN"): ChargebackEntry {
  return { findingId: id, ts: Date.now(), voName: "", destination: dest, revenue: "", recordId: "", score: 80, failedQHeaders: headers };
}

function wire(id: string, score: number, office = "Sales"): WireDeductionEntry {
  return { findingId: id, ts: Date.now(), score, questionsAudited: 10, totalSuccess: 8, recordId: "", office, excellenceAuditor: "", guestName: "" };
}

Deno.test("chargeback filter — excludes unreviewed", () => {
  const entries = [cb("f1", ["Income"]), cb("f2", ["Income"])];
  const reviewed = new Set(["f1"]);
  assertEquals(filterReviewedChargebacks(entries, reviewed, []).length, 1);
});

Deno.test("chargeback filter — excludes bypassed offices", () => {
  const entries = [cb("f1", ["Income"], "JAY Resort"), cb("f2", ["Income"], "Sales")];
  const reviewed = new Set(["f1", "f2"]);
  assertEquals(filterReviewedChargebacks(entries, reviewed, ["jay"]).length, 1);
});

Deno.test("classify — Income is chargeback", () => {
  const { chargebacks, omissions } = classify([cb("f1", ["Income"])]);
  assertEquals(chargebacks.length, 1);
  assertEquals(omissions.length, 0);
});

Deno.test("classify — non-chargeback is omission", () => {
  const { chargebacks, omissions } = classify([cb("f1", ["Greeting"])]);
  assertEquals(chargebacks.length, 0);
  assertEquals(omissions.length, 1);
});

Deno.test("classify — mixed appears in both", () => {
  const { chargebacks, omissions } = classify([cb("f1", ["Income", "Greeting"])]);
  assertEquals(chargebacks.length, 1);
  assertEquals(omissions.length, 1);
});

Deno.test("wire filter — excludes 100%", () => {
  const entries = [wire("f1", 100), wire("f2", 80)];
  assertEquals(filterWire(entries, new Set(["f1", "f2"]), []).length, 1);
});

Deno.test("wire filter — excludes unreviewed", () => {
  const entries = [wire("f1", 80), wire("f2", 80)];
  assertEquals(filterWire(entries, new Set(["f1"]), []).length, 1);
});

Deno.test("wire filter — excludes bypassed", () => {
  const entries = [wire("f1", 80, "GUN Lodge"), wire("f2", 80, "East")];
  assertEquals(filterWire(entries, new Set(["f1", "f2"]), ["gun"]).length, 1);
});
