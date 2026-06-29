/** The "Always include these emails" field must split a pasted/typed
 *  comma-separated list into separate emails — not drop the whole string in as
 *  one giant non-email chip (which would then be sent as a single bad
 *  recipient). */
import { assertEquals } from "@std/assert";
import { mergeEmailInput } from "../../islands/WeeklyBuilderEditor.tsx";

Deno.test("mergeEmailInput — splits a pasted comma-separated list into separate emails", () => {
  const out = mergeEmailInput([], "accounting@monsterrg.com, alexandera@monsterrg.com, support@monsterrg.com");
  assertEquals(out, ["accounting@monsterrg.com", "alexandera@monsterrg.com", "support@monsterrg.com"]);
});

Deno.test("mergeEmailInput — splits on commas, semicolons, and whitespace", () => {
  assertEquals(
    mergeEmailInput([], "a@x.com,b@x.com; c@x.com\n d@x.com"),
    ["a@x.com", "b@x.com", "c@x.com", "d@x.com"],
  );
});

Deno.test("mergeEmailInput — dedupes case-insensitively, against existing + within the paste", () => {
  assertEquals(mergeEmailInput(["A@x.com"], "a@X.com, b@x.com, B@x.com"), ["A@x.com", "b@x.com"]);
});

Deno.test("mergeEmailInput — trims and drops empties; whitespace/punctuation-only input is a no-op", () => {
  assertEquals(mergeEmailInput(["a@x.com"], "  ,  ; "), ["a@x.com"]);
  assertEquals(mergeEmailInput([], " b@x.com "), ["b@x.com"]);
});
