import { assertEquals } from "#assert";
import { firstGenieId, splitGenieIds } from "./mod.ts";

Deno.test("splitGenieIds — every run of digits is one ID, whatever separates them", () => {
  assertEquals(splitGenieIds("27660806,27660810"), ["27660806", "27660810"]);
  assertEquals(splitGenieIds("27660806; 27660810"), ["27660806", "27660810"]);
  assertEquals(splitGenieIds("27660806 / 27660810"), ["27660806", "27660810"]);
  assertEquals(splitGenieIds("27660806 and 27660810"), ["27660806", "27660810"]);
  assertEquals(splitGenieIds(" 27660806 , 27660810 "), ["27660806", "27660810"]);
  // The same recording typed twice is still two entries — de-duping is not
  // this function's call; step-init downloads what the record says.
  assertEquals(splitGenieIds("27621999,27621999"), ["27621999", "27621999"]);
});

Deno.test("splitGenieIds — a single ID keeps its shape, a note on the end is dropped", () => {
  assertEquals(splitGenieIds("27475188"), ["27475188"]);
  assertEquals(splitGenieIds("27475188-error"), ["27475188"]);
  assertEquals(splitGenieIds(27475188), ["27475188"]);
});

Deno.test("splitGenieIds — nothing to read gives an empty list, never a bad ID", () => {
  assertEquals(splitGenieIds(""), []);
  assertEquals(splitGenieIds("   "), []);
  assertEquals(splitGenieIds("none"), []);
  assertEquals(splitGenieIds(null), []);
  assertEquals(splitGenieIds(undefined), []);
});

Deno.test("firstGenieId — the first ID alone, or \"\"", () => {
  assertEquals(firstGenieId("27660806; 27660810"), "27660806");
  assertEquals(firstGenieId("27475188-error"), "27475188");
  assertEquals(firstGenieId("no digits here"), "");
  assertEquals(firstGenieId(undefined), "");
});
