import { assert, assertEquals } from "#assert";
import { resolveByteRange, buildAudioResponse } from "./mod.ts";

Deno.test("s3 — module loads", () => { assert(true); });

// ── resolveByteRange — HTTP Range parsing for <audio> seeking ────────────────
// This is what makes click-to-scrub work: the /audit/recording handler must
// answer a `Range:` request with a 206 slice, not the full 200 body.

Deno.test("resolveByteRange — no header → full file (null)", () => {
  assertEquals(resolveByteRange(null, 1000), null);
  assertEquals(resolveByteRange(undefined, 1000), null);
  assertEquals(resolveByteRange("", 1000), null);
});

Deno.test("resolveByteRange — closed range bytes=100-199", () => {
  assertEquals(resolveByteRange("bytes=100-199", 1000), { start: 100, end: 199 });
});

Deno.test("resolveByteRange — open-ended bytes=500- clamps to end", () => {
  assertEquals(resolveByteRange("bytes=500-", 1000), { start: 500, end: 999 });
});

Deno.test("resolveByteRange — end past total clamps to last byte", () => {
  assertEquals(resolveByteRange("bytes=0-99999", 1000), { start: 0, end: 999 });
});

Deno.test("resolveByteRange — suffix bytes=-200 → last 200 bytes", () => {
  assertEquals(resolveByteRange("bytes=-200", 1000), { start: 800, end: 999 });
});

Deno.test("resolveByteRange — suffix larger than file clamps start to 0", () => {
  assertEquals(resolveByteRange("bytes=-5000", 1000), { start: 0, end: 999 });
});

Deno.test("resolveByteRange — suffix bytes=-0 (last 0 bytes) is unsatisfiable", () => {
  // RFC 7233: a suffix length of 0 has no satisfiable bytes → 416, not a 0-byte 206.
  assertEquals(resolveByteRange("bytes=-0", 1000), "unsatisfiable");
});

Deno.test("resolveByteRange — start at/after EOF is unsatisfiable", () => {
  assertEquals(resolveByteRange("bytes=1000-", 1000), "unsatisfiable");
  assertEquals(resolveByteRange("bytes=1500-1600", 1000), "unsatisfiable");
});

Deno.test("resolveByteRange — start > end is unsatisfiable", () => {
  assertEquals(resolveByteRange("bytes=300-200", 1000), "unsatisfiable");
});

Deno.test("resolveByteRange — empty file → null (serve full/empty 200)", () => {
  assertEquals(resolveByteRange("bytes=0-99", 0), null);
});

Deno.test("resolveByteRange — non-bytes unit or junk → null", () => {
  assertEquals(resolveByteRange("items=0-99", 1000), null);
  assertEquals(resolveByteRange("bytes=abc", 1000), null);
  assertEquals(resolveByteRange("bytes=-", 1000), null);
});

Deno.test("resolveByteRange — single byte bytes=0-0", () => {
  assertEquals(resolveByteRange("bytes=0-0", 1000), { start: 0, end: 0 });
});

// ── buildAudioResponse — the 206 / 416 / 200 wiring the <audio> seek relies on ──
function bodyBytes(buf: Uint8Array): Uint8Array { return buf; }
const TEN = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

Deno.test("buildAudioResponse — no Range → 200 full body + content-length", async () => {
  const res = buildAudioResponse(TEN, null);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "audio/mpeg");
  assertEquals(res.headers.get("accept-ranges"), "bytes");
  assertEquals(res.headers.get("content-length"), "10");
  assertEquals(res.headers.get("content-range"), null);
  assertEquals(new Uint8Array(await res.arrayBuffer()), bodyBytes(TEN));
});

Deno.test("buildAudioResponse — closed Range → 206 with content-range + sliced body", async () => {
  const res = buildAudioResponse(TEN, "bytes=2-5");
  assertEquals(res.status, 206);
  assertEquals(res.headers.get("content-range"), "bytes 2-5/10");
  assertEquals(res.headers.get("content-length"), "4");
  assertEquals(new Uint8Array(await res.arrayBuffer()), new Uint8Array([2, 3, 4, 5]));
});

Deno.test("buildAudioResponse — open-ended Range → 206 to EOF", async () => {
  const res = buildAudioResponse(TEN, "bytes=7-");
  assertEquals(res.status, 206);
  assertEquals(res.headers.get("content-range"), "bytes 7-9/10");
  assertEquals(new Uint8Array(await res.arrayBuffer()), new Uint8Array([7, 8, 9]));
});

Deno.test("buildAudioResponse — suffix Range → 206 last N bytes", async () => {
  const res = buildAudioResponse(TEN, "bytes=-3");
  assertEquals(res.status, 206);
  assertEquals(res.headers.get("content-range"), "bytes 7-9/10");
  assertEquals(new Uint8Array(await res.arrayBuffer()), new Uint8Array([7, 8, 9]));
});

Deno.test("buildAudioResponse — out-of-bounds Range → 416 with content-range */total", async () => {
  const res = buildAudioResponse(TEN, "bytes=50-60");
  assertEquals(res.status, 416);
  assertEquals(res.headers.get("content-range"), "bytes */10");
  assertEquals((await res.arrayBuffer()).byteLength, 0);
});

Deno.test("buildAudioResponse — junk Range header → 200 full body", async () => {
  const res = buildAudioResponse(TEN, "bytes=abc");
  assertEquals(res.status, 200);
  assertEquals(new Uint8Array(await res.arrayBuffer()), bodyBytes(TEN));
});
