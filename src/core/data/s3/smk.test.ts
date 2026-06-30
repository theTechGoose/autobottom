import { assert, assertEquals } from "#assert";
import { resolveByteRange, buildAudioResponse, s3FetchWithRetry, S3Ref } from "./mod.ts";

Deno.test("s3 — module loads", () => { assert(true); });

// ── s3FetchWithRetry — transient network retry ───────────────────────────────
// A ~1s DNS blip at S3 upload time was stranding whole audits (queued steps get
// no QStash retry + lose their watchdog row). These pin the retry behavior.
// fetch + setTimeout are stubbed so the backoff doesn't make the test sleep.

/** Run `fn` with fetch + setTimeout stubbed; setTimeout fires instantly. */
async function withStubs(fetchImpl: () => Promise<Response>, fn: () => Promise<void>) {
  const realFetch = globalThis.fetch;
  const realSetTimeout = globalThis.setTimeout;
  // deno-lint-ignore no-explicit-any
  globalThis.fetch = (() => fetchImpl()) as any;
  // deno-lint-ignore no-explicit-any
  globalThis.setTimeout = ((cb: () => void) => { cb(); return 0; }) as any;
  try { await fn(); } finally {
    globalThis.fetch = realFetch;
    globalThis.setTimeout = realSetTimeout;
  }
}

Deno.test("s3FetchWithRetry — retries a transient throw then succeeds", async () => {
  let calls = 0;
  await withStubs(
    () => {
      calls++;
      if (calls === 1) throw new TypeError("error sending request: dns error: Temporary failure in name resolution");
      return Promise.resolve(new Response("ok", { status: 200 }));
    },
    async () => {
      const res = await s3FetchWithRetry("https://x/y", { method: "PUT" }, "PUT");
      assertEquals(res.status, 200);
      assertEquals(calls, 2, "should have retried once after the DNS throw");
    },
  );
});

Deno.test("s3FetchWithRetry — throws after exhausting attempts on persistent failure", async () => {
  let calls = 0;
  let threw = false;
  await withStubs(
    () => { calls++; throw new TypeError("dns error: Temporary failure in name resolution"); },
    async () => {
      try { await s3FetchWithRetry("https://x/y", { method: "PUT" }, "PUT"); }
      catch { threw = true; }
    },
  );
  assert(threw, "must propagate after all attempts fail");
  assertEquals(calls, 3, "3 attempts total");
});

Deno.test("s3FetchWithRetry — retries a 5xx then returns success", async () => {
  let calls = 0;
  await withStubs(
    () => {
      calls++;
      return Promise.resolve(calls === 1 ? new Response("slow down", { status: 503 }) : new Response("ok", { status: 200 }));
    },
    async () => {
      const res = await s3FetchWithRetry("https://x/y", { method: "GET" }, "GET");
      assertEquals(res.status, 200);
      assertEquals(calls, 2);
    },
  );
});

Deno.test("s3FetchWithRetry — does NOT retry a 404 (returns immediately)", async () => {
  let calls = 0;
  await withStubs(
    () => { calls++; return Promise.resolve(new Response("", { status: 404 })); },
    async () => {
      const res = await s3FetchWithRetry("https://x/y", { headers: {} }, "GET");
      assertEquals(res.status, 404);
      assertEquals(calls, 1, "404 is terminal — no retry");
    },
  );
});

// ── S3Ref.get/save — non-ok HTTP handling (404 → null, other 4xx → throw) ─────
// s3FetchWithRetry returns 4xx unretried; the throw-on-non-ok logic lives in
// S3Ref itself. These pin that a 404 (object absent) maps to null while a real
// failure surfaces as a thrown error with the status — so a future refactor
// can't silently swallow a 403 into null/empty. signV4 runs with empty creds
// (env unset) and fetch is stubbed, so no AWS setup is needed.

Deno.test("S3Ref.get — 404 resolves to null (object absent, not an error)", async () => {
  await withStubs(
    () => Promise.resolve(new Response("", { status: 404 })),
    async () => assertEquals(await new S3Ref("bucket", "key").get(), null),
  );
});

Deno.test("S3Ref.get — a NoSuchKey body (non-404) also resolves to null", async () => {
  await withStubs(
    () => Promise.resolve(new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 403 })),
    async () => assertEquals(await new S3Ref("bucket", "key").get(), null),
  );
});

Deno.test("S3Ref.get — a real 403 throws with the status in the message", async () => {
  let msg = "";
  await withStubs(
    () => Promise.resolve(new Response("AccessDenied", { status: 403 })),
    async () => {
      try { await new S3Ref("bucket", "key").get(); }
      catch (e) { msg = e instanceof Error ? e.message : String(e); }
    },
  );
  assert(msg.includes("403"), `403 must throw with the status surfaced, got: ${msg || "<no throw>"}`);
});

Deno.test("S3Ref.save — a non-2xx (403) throws with the status in the message", async () => {
  let msg = "";
  await withStubs(
    () => Promise.resolve(new Response("AccessDenied", { status: 403 })),
    async () => {
      try { await new S3Ref("bucket", "key").save("payload"); }
      catch (e) { msg = e instanceof Error ? e.message : String(e); }
    },
  );
  assert(msg.includes("403"), `403 must throw with the status surfaced, got: ${msg || "<no throw>"}`);
});

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
const TEN = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

Deno.test("buildAudioResponse — no Range → 200 full body + content-length", async () => {
  const res = buildAudioResponse(TEN, null);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "audio/mpeg");
  assertEquals(res.headers.get("accept-ranges"), "bytes");
  assertEquals(res.headers.get("content-length"), "10");
  assertEquals(res.headers.get("content-range"), null);
  assertEquals(new Uint8Array(await res.arrayBuffer()), TEN);
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
  assertEquals(new Uint8Array(await res.arrayBuffer()), TEN);
});
