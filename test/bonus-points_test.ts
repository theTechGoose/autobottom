/** Tests for the bonus points system.
 *  Validates flip logic, egregious immunity, weight consumption,
 *  score calculation, and chargeback splitting. */

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

// -- Simulate the bonus flip logic from finalize.ts --

interface AnsweredQuestion {
  header: string;
  answer: string;
  egregious?: boolean;
  weight?: number;
  bonusFlipped?: boolean;
}

function applyBonusFlips(qs: AnsweredQuestion[], bonusBudget: number): { flipped: number; remaining: number } {
  let remaining = bonusBudget;
  let flipped = 0;
  for (const q of qs) {
    if (q.answer !== "No") continue;
    if (q.egregious) continue;
    const weight = q.weight ?? 5;
    if (remaining >= weight) {
      q.answer = "Yes";
      q.bonusFlipped = true;
      remaining -= weight;
      flipped++;
    }
  }
  return { flipped, remaining };
}

function calculateScore(qs: AnsweredQuestion[]): number {
  if (qs.length === 0) return 0;
  return Math.round((qs.filter(q => q.answer === "Yes").length / qs.length) * 100);
}

function splitChargebacks(qs: AnsweredQuestion[]): { egregious: string[]; omissions: string[] } {
  const failed = qs.filter(q => q.answer === "No");
  return {
    egregious: failed.filter(q => q.egregious).map(q => q.header),
    omissions: failed.filter(q => !q.egregious).map(q => q.header),
  };
}

// -- Test helpers --

function makeQuestions(count: number, overrides?: Partial<AnsweredQuestion>[]): AnsweredQuestion[] {
  return Array.from({ length: count }, (_, i) => ({
    header: `Question ${i + 1}`,
    answer: "Yes",
    weight: 5,
    egregious: false,
    ...(overrides?.[i] ?? {}),
  }));
}

// -- Tests: Bonus flip logic --

Deno.test("bonus — zero budget does nothing", () => {
  const qs = makeQuestions(5, [{ answer: "No" }, { answer: "No" }]);
  const { flipped } = applyBonusFlips(qs, 0);
  assertEquals(flipped, 0);
  assertEquals(qs.filter(q => q.answer === "No").length, 2);
});

Deno.test("bonus — 5 points flips one question (weight=5)", () => {
  const qs = makeQuestions(5, [{ answer: "No" }, { answer: "No" }]);
  const { flipped, remaining } = applyBonusFlips(qs, 5);
  assertEquals(flipped, 1);
  assertEquals(remaining, 0);
  assertEquals(qs[0].answer, "Yes");
  assertEquals(qs[0].bonusFlipped, true);
  assertEquals(qs[1].answer, "No"); // not flipped — budget exhausted
});

Deno.test("bonus — 10 points flips two questions (weight=5)", () => {
  const qs = makeQuestions(5, [{ answer: "No" }, { answer: "No" }, { answer: "No" }]);
  const { flipped, remaining } = applyBonusFlips(qs, 10);
  assertEquals(flipped, 2);
  assertEquals(remaining, 0);
  assertEquals(qs[0].bonusFlipped, true);
  assertEquals(qs[1].bonusFlipped, true);
  assertEquals(qs[2].answer, "No");
});

Deno.test("bonus — egregious questions are immune", () => {
  const qs = makeQuestions(3, [
    { answer: "No", egregious: true },  // should NOT be flipped
    { answer: "No", egregious: false }, // should be flipped
    { answer: "No", egregious: true },  // should NOT be flipped
  ]);
  const { flipped } = applyBonusFlips(qs, 100);
  assertEquals(flipped, 1);
  assertEquals(qs[0].answer, "No");     // egregious — immune
  assertEquals(qs[1].answer, "Yes");    // flipped
  assertEquals(qs[1].bonusFlipped, true);
  assertEquals(qs[2].answer, "No");     // egregious — immune
});

Deno.test("bonus — mixed weights consume budget correctly", () => {
  const qs = makeQuestions(4, [
    { answer: "No", weight: 3 },
    { answer: "No", weight: 7 },
    { answer: "No", weight: 5 },
  ]);
  // Budget = 10: can flip weight=3 (remaining=7), then weight=7 (remaining=0), not weight=5
  const { flipped, remaining } = applyBonusFlips(qs, 10);
  assertEquals(flipped, 2);
  assertEquals(remaining, 0);
  assertEquals(qs[0].bonusFlipped, true);
  assertEquals(qs[1].bonusFlipped, true);
  assertEquals(qs[2].answer, "No");
});

Deno.test("bonus — insufficient budget for heavy question skips it", () => {
  const qs = makeQuestions(3, [
    { answer: "No", weight: 20 }, // too heavy
    { answer: "No", weight: 5 },  // fits
  ]);
  const { flipped, remaining } = applyBonusFlips(qs, 5);
  assertEquals(flipped, 1);
  assertEquals(remaining, 0);
  assertEquals(qs[0].answer, "No");     // too heavy, skipped
  assertEquals(qs[1].answer, "Yes");    // flipped
});

Deno.test("bonus — only No answers are affected", () => {
  const qs = makeQuestions(5); // all Yes
  const { flipped } = applyBonusFlips(qs, 100);
  assertEquals(flipped, 0); // nothing to flip
});

Deno.test("bonus — flipped questions don't exceed 100% score", () => {
  const qs = makeQuestions(5, [{ answer: "No" }]);
  applyBonusFlips(qs, 100);
  const score = calculateScore(qs);
  assertEquals(score, 100); // 5/5 = 100%, not over
});

// -- Tests: Score calculation with bonus --

Deno.test("score — 25 questions, 2 failed, 1 bonus flip = 96%", () => {
  const qs = makeQuestions(25, [
    { answer: "No" },
    { answer: "No", egregious: true },
  ]);
  applyBonusFlips(qs, 5);
  const score = calculateScore(qs);
  // 1 non-egregious flipped → 24 Yes / 25 = 96%
  assertEquals(score, 96);
});

Deno.test("score — all egregious failures = no bonus effect", () => {
  const qs = makeQuestions(10, [
    { answer: "No", egregious: true },
    { answer: "No", egregious: true },
  ]);
  applyBonusFlips(qs, 50);
  const score = calculateScore(qs);
  assertEquals(score, 80); // 8/10 = 80%, no flips possible
});

// -- Tests: Chargeback split --

Deno.test("chargebacks — split egregious vs omissions", () => {
  const qs = makeQuestions(5, [
    { answer: "No", egregious: true, header: "MCC Disclosure" },
    { answer: "No", egregious: false, header: "Confirmation Email" },
    { answer: "No", egregious: true, header: "Income Check" },
  ]);
  const { egregious, omissions } = splitChargebacks(qs);
  assertEquals(egregious.length, 2);
  assertEquals(omissions.length, 1);
  assert(egregious.includes("MCC Disclosure"));
  assert(egregious.includes("Income Check"));
  assert(omissions.includes("Confirmation Email"));
});

Deno.test("chargebacks — bonus-flipped questions NOT in chargebacks", () => {
  const qs = makeQuestions(5, [
    { answer: "No", egregious: false, header: "Q1" },
    { answer: "No", egregious: true, header: "Q2" },
  ]);
  applyBonusFlips(qs, 5); // flips Q1 to Yes
  const { egregious, omissions } = splitChargebacks(qs);
  assertEquals(omissions.length, 0); // Q1 flipped, no longer a failure
  assertEquals(egregious.length, 1); // Q2 still failed (egregious + immune)
  assertEquals(egregious[0], "Q2");
});

// -- Tests: Default values --

Deno.test("defaults — weight defaults to 5 when undefined", () => {
  const qs: AnsweredQuestion[] = [{ header: "Q1", answer: "No" }]; // no weight set
  const { flipped } = applyBonusFlips(qs, 5);
  assertEquals(flipped, 1); // default weight=5, budget=5 → flipped
});

Deno.test("defaults — egregious defaults to false when undefined", () => {
  const qs: AnsweredQuestion[] = [{ header: "Q1", answer: "No" }]; // no egregious set
  const { flipped } = applyBonusFlips(qs, 5);
  assertEquals(flipped, 1); // not egregious by default → eligible
});
