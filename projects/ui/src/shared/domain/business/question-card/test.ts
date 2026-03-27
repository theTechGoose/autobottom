import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { QuestionCard } from "./mod.ts";

// --- Default property values ---

Deno.test("QuestionCard - header is required (no default)", () => {
  const card = new QuestionCard();
  // required inputs have no default; property exists but is undefined
  assertEquals(card.header, undefined);
});

Deno.test("QuestionCard - default populated is empty string", () => {
  const card = new QuestionCard();
  assertEquals(card.populated, "");
});

Deno.test("QuestionCard - default defense is empty string", () => {
  const card = new QuestionCard();
  assertEquals(card.defense, "");
});

Deno.test("QuestionCard - default thinking is empty string", () => {
  const card = new QuestionCard();
  assertEquals(card.thinking, "");
});

Deno.test("QuestionCard - default answer is empty string", () => {
  const card = new QuestionCard();
  assertEquals(card.answer, "");
});

Deno.test("QuestionCard - default appealType is empty string", () => {
  const card = new QuestionCard();
  assertEquals(card.appealType, "");
});

Deno.test("QuestionCard - default appealComment is empty string", () => {
  const card = new QuestionCard();
  assertEquals(card.appealComment, "");
});

// --- State ---

Deno.test("QuestionCard - default thinkingOpen is false", () => {
  const card = new QuestionCard();
  assertEquals(card.thinkingOpen, false);
});

// --- Method: toggleThinking ---

Deno.test("QuestionCard - toggleThinking flips thinkingOpen from false to true", () => {
  const card = new QuestionCard();
  assertEquals(card.thinkingOpen, false);
  card.toggleThinking();
  assertEquals(card.thinkingOpen, true);
});

Deno.test("QuestionCard - toggleThinking flips thinkingOpen from true to false", () => {
  const card = new QuestionCard();
  card.thinkingOpen = true;
  card.toggleThinking();
  assertEquals(card.thinkingOpen, false);
});

Deno.test("QuestionCard - toggleThinking called twice returns to original state", () => {
  const card = new QuestionCard();
  card.toggleThinking();
  card.toggleThinking();
  assertEquals(card.thinkingOpen, false);
});

// --- Properties can be set ---

Deno.test("QuestionCard - header can be assigned", () => {
  const card = new QuestionCard();
  card.header = "Was the greeting correct?";
  assertEquals(card.header, "Was the greeting correct?");
});

Deno.test("QuestionCard - populated can be assigned", () => {
  const card = new QuestionCard();
  card.populated = "yes";
  assertEquals(card.populated, "yes");
});

Deno.test("QuestionCard - appealType and appealComment can be assigned", () => {
  const card = new QuestionCard();
  card.appealType = "redo";
  card.appealComment = "Agent disagrees with finding";
  assertEquals(card.appealType, "redo");
  assertEquals(card.appealComment, "Agent disagrees with finding");
});
