/** Firestore REST client — JWT → access token → documents API.
 *
 *  Single Keystone Firebase project, single collection per project.
 *  Autobottom data lives in `${COLLECTION}` (defaults to "autobottom").
 *
 *  Service-account JSON lives in S3 (Deno Deploy refuses to store JSON as a raw
 *  env var). Required env:
 *
 *    S3_BUCKET (or AWS_S3_BUCKET)
 *    FIREBASE_SA_S3_KEY      — S3 object key of the SA JSON
 *    FIREBASE_PROJECT_ID     — Firebase / GCP project ID
 *
 *  Optional:
 *    FIREBASE_COLLECTION     — collection name (default "autobottom")
 *    FIREBASE_DATABASE_ID    — database ID (default "(default)")
 *
 *  Doc-ID scheme: `{type}__{org}__{...keyParts joined by __}`. See encodeDocId.
 *  Doc body: `{ _type, _org, _key[], _updatedAt, _expiresAt?, ...payload }`. */

import { S3Ref } from "@core/data/s3/mod.ts";

const SEP = "__";

export interface FirestoreCreds {
  clientEmail: string;
  privateKey: string;
  projectId: string;
  collection: string;
  databaseId: string;
}

let _cached: FirestoreCreds | null | undefined;

export async function loadFirestoreCredentials(): Promise<FirestoreCreds | null> {
  if (_cached !== undefined) return _cached;
  const bucket = Deno.env.get("S3_BUCKET") ?? Deno.env.get("AWS_S3_BUCKET") ?? "";
  const saKey = Deno.env.get("FIREBASE_SA_S3_KEY") ?? "";
  const projectId = Deno.env.get("FIREBASE_PROJECT_ID") ?? "";
  const collection = Deno.env.get("FIREBASE_COLLECTION") ?? "autobottom";
  const databaseId = Deno.env.get("FIREBASE_DATABASE_ID") ?? "(default)";
  if (!bucket || !saKey || !projectId) return (_cached = null);
  try {
    const bytes = await new S3Ref(bucket, saKey).get();
    if (!bytes) return (_cached = null);
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { client_email?: string; private_key?: string };
    if (!parsed.client_email || !parsed.private_key) return (_cached = null);
    return (_cached = { clientEmail: parsed.client_email, privateKey: parsed.private_key, projectId, collection, databaseId });
  } catch (err) {
    console.error(`❌ [FIRESTORE] loadFirestoreCredentials failed:`, err);
    return (_cached = null);
  }
}

/** Reset cached credentials (test only). */
export function resetFirestoreCredentials(): void {
  _cached = undefined;
  _token = null;
  _tokenExpiry = 0;
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

// ── Field codec (Firestore REST values) ─────────────────────────────────────

type FsValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { stringValue: string }
  | { timestampValue: string }
  | { arrayValue: { values?: FsValue[] } }
  | { mapValue: { fields?: Record<string, FsValue> } };

export function toFsValue(v: unknown): FsValue {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") {
    if (Number.isInteger(v) && Number.isSafeInteger(v)) return { integerValue: String(v) };
    return { doubleValue: v };
  }
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) {
    return { arrayValue: { values: v.map(toFsValue) } };
  }
  if (typeof v === "object") {
    const fields: Record<string, FsValue> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      fields[k] = toFsValue(val);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

export function fromFsValue(v: FsValue): unknown {
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("stringValue" in v) return v.stringValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values ?? []).map(fromFsValue);
  if ("mapValue" in v) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v.mapValue.fields ?? {})) out[k] = fromFsValue(val);
    return out;
  }
  return null;
}

function fieldsFromObject(obj: Record<string, unknown>): Record<string, FsValue> {
  const out: Record<string, FsValue> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = toFsValue(v);
  return out;
}

function objectFromFields(fields: Record<string, FsValue> | undefined): Record<string, unknown> {
  if (!fields) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = fromFsValue(v);
  return out;
}

// ── Doc-ID encoding ─────────────────────────────────────────────────────────

/** Sanitize a single key part for inclusion in a doc ID. */
function safePart(p: string | number): string {
  return String(p)
    .replace(/__/g, "_") // collapse separator collisions
    .replace(/\//g, "_") // forbidden in doc IDs
    .replace(/\./g, "_"); // dots are reserved in some contexts
}

/** Encode a (type, org, ...keyParts) tuple into a Firestore doc ID. */
export function encodeDocId(type: string, org: string, ...keyParts: (string | number)[]): string {
  const parts = [safePart(type), safePart(org), ...keyParts.map(safePart)];
  const id = parts.join(SEP);
  // Firestore doc IDs are limited to 1500 bytes; in practice none of our keys approach this.
  if (id.length > 1500) throw new Error(`Doc ID too long (${id.length} bytes): ${id.slice(0, 80)}...`);
  return id;
}

// ── REST operations ─────────────────────────────────────────────────────────

function docPath(creds: FirestoreCreds, docId: string): string {
  return `projects/${encodeURIComponent(creds.projectId)}/databases/${encodeURIComponent(creds.databaseId)}/documents/${encodeURIComponent(creds.collection)}/${encodeURIComponent(docId)}`;
}

async function fsFetch(creds: FirestoreCreds, path: string, init: RequestInit): Promise<Response> {
  const token = await getAccessToken(creds);
  return await fetch(`https://firestore.googleapis.com/v1/${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

export interface DocBody {
  _type: string;
  _org: string;
  _key: string[];
  _updatedAt: number;
  _expiresAt?: number;
  [k: string]: unknown;
}

/** Read a doc. Returns null if missing OR expired (per `_expiresAt`). */
export async function getDoc<T = Record<string, unknown>>(creds: FirestoreCreds, docId: string): Promise<T | null> {
  const res = await fsFetch(creds, docPath(creds, docId), { method: "GET" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore get failed: ${res.status} ${await res.text()}`);
  const json = await res.json() as { fields?: Record<string, FsValue> };
  const obj = objectFromFields(json.fields) as DocBody;
  if (typeof obj._expiresAt === "number" && obj._expiresAt > 0 && obj._expiresAt < Date.now()) return null;
  return obj as unknown as T;
}

/** Upsert a doc. `value` is the payload (will be merged with metadata). */
export async function setDoc(
  creds: FirestoreCreds,
  docId: string,
  meta: { type: string; org: string; key: string[]; expireInMs?: number },
  value: Record<string, unknown>,
): Promise<void> {
  const body: DocBody = {
    _type: meta.type,
    _org: meta.org,
    _key: meta.key.map(String),
    _updatedAt: Date.now(),
    ...(meta.expireInMs ? { _expiresAt: Date.now() + meta.expireInMs } : {}),
    ...value,
  };
  const url = `${docPath(creds, docId)}`;
  const res = await fsFetch(creds, url, {
    method: "PATCH",
    body: JSON.stringify({ fields: fieldsFromObject(body) }),
  });
  if (!res.ok) throw new Error(`Firestore set failed: ${res.status} ${await res.text()}`);
}

/** Delete a doc. Idempotent — missing docs are not an error. */
export async function deleteDoc(creds: FirestoreCreds, docId: string): Promise<void> {
  const res = await fsFetch(creds, docPath(creds, docId), { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`Firestore delete failed: ${res.status} ${await res.text()}`);
}

/** List docs whose `_type` and `_org` match. Returns parsed bodies, expired docs filtered.
 *  For range-scoped lists, callers can post-filter on returned bodies. */
export async function listDocsByType<T = Record<string, unknown>>(
  creds: FirestoreCreds,
  type: string,
  org: string,
  opts: { limit?: number } = {},
): Promise<T[]> {
  const limit = opts.limit ?? 1000;
  const parent = `projects/${creds.projectId}/databases/${creds.databaseId}/documents`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: creds.collection }],
      where: {
        compositeFilter: {
          op: "AND",
          filters: [
            { fieldFilter: { field: { fieldPath: "_type" }, op: "EQUAL", value: { stringValue: type } } },
            { fieldFilter: { field: { fieldPath: "_org" }, op: "EQUAL", value: { stringValue: org } } },
          ],
        },
      },
      limit,
    },
  };
  const res = await fsFetch(creds, `${parent}:runQuery`, { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Firestore query failed: ${res.status} ${await res.text()}`);
  const rows = await res.json() as Array<{ document?: { fields?: Record<string, FsValue> } }>;
  const now = Date.now();
  const out: T[] = [];
  for (const row of rows) {
    if (!row.document?.fields) continue;
    const obj = objectFromFields(row.document.fields) as DocBody;
    if (typeof obj._expiresAt === "number" && obj._expiresAt > 0 && obj._expiresAt < now) continue;
    out.push(obj as unknown as T);
  }
  return out;
}

/** List docs with prefix match on doc ID. Useful for "by-type-and-org-and-key-prefix"
 *  walks. Returns the parsed payload + the doc ID. Expired docs filtered.
 *  Implementation: server-side range query on __name__ (doc reference). */
export async function listDocsByIdPrefix<T = Record<string, unknown>>(
  creds: FirestoreCreds,
  prefix: string,
  opts: { limit?: number } = {},
): Promise<Array<{ id: string; value: T }>> {
  const limit = opts.limit ?? 1000;
  const parent = `projects/${creds.projectId}/databases/${creds.databaseId}/documents`;
  // Use __name__ filter with a range: prefix <= __name__ < prefix + "\uffff"
  const startName = `${parent}/${creds.collection}/${prefix}`;
  const endName = `${parent}/${creds.collection}/${prefix}\uf8ff`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: creds.collection }],
      where: {
        compositeFilter: {
          op: "AND",
          filters: [
            { fieldFilter: { field: { fieldPath: "__name__" }, op: "GREATER_THAN_OR_EQUAL", value: { referenceValue: startName } } },
            { fieldFilter: { field: { fieldPath: "__name__" }, op: "LESS_THAN", value: { referenceValue: endName } } },
          ],
        },
      },
      limit,
    },
  };
  const res = await fsFetch(creds, `${parent}:runQuery`, { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Firestore prefix query failed: ${res.status} ${await res.text()}`);
  const rows = await res.json() as Array<{ document?: { name?: string; fields?: Record<string, FsValue> } }>;
  const now = Date.now();
  const out: Array<{ id: string; value: T }> = [];
  const idPrefix = `${parent}/${creds.collection}/`;
  for (const row of rows) {
    if (!row.document?.fields || !row.document?.name) continue;
    const obj = objectFromFields(row.document.fields) as DocBody;
    if (typeof obj._expiresAt === "number" && obj._expiresAt > 0 && obj._expiresAt < now) continue;
    const id = row.document.name.startsWith(idPrefix) ? row.document.name.slice(idPrefix.length) : row.document.name;
    out.push({ id, value: obj as unknown as T });
  }
  return out;
}

/** Conditional set — only writes if the doc does NOT currently exist.
 *  Returns true if we won the race, false if a doc was already there.
 *  Used for atomic "claim" patterns (e.g. audit-dedup). */
export async function setDocIfAbsent(
  creds: FirestoreCreds,
  docId: string,
  meta: { type: string; org: string; key: string[]; expireInMs?: number },
  value: Record<string, unknown>,
): Promise<boolean> {
  const body: DocBody = {
    _type: meta.type,
    _org: meta.org,
    _key: meta.key.map(String),
    _updatedAt: Date.now(),
    ...(meta.expireInMs ? { _expiresAt: Date.now() + meta.expireInMs } : {}),
    ...value,
  };
  const url = `${docPath(creds, docId)}?currentDocument.exists=false`;
  const res = await fsFetch(creds, url, {
    method: "PATCH",
    body: JSON.stringify({ fields: fieldsFromObject(body) }),
  });
  if (res.status === 409 || res.status === 412) return false;
  if (!res.ok) throw new Error(`Firestore setIfAbsent failed: ${res.status} ${await res.text()}`);
  return true;
}

// ── Chunked storage (for big payloads > 1MB) ────────────────────────────────

const CHUNK_BYTES = 700_000; // headroom under Firestore's 1MB doc limit

/** Read a chunked value. Returns null if header missing.
 *  Header doc holds `{ totalChunks, totalBytes }`; chunks at suffix `__chunk_N`. */
export async function getChunked<T = unknown>(creds: FirestoreCreds, baseId: string): Promise<T | null> {
  const header = await getDoc<{ totalChunks?: number }>(creds, baseId);
  if (!header) return null;
  if (typeof header.totalChunks !== "number") {
    // Single-doc value stored under the base ID (no chunking needed at write time).
    const { _type, _org, _key, _updatedAt, _expiresAt, totalChunks: _tc, totalBytes: _tb, ...payload } = header as Record<string, unknown>;
    return payload as T;
  }
  const parts: string[] = [];
  for (let i = 0; i < header.totalChunks; i++) {
    const chunk = await getDoc<{ data?: string }>(creds, `${baseId}${SEP}chunk_${i}`);
    if (!chunk || typeof chunk.data !== "string") {
      console.error(`❌ [FIRESTORE] missing chunk ${i}/${header.totalChunks} for ${baseId}`);
      return null;
    }
    parts.push(chunk.data);
  }
  try {
    return JSON.parse(parts.join("")) as T;
  } catch (err) {
    console.error(`❌ [FIRESTORE] failed to parse chunked JSON for ${baseId}:`, err);
    return null;
  }
}

/** Write a chunked value. Splits oversized payloads across multiple chunk docs. */
export async function setChunked(
  creds: FirestoreCreds,
  baseId: string,
  meta: { type: string; org: string; key: string[]; expireInMs?: number },
  value: unknown,
): Promise<void> {
  const json = JSON.stringify(value);
  if (json.length <= CHUNK_BYTES) {
    // Fits in one doc — store as-is, no chunking.
    await setDoc(creds, baseId, meta, value as Record<string, unknown>);
    return;
  }
  const totalChunks = Math.ceil(json.length / CHUNK_BYTES);
  // Header
  await setDoc(creds, baseId, meta, { totalChunks, totalBytes: json.length });
  // Chunks
  for (let i = 0; i < totalChunks; i++) {
    const data = json.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES);
    await setDoc(creds, `${baseId}${SEP}chunk_${i}`, { ...meta, key: [...meta.key, `chunk_${i}`] }, { data });
  }
}

/** Delete a chunked value (header + all chunks). */
export async function deleteChunked(creds: FirestoreCreds, baseId: string): Promise<void> {
  const header = await getDoc<{ totalChunks?: number }>(creds, baseId);
  if (header && typeof header.totalChunks === "number") {
    for (let i = 0; i < header.totalChunks; i++) {
      await deleteDoc(creds, `${baseId}${SEP}chunk_${i}`);
    }
  }
  await deleteDoc(creds, baseId);
}
