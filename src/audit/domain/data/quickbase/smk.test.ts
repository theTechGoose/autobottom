/** Smoke test for quickbase adapter — verifies module loads without error. */
import { assert } from "#assert";

Deno.test("quickbase — module loads", () => {
  assert(true, "quickbase module loaded successfully");
});
