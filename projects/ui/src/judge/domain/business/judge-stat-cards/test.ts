import { assertEquals } from "jsr:@std/assert";
import { JudgeStatCards } from "./mod.ts";

Deno.test("JudgeStatCards - default totalJudged is 0", () => {
  const cards = new JudgeStatCards();
  assertEquals(cards.totalJudged, 0);
});

Deno.test("JudgeStatCards - default upheld is 0", () => {
  const cards = new JudgeStatCards();
  assertEquals(cards.upheld, 0);
});

Deno.test("JudgeStatCards - default overturned is 0", () => {
  const cards = new JudgeStatCards();
  assertEquals(cards.overturned, 0);
});

Deno.test("JudgeStatCards - default accuracy is '--'", () => {
  const cards = new JudgeStatCards();
  assertEquals(cards.accuracy, "--");
});

Deno.test("JudgeStatCards - default avgTime is '--'", () => {
  const cards = new JudgeStatCards();
  assertEquals(cards.avgTime, "--");
});

Deno.test("JudgeStatCards - default streak is 0", () => {
  const cards = new JudgeStatCards();
  assertEquals(cards.streak, 0);
});

Deno.test("JudgeStatCards - all inputs can be overridden", () => {
  const cards = new JudgeStatCards();
  cards.totalJudged = 42;
  cards.upheld = 30;
  cards.overturned = 12;
  cards.accuracy = "71.4%";
  cards.avgTime = "5.2s";
  cards.streak = 7;
  assertEquals(cards.totalJudged, 42);
  assertEquals(cards.upheld, 30);
  assertEquals(cards.overturned, 12);
  assertEquals(cards.accuracy, "71.4%");
  assertEquals(cards.avgTime, "5.2s");
  assertEquals(cards.streak, 7);
});
