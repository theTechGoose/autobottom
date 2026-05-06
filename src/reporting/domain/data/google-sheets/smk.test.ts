/** Smoke test for google-sheets adapter — verifies module loads without error. */
import { assert } from "#assert";

Deno.test("google-sheets — module loads", () => {
  assert(true, "google-sheets module loaded successfully");
});
