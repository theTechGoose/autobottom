/**
 * S3 adapter using native fetch + AWS Signature V4.
 * Ported from lib/s3.ts — deploy-compatible, no AWS SDK dependency.
 */
import { withSpan, metric } from "@core/data/datadog-otel/mod.ts";

const region = () => Deno.env.get("AWS_REGION") ?? "us-east-1";
const accessKey = () => Deno.env.get("AWS_ACCESS_KEY_ID") ?? "";
const secretKey = () => Deno.env.get("AWS_SECRET_ACCESS_KEY") ?? "";

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data));
}

async function sha256(data: Uint8Array | string): Promise<string> {
  const buf = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest("SHA-256", buf as BufferSource);
  return hex(new Uint8Array(hash));
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function signV4(method: string, bucket: string, key: string, payloadHash: string, headers: Record<string, string>) {
  const r = region();
  const host = `${bucket}.s3.${r}.amazonaws.com`;
  const now = new Date();
  const dateStamp = now.toISOString().replace(/[-:]/g, "").slice(0, 8);
  const amzDate = dateStamp + "T" + now.toISOString().replace(/[-:]/g, "").slice(9, 15) + "Z";
  const scope = `${dateStamp}/${r}/s3/aws4_request`;

  headers["host"] = host;
  headers["x-amz-date"] = amzDate;
  headers["x-amz-content-sha256"] = payloadHash;

  const signedHeaderKeys = Object.keys(headers).sort();
  const signedHeaders = signedHeaderKeys.join(";");
  const canonicalHeaders = signedHeaderKeys.map(k => `${k}:${headers[k]}\n`).join("");
  const encodedKey = "/" + key.split("/").map(s => encodeURIComponent(s)).join("/");
  const canonicalRequest = `${method}\n${encodedKey}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const crHash = await sha256(canonicalRequest);
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${crHash}`;

  const sk = secretKey();
  let signingKey: ArrayBuffer = await hmac(new TextEncoder().encode("AWS4" + sk), dateStamp);
  signingKey = await hmac(signingKey, r);
  signingKey = await hmac(signingKey, "s3");
  signingKey = await hmac(signingKey, "aws4_request");
  const sig = hex(new Uint8Array(await hmac(signingKey, stringToSign)));

  headers["authorization"] = `AWS4-HMAC-SHA256 Credential=${accessKey()}/${scope}, SignedHeaders=${signedHeaders}, Signature=${sig}`;
  return `https://${host}${encodedKey}`;
}

const S3_MAX_ATTEMPTS = 3;
const s3Sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch() that retries transient network failures (DNS/connect/reset blips
 *  that throw a TypeError from fetch, or 5xx responses from S3). A ~1s DNS
 *  hiccup at upload time was silently stranding whole audits: a queued step
 *  that throws gets NO QStash retry (Upstash-Retries:"0") and the dispatcher
 *  clears its active-tracking row, so the watchdog can't re-drive it either.
 *  Retrying here — where the blip actually is — closes that gap. S3 PUT/GET on
 *  a fixed key are idempotent, so re-attempting is safe. Mirrors the genie
 *  downloader's transient-retry loop (genie/mod.ts). */
async function s3FetchWithRetry(url: string, init: RequestInit, op: string): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= S3_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, init);
      // 5xx is a transient server-side error worth retrying; 2xx/4xx/404 return.
      if (res.status >= 500 && attempt < S3_MAX_ATTEMPTS) {
        lastError = new Error(`S3 ${op} HTTP ${res.status}`);
        console.warn(`[S3] ⚠️ ${op} attempt ${attempt}/${S3_MAX_ATTEMPTS} → HTTP ${res.status}, retrying`);
        await s3Sleep(2 ** attempt * 1000);
        continue;
      }
      return res;
    } catch (err) {
      // fetch throws (TypeError) on DNS/connect/reset — transient, retry.
      lastError = err;
      if (attempt < S3_MAX_ATTEMPTS) {
        console.warn(`[S3] ⚠️ ${op} attempt ${attempt}/${S3_MAX_ATTEMPTS} threw, retrying:`, err);
        await s3Sleep(2 ** attempt * 1000);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

export class S3Ref {
  readonly bucket: string;
  readonly key: string;

  constructor(bucket: string, key: string) {
    this.bucket = bucket;
    this.key = key;
  }

  async save(data: Uint8Array | string): Promise<void> {
    return withSpan("s3.save", async (span) => {
      const body = typeof data === "string" ? new TextEncoder().encode(data) : data;
      span.setAttributes({ "s3.bucket": this.bucket, "s3.key": this.key, "s3.bytes": body.byteLength });
      const payloadHash = await sha256(body);
      const headers: Record<string, string> = { "content-type": "application/octet-stream" };
      const url = await signV4("PUT", this.bucket, this.key, payloadHash, headers);
      // `body` is always a re-readable Uint8Array (never a one-shot ReadableStream)
      // — s3FetchWithRetry reuses this same init across attempts, so a streamed
      // body would upload empty bytes on a retry. The sha256(body) above already
      // requires a buffer, which keeps this invariant honest.
      const res = await s3FetchWithRetry(url, { method: "PUT", headers, body: body as BodyInit }, "PUT");
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`S3 PUT failed: ${res.status} ${text}`);
      }
      metric("autobottom.s3.save", 1);
    }, {}, "client");
  }

  async get(): Promise<Uint8Array | null> {
    return withSpan("s3.get", async (span) => {
      span.setAttributes({ "s3.bucket": this.bucket, "s3.key": this.key });
      const headers: Record<string, string> = {};
      const url = await signV4("GET", this.bucket, this.key, "UNSIGNED-PAYLOAD", headers);
      const res = await s3FetchWithRetry(url, { headers }, "GET");
      if (res.status === 404) { span.setAttribute("s3.found", false); return null; }
      if (!res.ok) {
        const text = await res.text();
        if (text.includes("NoSuchKey")) { span.setAttribute("s3.found", false); return null; }
        throw new Error(`S3 GET failed: ${res.status} ${text}`);
      }
      metric("autobottom.s3.get", 1);
      return new Uint8Array(await res.arrayBuffer());
    }, {}, "client");
  }
}

/** Exported for testing — the transient-retry fetch wrapper. */
export { s3FetchWithRetry };

/** Resolve an HTTP `Range` request header against a known total byte length.
 *  Pure — used by the /audit/recording direct-dispatch handler (main.ts) so the
 *  <audio> element can seek (it seeks by issuing `Range:` requests). Returns:
 *    - null            → no/empty/unparseable range → serve the full 200 body.
 *    - "unsatisfiable" → range out of bounds → caller should send 416.
 *    - { start, end }  → inclusive byte offsets for a 206 Partial Content slice.
 *  Supports "bytes=start-", "bytes=start-end", and suffix "bytes=-N" (last N
 *  bytes). Multi-range is not handled — media elements never request it. */
export function resolveByteRange(
  rangeHeader: string | null | undefined,
  total: number,
): { start: number; end: number } | "unsatisfiable" | null {
  if (!rangeHeader || total <= 0) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!m) return null;
  let start = m[1] === "" ? NaN : parseInt(m[1], 10);
  let end = m[2] === "" ? NaN : parseInt(m[2], 10);
  if (Number.isNaN(start) && Number.isNaN(end)) return null; // "bytes=-" — meaningless
  if (Number.isNaN(start)) {
    // Suffix range: the last `end` bytes.
    start = Math.max(0, total - end);
    end = total - 1;
  } else if (Number.isNaN(end) || end >= total) {
    end = total - 1;
  }
  if (start > end || start < 0 || start >= total) return "unsatisfiable";
  return { start, end };
}

/** Build the HTTP response for serving `bytes` as audio, honoring an optional
 *  `Range` request header. Returns 206 Partial Content (with Content-Range +
 *  Content-Length on the slice) for a satisfiable range, 416 for an out-of-bounds
 *  range, or a full 200 otherwise. This is the seekable response a browser
 *  <audio> element needs. Pure — used by the /audit/recording handler (main.ts). */
export function buildAudioResponse(
  bytes: Uint8Array,
  rangeHeader: string | null | undefined,
  contentType = "audio/mpeg",
): Response {
  const total = bytes.byteLength;
  const baseHeaders: Record<string, string> = {
    "content-type": contentType,
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=300",
  };
  const range = resolveByteRange(rangeHeader, total);
  if (range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: { ...baseHeaders, "content-range": `bytes */${total}` },
    });
  }
  if (range) {
    const slice = bytes.subarray(range.start, range.end + 1);
    return new Response(slice, {
      status: 206,
      headers: {
        ...baseHeaders,
        "content-range": `bytes ${range.start}-${range.end}/${total}`,
        "content-length": String(slice.byteLength),
      },
    });
  }
  return new Response(bytes, {
    status: 200,
    headers: { ...baseHeaders, "content-length": String(total) },
  });
}
