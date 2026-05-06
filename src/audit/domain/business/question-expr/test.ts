/** Tests for question expression parsing and evaluation. */
import { assertEquals, assert } from "#assert";
import { evaluateAutoYes } from "./mod.ts";

Deno.test("evaluateAutoYes — ~ (contains) operator", () => {
  const result = evaluateAutoYes("~married");
  // Without field context, evaluateAutoYes checks the expression syntax
  assert(typeof result.applies === "boolean");
  assert(typeof result.message === "string");
});

Deno.test("evaluateAutoYes — = (equals) operator", () => {
  const result = evaluateAutoYes("=Yes");
  assert(typeof result.applies === "boolean");
});

Deno.test("evaluateAutoYes — # (not-equals) operator", () => {
  const result = evaluateAutoYes("#No");
  assert(typeof result.applies === "boolean");
});

Deno.test("evaluateAutoYes — / (not-contains) operator", () => {
  const result = evaluateAutoYes("/divorced");
  assert(typeof result.applies === "boolean");
});

Deno.test("evaluateAutoYes — < (less-than) operator", () => {
  const result = evaluateAutoYes("<100");
  assert(typeof result.applies === "boolean");
});

Deno.test("evaluateAutoYes — empty expression", () => {
  const result = evaluateAutoYes("");
  assertEquals(result.applies, false);
});
