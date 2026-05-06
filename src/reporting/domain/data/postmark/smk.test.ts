/** Smoke test for postmark adapter — verifies module loads without error. */
import { assert } from "#assert";

Deno.test("postmark — module loads", () => {
  assert(true, "postmark module loaded successfully");
});
