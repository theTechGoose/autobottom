import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { Counter } from "./mod.ts";

Deno.test("Counter - default count is 0", () => {
  const counter = new Counter();
  assertEquals(counter.count, 0);
});

Deno.test("Counter - increment increases count by 1", () => {
  const counter = new Counter();
  counter.increment();
  assertEquals(counter.count, 1);
});

Deno.test("Counter - decrement decreases count by 1", () => {
  const counter = new Counter();
  counter.decrement();
  assertEquals(counter.count, -1);
});

Deno.test("Counter - multiple increments accumulate", () => {
  const counter = new Counter();
  counter.increment();
  counter.increment();
  counter.increment();
  assertEquals(counter.count, 3);
});

Deno.test("Counter - increment and decrement together", () => {
  const counter = new Counter();
  counter.increment();
  counter.increment();
  counter.decrement();
  assertEquals(counter.count, 1);
});
