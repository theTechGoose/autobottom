import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ReviewStatCards } from "./mod.ts";

Deno.test("ReviewStatCards - can be instantiated", () => {
  const cards = new ReviewStatCards();
  assertEquals(typeof cards, "object");
});

Deno.test("ReviewStatCards - totalReviewed defaults to 0", () => {
  const cards = new ReviewStatCards();
  assertEquals(cards.totalReviewed, 0);
});

Deno.test("ReviewStatCards - confirmed defaults to 0", () => {
  const cards = new ReviewStatCards();
  assertEquals(cards.confirmed, 0);
});

Deno.test("ReviewStatCards - flipped defaults to 0", () => {
  const cards = new ReviewStatCards();
  assertEquals(cards.flipped, 0);
});

Deno.test("ReviewStatCards - accuracy defaults to '--'", () => {
  const cards = new ReviewStatCards();
  assertEquals(cards.accuracy, "--");
});

Deno.test("ReviewStatCards - avgTime defaults to '--'", () => {
  const cards = new ReviewStatCards();
  assertEquals(cards.avgTime, "--");
});

Deno.test("ReviewStatCards - streak defaults to 0", () => {
  const cards = new ReviewStatCards();
  assertEquals(cards.streak, 0);
});
