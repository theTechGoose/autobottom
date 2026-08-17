/** Smoke tests for genie adapter — tests pure validation logic only. */
import { assertEquals, assert } from "#assert";
import { isValidAudio, pickExactContract } from "./mod.ts";

// Real rows from Genie's job search for the truncated genie 2764973 (record
// 500952) — a prefix match, three different guests' calls.
const PREFIX_ROWS = [
  { contract: "27649730", btn: "8605593125", src: "https://judge2.contractgenie.com/mp3/9152/27649730_a.mp3" },
  { contract: "27649736", btn: "8658036420", src: "https://judge2.contractgenie.com/mp3/9152/27649736_b.mp3" },
  { contract: "27649733", btn: "9126171899", src: "https://judge2.contractgenie.com/mp3/9152/27649733_c.mp3" },
];

Deno.test("pickExactContract — truncated genie matches nothing, does not grab row 0", () => {
  assertEquals(pickExactContract(PREFIX_ROWS, 2764973, "primary", "t", "job search"), null);
});

Deno.test("pickExactContract — picks the matching row, not the first row", () => {
  assertEquals(
    pickExactContract(PREFIX_ROWS, 27649736, "primary", "t", "job search"),
    "https://judge2.contractgenie.com/mp3/9152/27649736_b.mp3",
  );
});

Deno.test("pickExactContract — numeric contract field matches too", () => {
  const rows = [{ contract: 27649736, src: "https://judge2.contractgenie.com/mp3/9152/x.mp3" }];
  assertEquals(pickExactContract(rows, 27649736, "primary", "t", "search"), "https://judge2.contractgenie.com/mp3/9152/x.mp3");
});

Deno.test("pickExactContract — 'no recording' placeholder rows rejected", () => {
  const rows = [{ client_id: 0, contract: "", checksum: "23231" }];
  assertEquals(pickExactContract(rows, 27649737, "primary", "t", "search"), null);
});

Deno.test("pickExactContract — matching contract with blank src rejected", () => {
  const rows = [{ contract: "27649736", src: "   " }];
  assertEquals(pickExactContract(rows, 27649736, "primary", "t", "search"), null);
});

Deno.test("pickExactContract — empty result set rejected", () => {
  assertEquals(pickExactContract([], 27649736, "primary", "t", "search"), null);
});

Deno.test("isValidAudio — MP3 ID3 header detected", () => {
  const bytes = new Uint8Array([0x49, 0x44, 0x33, 0x00, 0x00]);
  assert(isValidAudio(bytes));
});

Deno.test("isValidAudio — MP3 frame sync detected", () => {
  const bytes = new Uint8Array([0xFF, 0xFB, 0x90, 0x00]);
  assert(isValidAudio(bytes));
});

Deno.test("isValidAudio — WAV RIFF header detected", () => {
  const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00]);
  assert(isValidAudio(bytes));
});

Deno.test("isValidAudio — OGG header detected", () => {
  const bytes = new Uint8Array([0x4F, 0x67, 0x67, 0x53, 0x00]);
  assert(isValidAudio(bytes));
});

Deno.test("isValidAudio — HTML response rejected", () => {
  const bytes = new TextEncoder().encode("<html><body>Error</body></html>");
  assertEquals(isValidAudio(bytes), false);
});

Deno.test("isValidAudio — empty bytes rejected", () => {
  assertEquals(isValidAudio(new Uint8Array([0x00, 0x00, 0x00])), false);
});
