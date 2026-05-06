/** Smoke tests for genie adapter — tests pure validation logic only. */
import { assertEquals, assert } from "#assert";
import { isValidAudio } from "./mod.ts";

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
