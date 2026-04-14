/** Smoke tests for bad word detection — pure logic only. */
import { assertEquals, assert } from "jsr:@std/assert";
import { detectBadWords } from "./mod.ts";

Deno.test("detectBadWords — finds simple word match", () => {
  const result = detectBadWords("the customer said a bad word during the call", ["bad"]);
  assert(result.violations.length > 0);
  assert(result.matches.some((m) => m.word === "bad"));
});

Deno.test("detectBadWords — no match returns empty", () => {
  const result = detectBadWords("the customer was very happy with the service", ["terrible"]);
  assertEquals(result.violations.length, 0);
  assertEquals(result.matches.length, 0);
});

Deno.test("detectBadWords — case insensitive", () => {
  const result = detectBadWords("The customer said BAD things", ["bad"]);
  assert(result.violations.length > 0);
});

Deno.test("detectBadWords — empty transcript returns empty", () => {
  const result = detectBadWords("", ["bad"]);
  assertEquals(result.matches.length, 0);
});

Deno.test("detectBadWords — empty word list returns empty", () => {
  const result = detectBadWords("some transcript text", []);
  assertEquals(result.matches.length, 0);
});
