/** Firestore REST client — write-only subset for the KV→Firestore migration.
 *
 *  Ported from refactor/danet-backend src/core/data/firestore/mod.ts.
 *  Keeps doc-ID encoding + chunking format byte-for-byte identical so the
 *  refactor app's getStoredChunked can read what we write here.
 *
 *  Required env: S3_BUCKET, FIREBASE_SA_S3_KEY, FIREBASE_PROJECT_ID
 *  Optional:     FIREBASE_COLLECTION (default "autobottom"),
 *                FIREBASE_DATABASE_ID (default "(default)")
 *
 *  This trim drops the in-memory fallback — `loadFirestoreCredentials` THROWS
 *  on missing config rather than silently degrading to a Map. */

import { S3Ref } from "./s3.ts";

const SEP = "__";

// ── Credentials ─────────────────────────────────────────────────────────────

export interface FirestoreCreds {
  clientEmail: string;
  privateKey: string;
  projectId: string;
  collection: string;
  databaseId: string;
}

let _cachedCreds: FirestoreCreds | undefined;

export async function loadFirestoreCredentials(): Promise<FirestoreCreds> {
  if (_cachedCreds) return _cachedCreds;
  const bucket = Deno.env.get("S3_BUCKET") ?? Deno.env.get("AWS_S3_BUCKET") ?? "";
  const saKey = Deno.env.get("FIREBASE_SA_S3_KEY") ?? "";
  const projectId = Deno.env.get("FIREBASE_PROJECT_ID") ?? "";
  const collection = Deno.env.get("FIREBASE_COLLECTION") ?? "autobottom";
  const databaseId = Deno.env.get("FIREBASE_DATABASE_ID") ?? "(default)";
  if (!bucket || !saKey || !projectId) {
    throw new Error(
      `Firestore creds missing — required env vars: S3_BUCKET (or AWS_S3_BUCKET), FIREBASE_SA_S3_KEY, FIREBASE_PROJECT_ID`,
    );
  }
  const bytes = await new S3Ref(bucket, saKey).get();
  if (!bytes) {
    throw new Error(`Firestore SA JSON not found at s3://${bucket}/${saKey}`);
  }
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { client_email?: string; private_key?: string };
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error(`Firestore SA JSON malformed — missing client_email or private_key`);
  }
  _cachedCreds = {
    clientEmail: parsed.client_email,
    privateKey: parsed.private_key,
    projectId,
    collection,
    databaseId,
  };
  return _cachedCreds;
}

// ── JWT signing + token exchange ────────────────────────────────────────────

function b64urlEncode(bytes: Uint8Array | string): string {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let bin = "";
  for (const b of data) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

async function signJwt(creds: FirestoreCreds): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: creds.clientEmail,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const toSign = `${b64urlEncode(JSON.stringify(header))}.${b64urlEncode(JSON.stringify(claim))}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(creds.privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(toSign)));
  return `${toSign}.${b64urlEncode(sig)}`;
}

let _token: string | null = null;
let _tokenExpiry = 0;

async function getAccessToken(creds: FirestoreCreds): Promise<string> {
  if (_token && Date.now() < _tokenExpiry - 60_000) return _token;
  const jwt = await signJwt(creds);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${encodeURIComponent(jwt)}`,
  });
  if (!res.ok) throw new Error(`Firestore token exchange failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  if (!data.access_token) throw new Error("Firestore token response missing access_token");
  _token = data.access_token as string;
  _tokenExpiry = Date.now() + (data.expires_in ?? 3600) * 1000;
  return _token;
}

// ── Field codec (Firestore REST values, write-side only) ────────────────────

type FsValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { stringValue: string }
  | { timestampValue: string }
  | { arrayValue: { values?: FsValue[] } }
  | { mapValue: { fields?: Record<string, FsValue> } };

function toFsValue(v: unknown): FsValue {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") {
    if (Number.isInteger(v) && Number.isSafeInteger(v)) return { integerValue: String(v) };
    return { doubleValue: v };
  }
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFsValue) } };
  if (typeof v === "object") {
    const fields: Record<string, FsValue> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) fields[k] = toFsValue(val);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

function fieldsFromObject(obj: Record<string, unknown>): Record<string, FsValue> {
  const out: Record<string, FsValue> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = toFsValue(v);
  return out;
}

// ── Doc-ID encoding ─────────────────────────────────────────────────────────

function safePart(p: string | number): string {
  return String(p)
    .replace(/__/g, "_")
    .replace(/\//g, "_")
    .replace(/\./g, "_");
}

export function encodeDocId(type: string, org: string, ...keyParts: (string | number)[]): string {
  const parts = [safePart(type), safePart(org), ...keyParts.map(safePart)];
  const id = parts.join(SEP);
  if (id.length > 1500) throw new Error(`Doc ID too long (${id.length} bytes): ${id.slice(0, 80)}...`);
  return id;
}

// ── Doc body shape ──────────────────────────────────────────────────────────

interface DocMeta {
  type: string;
  org: string;
  key: (string | number)[];
  expireInMs?: number;
}

interface DocBody {
  _type: string;
  _org: string;
  _key: string[];
  _updatedAt: number;
  _expiresAt?: number;
  [k: string]: unknown;
}

function makeBody(meta: DocMeta, value: unknown): DocBody {
  const wrapped: Record<string, unknown> = (value !== null && typeof value === "object" && !Array.isArray(value))
    ? (value as Record<string, unknown>)
    : { _value: value };
  return {
    _type: meta.type,
    _org: meta.org,
    _key: meta.key.map(String),
    _updatedAt: Date.now(),
    ...(meta.expireInMs ? { _expiresAt: Date.now() + meta.expireInMs } : {}),
    ...wrapped,
  };
}

// ── REST write ──────────────────────────────────────────────────────────────

function docPath(creds: FirestoreCreds, docId: string): string {
  return `projects/${encodeURIComponent(creds.projectId)}/databases/${encodeURIComponent(creds.databaseId)}/documents/${encodeURIComponent(creds.collection)}/${encodeURIComponent(docId)}`;
}

async function restSet(creds: FirestoreCreds, docId: string, body: DocBody): Promise<void> {
  const token = await getAccessToken(creds);
  const res = await fetch(`https://firestore.googleapis.com/v1/${docPath(creds, docId)}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ fields: fieldsFromObject(body) }),
  });
  if (!res.ok) throw new Error(`Firestore set failed: ${res.status} ${await res.text()}`);
}

async function setDoc(docId: string, meta: DocMeta, value: unknown): Promise<void> {
  const creds = await loadFirestoreCredentials();
  await restSet(creds, docId, makeBody(meta, value));
}

// ── Public API ──────────────────────────────────────────────────────────────

/** Write a typed value. Type+org+key uniquely identify the doc. */
export async function setStored(
  type: string,
  org: string,
  key: (string | number)[],
  value: unknown,
  opts?: { expireInMs?: number },
): Promise<void> {
  const docId = encodeDocId(type, org, ...key);
  await setDoc(docId, { type, org, key, expireInMs: opts?.expireInMs }, value);
}

// ── Chunked storage (matches refactor's getStoredChunked reader) ────────────

const CHUNK_BYTES = 700_000;

/** Write a chunked value. Splits payloads larger than 700KB into header + chunk parts.
 *  Format must match refactor/danet-backend src/core/data/firestore/mod.ts so the
 *  refactor app's getStoredChunked can read it back. */
export async function setStoredChunked(
  type: string,
  org: string,
  key: (string | number)[],
  value: unknown,
  opts?: { expireInMs?: number },
): Promise<void> {
  const baseId = encodeDocId(type, org, ...key);
  const json = JSON.stringify(value);
  if (json.length <= CHUNK_BYTES) {
    await setDoc(baseId, { type, org, key, expireInMs: opts?.expireInMs }, value);
    return;
  }
  const totalChunks = Math.ceil(json.length / CHUNK_BYTES);
  await setDoc(baseId, { type, org, key, expireInMs: opts?.expireInMs }, { totalChunks, totalBytes: json.length });
  for (let i = 0; i < totalChunks; i++) {
    const data = json.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES);
    await setDoc(`${baseId}${SEP}chunk_${i}`, { type, org, key: [...key, `chunk_${i}`], expireInMs: opts?.expireInMs }, { data });
  }
}
