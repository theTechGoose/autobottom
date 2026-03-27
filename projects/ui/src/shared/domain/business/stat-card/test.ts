import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { StatCard } from "./mod.ts";

Deno.test("StatCard - has required label property", () => {
  const card = new StatCard();
  card.label = "Total Users";
  assertEquals(card.label, "Total Users");
});

Deno.test("StatCard - has required value property", () => {
  const card = new StatCard();
  card.value = "1,234";
  assertEquals(card.value, "1,234");
});

Deno.test("StatCard - default color is var(--blue)", () => {
  const card = new StatCard();
  assertEquals(card.color, "var(--blue)");
});

Deno.test("StatCard - color can be overridden", () => {
  const card = new StatCard();
  card.color = "var(--red)";
  assertEquals(card.color, "var(--red)");
});
