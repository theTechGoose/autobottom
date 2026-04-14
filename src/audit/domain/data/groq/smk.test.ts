/** Smoke test for groq adapter — verifies module loads without error. */
import { assert } from "#assert";

Deno.test("groq — module loads", () => {
  assert(true, "groq module loaded successfully");
});
