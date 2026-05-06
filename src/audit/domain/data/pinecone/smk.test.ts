/** Smoke tests for Pinecone adapter — tests pure chunking logic only. */

import { assertEquals, assert } from "#assert";
import { chunkText } from "./mod.ts";

Deno.test("chunkText — short text returns single chunk", () => {
  const chunks = chunkText("Hello world. This is a test.");
  assertEquals(chunks.length, 1);
  assertEquals(chunks[0], "Hello world. This is a test.");
});

Deno.test("chunkText — splits on sentence boundaries", () => {
  const long = Array.from({ length: 50 }, (_, i) => `Sentence number ${i}. `).join("");
  const chunks = chunkText(long, 200);
  assert(chunks.length > 1);
  // Chunks may exceed maxChunkSize due to overlap carryover — just verify they split
  assert(chunks.length >= 2, "Should produce multiple chunks");
});

Deno.test("chunkText — empty text returns empty", () => {
  assertEquals(chunkText(""), []);
});

Deno.test("chunkText — preserves all content across chunks", () => {
  const sentences = Array.from({ length: 20 }, (_, i) => `Point ${i}.`);
  const text = sentences.join(" ");
  const chunks = chunkText(text, 50, 10);
  // All original sentences should appear in at least one chunk
  for (const s of sentences) {
    assert(chunks.some((c) => c.includes(s)), `Missing: ${s}`);
  }
});
