/** Tests for multi-genie audio stitching logic.
 *  Validates that multiple MP3 byte arrays are correctly concatenated
 *  into a single continuous file. */

import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";

// -- Pure stitching logic (extracted for testability) --

/** Concatenate multiple audio byte arrays into one continuous MP3. */
export function stitchAudioBuffers(buffers: Uint8Array[]): Uint8Array {
  if (buffers.length === 0) return new Uint8Array(0);
  if (buffers.length === 1) return buffers[0];
  const totalBytes = buffers.reduce((sum, b) => sum + b.byteLength, 0);
  const stitched = new Uint8Array(totalBytes);
  let offset = 0;
  for (const buf of buffers) {
    stitched.set(buf, offset);
    offset += buf.byteLength;
  }
  return stitched;
}

// -- Tests --

Deno.test("stitchAudioBuffers — empty array returns empty buffer", () => {
  const result = stitchAudioBuffers([]);
  assertEquals(result.byteLength, 0);
});

Deno.test("stitchAudioBuffers — single buffer returns same buffer", () => {
  const input = new Uint8Array([0xFF, 0xFB, 0x90, 0x00, 0x01, 0x02]);
  const result = stitchAudioBuffers([input]);
  assertEquals(result, input);
  assertEquals(result.byteLength, 6);
});

Deno.test("stitchAudioBuffers — two buffers are concatenated in order", () => {
  const buf1 = new Uint8Array([0xFF, 0xFB, 0x90, 0x00]); // fake MP3 frame header + data
  const buf2 = new Uint8Array([0xFF, 0xFB, 0xA0, 0x01]);
  const result = stitchAudioBuffers([buf1, buf2]);
  assertEquals(result.byteLength, 8);
  // First 4 bytes = buf1
  assertEquals(result[0], 0xFF);
  assertEquals(result[1], 0xFB);
  assertEquals(result[2], 0x90);
  assertEquals(result[3], 0x00);
  // Next 4 bytes = buf2
  assertEquals(result[4], 0xFF);
  assertEquals(result[5], 0xFB);
  assertEquals(result[6], 0xA0);
  assertEquals(result[7], 0x01);
});

Deno.test("stitchAudioBuffers — three buffers concatenated correctly", () => {
  const buf1 = new Uint8Array([1, 2, 3]);
  const buf2 = new Uint8Array([4, 5]);
  const buf3 = new Uint8Array([6, 7, 8, 9]);
  const result = stitchAudioBuffers([buf1, buf2, buf3]);
  assertEquals(result.byteLength, 9);
  assertEquals(Array.from(result), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

Deno.test("stitchAudioBuffers — preserves MP3 sync bytes at boundaries", () => {
  // Real MP3 frames start with 0xFF 0xFB (sync word). Stitching must not corrupt boundaries.
  const frame1 = new Uint8Array([0xFF, 0xFB, 0x90, 0x00, 0xAA, 0xBB]);
  const frame2 = new Uint8Array([0xFF, 0xFB, 0x90, 0x00, 0xCC, 0xDD]);
  const result = stitchAudioBuffers([frame1, frame2]);
  // Verify boundary: byte 6 should be the start of frame2's sync word
  assertEquals(result[6], 0xFF);
  assertEquals(result[7], 0xFB);
  assertEquals(result.byteLength, 12);
});

Deno.test("stitchAudioBuffers — large buffers (simulated real recordings)", () => {
  // Simulate two ~100KB recordings
  const size1 = 100_000;
  const size2 = 150_000;
  const buf1 = new Uint8Array(size1);
  const buf2 = new Uint8Array(size2);
  // Fill with identifiable patterns
  buf1.fill(0xAA);
  buf2.fill(0xBB);
  const result = stitchAudioBuffers([buf1, buf2]);
  assertEquals(result.byteLength, size1 + size2);
  // Check boundary
  assertEquals(result[size1 - 1], 0xAA);
  assertEquals(result[size1], 0xBB);
});
