import { assertEquals, assertExists } from "jsr:@std/assert";
import { ReviewQueue } from "./mod.ts";

Deno.test("ReviewQueue - can be instantiated", () => {
  const queue = new ReviewQueue();
  assertExists(queue);
});

Deno.test("ReviewQueue - view defaults to 'loading'", () => {
  const queue = new ReviewQueue();
  assertEquals(queue.view, "loading");
});

Deno.test("ReviewQueue - combo defaults to 0", () => {
  const queue = new ReviewQueue();
  assertEquals(queue.combo, 0);
});

Deno.test("ReviewQueue - currentItem defaults to null", () => {
  const queue = new ReviewQueue();
  assertEquals(queue.currentItem, null);
});

Deno.test("ReviewQueue - peekItem defaults to null", () => {
  const queue = new ReviewQueue();
  assertEquals(queue.peekItem, null);
});

Deno.test("ReviewQueue - busy defaults to false", () => {
  const queue = new ReviewQueue();
  assertEquals(queue.busy, false);
});

Deno.test("ReviewQueue - xp defaults to 0", () => {
  const queue = new ReviewQueue();
  assertEquals(queue.xp, 0);
});

Deno.test("ReviewQueue - streakDays defaults to 0", () => {
  const queue = new ReviewQueue();
  assertEquals(queue.streakDays, 0);
});

Deno.test("ReviewQueue - sessionReviews defaults to 0", () => {
  const queue = new ReviewQueue();
  assertEquals(queue.sessionReviews, 0);
});

Deno.test("ReviewQueue - sessionXpGained defaults to 0", () => {
  const queue = new ReviewQueue();
  assertEquals(queue.sessionXpGained, 0);
});

Deno.test("ReviewQueue - bestCombo defaults to 0", () => {
  const queue = new ReviewQueue();
  assertEquals(queue.bestCombo, 0);
});

Deno.test("ReviewQueue - levelNum defaults to 1", () => {
  const queue = new ReviewQueue();
  assertEquals(queue.levelNum, 1);
});

Deno.test("ReviewQueue - xpBarPct defaults to 0", () => {
  const queue = new ReviewQueue();
  assertEquals(queue.xpBarPct, 0);
});

Deno.test("ReviewQueue - xpDisplay defaults to '0xp'", () => {
  const queue = new ReviewQueue();
  assertEquals(queue.xpDisplay, "0xp");
});

Deno.test("ReviewQueue - progressPct defaults to 0", () => {
  const queue = new ReviewQueue();
  assertEquals(queue.progressPct, 0);
});

Deno.test("ReviewQueue - has fetchNext method", () => {
  const queue = new ReviewQueue();
  assertEquals(typeof queue.fetchNext, "function");
});

Deno.test("ReviewQueue - has decide method", () => {
  const queue = new ReviewQueue();
  assertEquals(typeof queue.decide, "function");
});

Deno.test("ReviewQueue - has goBack method", () => {
  const queue = new ReviewQueue();
  assertEquals(typeof queue.goBack, "function");
});

Deno.test("ReviewQueue - has computeLevel method", () => {
  const queue = new ReviewQueue();
  assertEquals(typeof queue.computeLevel, "function");
});

Deno.test("ReviewQueue - has showToast method", () => {
  const queue = new ReviewQueue();
  assertEquals(typeof queue.showToast, "function");
});

Deno.test("ReviewQueue - speedAvg defaults to '--'", () => {
  const queue = new ReviewQueue();
  assertEquals(queue.speedAvg, "--");
});

Deno.test("ReviewQueue - timeBankVal defaults to 0", () => {
  const queue = new ReviewQueue();
  assertEquals(queue.timeBankVal, 0);
});

Deno.test("ReviewQueue - confirmOpen defaults to false", () => {
  const queue = new ReviewQueue();
  assertEquals(queue.confirmOpen, false);
});

Deno.test("ReviewQueue - confirmInput defaults to empty string", () => {
  const queue = new ReviewQueue();
  assertEquals(queue.confirmInput, "");
});

Deno.test("ReviewQueue - currentTranscript defaults to null", () => {
  const queue = new ReviewQueue();
  assertEquals(queue.currentTranscript, null);
});

Deno.test("ReviewQueue - auditRemaining defaults to 0", () => {
  const queue = new ReviewQueue();
  assertEquals(queue.auditRemaining, 0);
});

Deno.test("ReviewQueue - summaryHtml defaults to empty string", () => {
  const queue = new ReviewQueue();
  assertEquals(queue.summaryHtml, "");
});

Deno.test("ReviewQueue - pendingDecision defaults to null", () => {
  const queue = new ReviewQueue();
  assertEquals(queue.pendingDecision, null);
});

Deno.test("ReviewQueue - pendingReason defaults to null", () => {
  const queue = new ReviewQueue();
  assertEquals(queue.pendingReason, null);
});

Deno.test("ReviewQueue - streakBannerText defaults to empty string", () => {
  const queue = new ReviewQueue();
  assertEquals(queue.streakBannerText, "");
});

Deno.test("ReviewQueue - streakBannerVisible defaults to false", () => {
  const queue = new ReviewQueue();
  assertEquals(queue.streakBannerVisible, false);
});

Deno.test("ReviewQueue - toasts defaults to empty array", () => {
  const queue = new ReviewQueue();
  assertEquals(queue.toasts, []);
});
