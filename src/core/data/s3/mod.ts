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
      const res = await fetch(url, { method: "PUT", headers, body: body as BodyInit });
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
      const res = await fetch(url, { headers });
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
