import { assertEquals } from "@std/assert";
import { chunkText } from "./mod.ts";

// ---------------------------------------------------------------------------
// Empty / trivial input
// ---------------------------------------------------------------------------

Deno.test("chunkText: empty string returns empty array", () => {
  assertEquals(chunkText(""), []);
});

Deno.test("chunkText: whitespace-only string returns empty array", () => {
  assertEquals(chunkText("   "), []);
});

Deno.test("chunkText: single short sentence returns one chunk", () => {
  const result = chunkText("Hello world.");
  assertEquals(result.length, 1);
  assertEquals(result[0], "Hello world.");
});

// ---------------------------------------------------------------------------
// Single chunk (text fits within maxChunkSize)
// ---------------------------------------------------------------------------

Deno.test("chunkText: text shorter than maxChunkSize is one chunk", () => {
  const text = "This is a sentence. And another one. And a third!";
  const result = chunkText(text, 2000);
  assertEquals(result.length, 1);
  assertEquals(result[0], text.trim());
});

// ---------------------------------------------------------------------------
// Multiple chunks (text exceeds maxChunkSize)
// ---------------------------------------------------------------------------

Deno.test("chunkText: text exceeding maxChunkSize splits into multiple chunks", () => {
  // Build text with enough sentences to exceed 50 chars per chunk
  const sentence = "This is a sentence that is reasonably long.";
  const text = Array(10).fill(sentence).join(" ");
  const result = chunkText(text, 50);
  // Should produce more than one chunk
  assertEquals(result.length > 1, true);
});

Deno.test("chunkText: splits into more chunks when maxChunkSize is small", () => {
  // 20 repetitions of a ~49-char sentence at maxChunkSize=100 must produce more
  // than 1 chunk, confirming the split logic runs.
  const sentence = "Word word word word word word word word word end.";
  const text = Array(20).fill(sentence).join(" ");
  const result = chunkText(text, 100);
  assertEquals(result.length > 1, true);
});

// ---------------------------------------------------------------------------
// Overlap behaviour
// ---------------------------------------------------------------------------

Deno.test("chunkText: subsequent chunks share words from previous chunk (overlap)", () => {
  // Use a small maxChunkSize and small overlap to force multiple chunks
  const words = Array.from({ length: 100 }, (_, i) => `word${i}`);
  // Build sentences of ~30 chars each
  const sentences: string[] = [];
  for (let i = 0; i < words.length; i += 3) {
    sentences.push(`${words[i]} ${words[i + 1] ?? "end"} ${words[i + 2] ?? "end"}.`);
  }
  const text = sentences.join(" ");
  const result = chunkText(text, 80, 20);
  if (result.length >= 2) {
    // Last words of chunk[0] should appear at the start of chunk[1]
    const lastWordsOfFirst = result[0].split(/\s+/).slice(-3).join(" ");
    // The overlap words should appear somewhere in the second chunk
    const secondChunkContainsOverlap = result[1].includes(lastWordsOfFirst.split(" ")[0]);
    assertEquals(secondChunkContainsOverlap, true);
  }
});

// ---------------------------------------------------------------------------
// All chunks are trimmed (no leading/trailing whitespace)
// ---------------------------------------------------------------------------

Deno.test("chunkText: all returned chunks are trimmed", () => {
  const sentence = "Padded sentence here. ";
  const text = Array(15).fill(sentence).join(" ");
  const result = chunkText(text, 80);
  for (const chunk of result) {
    assertEquals(chunk, chunk.trim(), `Chunk has surrounding whitespace: "${chunk}"`);
  }
});

// ---------------------------------------------------------------------------
// Custom maxChunkSize and overlap parameters
// ---------------------------------------------------------------------------

Deno.test("chunkText: maxChunkSize=100 overlap=10 produces more chunks than maxChunkSize=500", () => {
  const sentence = "This is a test sentence for chunking purposes.";
  const text = Array(30).fill(sentence).join(" ");
  const smallChunks = chunkText(text, 100, 10);
  const largeChunks = chunkText(text, 500, 10);
  assertEquals(smallChunks.length > largeChunks.length, true);
});

Deno.test("chunkText: text with no sentence-ending punctuation is one chunk if under limit", () => {
  const text = "This has no ending punctuation and is short";
  const result = chunkText(text, 2000);
  assertEquals(result.length, 1);
  assertEquals(result[0], text);
});
