/** Tests for scoring engine: bonus flips, score calculation, auto-complete. */

import { assertEquals, assert } from "jsr:@std/assert";
import { applyBonusFlips, calculateScore, getAutoCompleteReason } from "./mod.ts";
import type { ScoringQuestion } from "./mod.ts";

function q(answer: "Yes" | "No", opts: Partial<ScoringQuestion> = {}): ScoringQuestion {
  return { answer, weight: 5, egregious: false, ...opts };
}

// -- applyBonusFlips --

Deno.test("bonus — zero budget does nothing", () => {
  const qs = [q("No"), q("No")];
  const { flipped, questions } = applyBonusFlips(qs, 0);
  assertEquals(flipped, 0);
  assert(questions.every((q) => q.answer === "No"));
});

Deno.test("bonus — 5 points flips one question (weight=5)", () => {
  const qs = [q("No"), q("No")];
  const { flipped, remaining, questions } = applyBonusFlips(qs, 5);
  assertEquals(flipped, 1);
  assertEquals(remaining, 0);
  assertEquals(questions[0].answer, "Yes");
  assertEquals(questions[0].bonusFlipped, true);
  assertEquals(questions[1].answer, "No");
});

Deno.test("bonus — 10 points flips two questions", () => {
  const qs = [q("No"), q("No"), q("Yes")];
  const { flipped } = applyBonusFlips(qs, 10);
  assertEquals(flipped, 2);
});

Deno.test("bonus — egregious questions are immune", () => {
  const qs = [q("No", { egregious: true }), q("No")];
  const { flipped, questions } = applyBonusFlips(qs, 10);
  assertEquals(flipped, 1);
  assertEquals(questions[0].answer, "No"); // egregious unchanged
  assertEquals(questions[1].answer, "Yes"); // non-egregious flipped
});

Deno.test("bonus — insufficient budget for heavy question skips it", () => {
  const qs = [q("No", { weight: 20 }), q("No", { weight: 3 })];
  const { flipped, questions } = applyBonusFlips(qs, 5);
  assertEquals(flipped, 1);
  assertEquals(questions[0].answer, "No"); // weight 20, can't afford
  assertEquals(questions[1].answer, "Yes"); // weight 3, can afford
});

Deno.test("bonus — only No answers affected", () => {
  const qs = [q("Yes"), q("No"), q("Yes")];
  const { flipped } = applyBonusFlips(qs, 100);
  assertEquals(flipped, 1);
});

Deno.test("bonus — weight defaults to 5 when undefined", () => {
  const qs = [{ answer: "No" } as ScoringQuestion];
  const { flipped, remaining } = applyBonusFlips(qs, 5);
  assertEquals(flipped, 1);
  assertEquals(remaining, 0);
});

Deno.test("bonus — mixed weights consume budget correctly", () => {
  const qs = [q("No", { weight: 3 }), q("No", { weight: 3 }), q("No", { weight: 5 })];
  const { flipped, remaining } = applyBonusFlips(qs, 7);
  assertEquals(flipped, 2); // 3 + 3 = 6, can't afford 5
  assertEquals(remaining, 1);
});

// -- calculateScore --

Deno.test("score — all Yes = 100%", () => {
  assertEquals(calculateScore([q("Yes"), q("Yes"), q("Yes")]), 100);
});

Deno.test("score — all No = 0%", () => {
  assertEquals(calculateScore([q("No"), q("No")]), 0);
});

Deno.test("score — 3/4 = 75%", () => {
  assertEquals(calculateScore([q("Yes"), q("Yes"), q("Yes"), q("No")]), 75);
});

Deno.test("score — empty questions = undefined", () => {
  assertEquals(calculateScore([]), undefined);
});

Deno.test("score — isInvalid always returns 0", () => {
  assertEquals(calculateScore([q("Yes"), q("Yes")], true), 0);
});

Deno.test("score — rounds correctly: 2/3 = 67%", () => {
  assertEquals(calculateScore([q("Yes"), q("Yes"), q("No")]), 67);
});

// -- getAutoCompleteReason --

Deno.test("autoComplete — invalid genie", () => {
  assertEquals(getAutoCompleteReason(0, true), "invalid_genie");
});

Deno.test("autoComplete — perfect score", () => {
  assertEquals(getAutoCompleteReason(100, false), "perfect_score");
});

Deno.test("autoComplete — partial score needs review", () => {
  assertEquals(getAutoCompleteReason(80, false), undefined);
});

Deno.test("autoComplete — zero score (not invalid) needs review", () => {
  assertEquals(getAutoCompleteReason(0, false), undefined);
});
