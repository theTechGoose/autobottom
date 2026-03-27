import { assertEquals, assertExists } from "jsr:@std/assert";
import { JudgeQueue } from "./mod.ts";

Deno.test("JudgeQueue - class can be instantiated", () => {
  const queue = new JudgeQueue();
  assertExists(queue);
});

Deno.test("JudgeQueue - default view is 'loading'", () => {
  const queue = new JudgeQueue();
  assertEquals(queue.view, "loading");
});

Deno.test("JudgeQueue - default currentItem is null", () => {
  const queue = new JudgeQueue();
  assertEquals(queue.currentItem, null);
});

Deno.test("JudgeQueue - default peekItem is null", () => {
  const queue = new JudgeQueue();
  assertEquals(queue.peekItem, null);
});

Deno.test("JudgeQueue - default busy is false", () => {
  const queue = new JudgeQueue();
  assertEquals(queue.busy, false);
});

Deno.test("JudgeQueue - default combo is 0", () => {
  const queue = new JudgeQueue();
  assertEquals(queue.combo, 0);
});

Deno.test("JudgeQueue - default xp is 0", () => {
  const queue = new JudgeQueue();
  assertEquals(queue.xp, 0);
});

Deno.test("JudgeQueue - default sessionReviews is 0", () => {
  const queue = new JudgeQueue();
  assertEquals(queue.sessionReviews, 0);
});

Deno.test("JudgeQueue - default thinkingOpen is false", () => {
  const queue = new JudgeQueue();
  assertEquals(queue.thinkingOpen, false);
});

Deno.test("JudgeQueue - default cheatOpen is false", () => {
  const queue = new JudgeQueue();
  assertEquals(queue.cheatOpen, false);
});

Deno.test("JudgeQueue - default confirmOpen is false", () => {
  const queue = new JudgeQueue();
  assertEquals(queue.confirmOpen, false);
});

Deno.test("JudgeQueue - default auditRemaining is 0", () => {
  const queue = new JudgeQueue();
  assertEquals(queue.auditRemaining, 0);
});

Deno.test("JudgeQueue - default speedAvg is '--'", () => {
  const queue = new JudgeQueue();
  assertEquals(queue.speedAvg, "--");
});

Deno.test("JudgeQueue - default levelNum is 1", () => {
  const queue = new JudgeQueue();
  assertEquals(queue.levelNum, 1);
});

Deno.test("JudgeQueue - has decide method", () => {
  const queue = new JudgeQueue();
  assertEquals(typeof queue.decide, "function");
});

Deno.test("JudgeQueue - has goBack method", () => {
  const queue = new JudgeQueue();
  assertEquals(typeof queue.goBack, "function");
});

Deno.test("JudgeQueue - has toggleThinking method", () => {
  const queue = new JudgeQueue();
  assertEquals(typeof queue.toggleThinking, "function");
});

Deno.test("JudgeQueue - toggleThinking flips thinkingOpen", () => {
  const queue = new JudgeQueue();
  assertEquals(queue.thinkingOpen, false);
  queue.toggleThinking();
  assertEquals(queue.thinkingOpen, true);
  queue.toggleThinking();
  assertEquals(queue.thinkingOpen, false);
});

Deno.test("JudgeQueue - toggleCheatSheet flips cheatOpen", () => {
  const queue = new JudgeQueue();
  assertEquals(queue.cheatOpen, false);
  queue.toggleCheatSheet();
  assertEquals(queue.cheatOpen, true);
  queue.toggleCheatSheet();
  assertEquals(queue.cheatOpen, false);
});

Deno.test("JudgeQueue - isYesAnswer correctly detects 'yes'", () => {
  const queue = new JudgeQueue();
  assertEquals(queue.isYesAnswer("yes"), true);
  assertEquals(queue.isYesAnswer("Yes, it is"), true);
  assertEquals(queue.isYesAnswer("true"), true);
  assertEquals(queue.isYesAnswer("y"), true);
  assertEquals(queue.isYesAnswer("no"), false);
  assertEquals(queue.isYesAnswer(undefined), false);
  assertEquals(queue.isYesAnswer(""), false);
});

Deno.test("JudgeQueue - getComboClass returns correct class", () => {
  const queue = new JudgeQueue();
  assertEquals(queue.getComboClass(0), "combo-dim");
  assertEquals(queue.getComboClass(3), "combo-hot");
  assertEquals(queue.getComboClass(5), "combo-fire");
  assertEquals(queue.getComboClass(12), "combo-inferno");
  assertEquals(queue.getComboClass(23), "combo-godlike");
});
