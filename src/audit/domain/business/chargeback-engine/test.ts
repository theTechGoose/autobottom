/** Tests for chargeback/omission classification engine. */

import { assertEquals, assert } from "jsr:@std/assert";
import {
  computeFailedQuestions, splitHeaders, buildChargebackEntry,
  buildWireDeductionEntry, classifyChargebacks, isOfficeBypassed,
  CHARGEBACK_QUESTIONS,
} from "./mod.ts";
import type { IAnsweredQuestion } from "@core/dto/types.ts";

function ans(header: string, answer: "Yes" | "No", egregious = false): IAnsweredQuestion {
  return { header, populated: header, answer, thinking: "", defense: "", egregious } as IAnsweredQuestion;
}

// -- computeFailedQuestions --

Deno.test("computeFailedQs — returns only non-Yes with headers", () => {
  const qs = [ans("Income", "No"), ans("Greeting", "Yes"), ans("MCC Recurring Charges Disclosed?", "No", true)];
  const failed = computeFailedQuestions(qs);
  assertEquals(failed.length, 2);
  assertEquals(failed[0], { header: "Income", egregious: false });
  assertEquals(failed[1], { header: "MCC Recurring Charges Disclosed?", egregious: true });
});

Deno.test("computeFailedQs — excludes empty headers", () => {
  const qs = [{ header: "", answer: "No", populated: "", thinking: "", defense: "" } as IAnsweredQuestion, ans("Income", "No")];
  assertEquals(computeFailedQuestions(qs).length, 1);
});

Deno.test("computeFailedQs — all Yes returns empty", () => {
  assertEquals(computeFailedQuestions([ans("A", "Yes"), ans("B", "Yes")]).length, 0);
});

// -- splitHeaders --

Deno.test("splitHeaders — separates egregious from omission", () => {
  const { failedQHeaders, egregiousHeaders, omissionHeaders } = splitHeaders([
    { header: "Income", egregious: true },
    { header: "Email", egregious: false },
  ]);
  assertEquals(failedQHeaders, ["Income", "Email"]);
  assertEquals(egregiousHeaders, ["Income"]);
  assertEquals(omissionHeaders, ["Email"]);
});

// -- buildChargebackEntry --

Deno.test("buildChargebackEntry — returns null when all passed", () => {
  const entry = buildChargebackEntry({
    findingId: "f1", completedAt: 1000, voName: "Alice", destination: "CUN",
    revenue: "100", recordId: "r1", score: 100, answers: [ans("Q1", "Yes")],
  });
  assertEquals(entry, null);
});

Deno.test("buildChargebackEntry — builds correct entry with failures", () => {
  const entry = buildChargebackEntry({
    findingId: "f1", completedAt: 5000, voName: "Bob", destination: "CUN",
    revenue: "500", recordId: "r1", score: 60,
    answers: [ans("Income", "No", true), ans("Greeting", "Yes"), ans("Email", "No")],
  });
  assert(entry !== null);
  assertEquals(entry!.failedQHeaders, ["Income", "Email"]);
  assertEquals(entry!.egregiousHeaders, ["Income"]);
  assertEquals(entry!.omissionHeaders, ["Email"]);
  assertEquals(entry!.score, 60);
});

// -- buildWireDeductionEntry --

Deno.test("buildWireDeductionEntry — computes totalSuccess", () => {
  const entry = buildWireDeductionEntry({
    findingId: "f1", completedAt: 1000, score: 60,
    answers: [ans("Q1", "Yes"), ans("Q2", "No"), ans("Q3", "Yes")],
    recordId: "r1", office: "East", excellenceAuditor: "Alice", guestName: "Guest",
  });
  assertEquals(entry.questionsAudited, 3);
  assertEquals(entry.totalSuccess, 2);
});

// -- classifyChargebacks --

Deno.test("classify — Income is a chargeback", () => {
  const entries = [{ findingId: "f1", failedQHeaders: ["Income"], ts: 0, voName: "", destination: "", revenue: "", recordId: "", score: 0 }];
  const { chargebacks, omissions } = classifyChargebacks(entries);
  assertEquals(chargebacks.length, 1);
  assertEquals(omissions.length, 0);
});

Deno.test("classify — non-chargeback header is omission", () => {
  const entries = [{ findingId: "f1", failedQHeaders: ["Email"], ts: 0, voName: "", destination: "", revenue: "", recordId: "", score: 0 }];
  const { chargebacks, omissions } = classifyChargebacks(entries);
  assertEquals(chargebacks.length, 0);
  assertEquals(omissions.length, 1);
});

Deno.test("classify — mixed headers in both lists", () => {
  const entries = [{ findingId: "f1", failedQHeaders: ["Income", "Email"], ts: 0, voName: "", destination: "", revenue: "", recordId: "", score: 0 }];
  const { chargebacks, omissions } = classifyChargebacks(entries);
  assertEquals(chargebacks.length, 1);
  assertEquals(omissions.length, 1);
});

Deno.test("classify — all 4 chargeback questions recognized", () => {
  for (const q of CHARGEBACK_QUESTIONS) {
    const entries = [{ findingId: "f1", failedQHeaders: [q], ts: 0, voName: "", destination: "", revenue: "", recordId: "", score: 0 }];
    assertEquals(classifyChargebacks(entries).chargebacks.length, 1, `${q} should be a chargeback`);
  }
});

// -- isOfficeBypassed --

Deno.test("bypass — matches case-insensitive", () => {
  assert(isOfficeBypassed("JAY Resort", ["jay"]));
  assert(isOfficeBypassed("jay resort", ["JAY"]));
});

Deno.test("bypass — no patterns = not bypassed", () => {
  assert(!isOfficeBypassed("JAY", []));
});

Deno.test("bypass — non-matching = not bypassed", () => {
  assert(!isOfficeBypassed("Sales HQ", ["jay", "gun"]));
});
