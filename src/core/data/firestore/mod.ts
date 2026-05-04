/** Firestore REST client with transparent in-memory fallback.
 *
 *  Single Keystone Firebase project, single collection per project.
 *  Autobottom data lives in `${COLLECTION}` (defaults to "autobottom").
 *
 *  ── Credentials ────────────────────────────────────────────────────────────
 *  Service-account JSON lives in S3 (Deno Deploy refuses to store JSON as a
 *  raw env var). When all required env vars are set, ops hit the real
 *  Firestore REST API. When any are missing, ops fall back to an in-process
 *  Map — keeps tests + local dev working without Firebase configured.
 *
 *  Required (REST mode):  S3_BUCKET, FIREBASE_SA_S3_KEY, FIREBASE_PROJECT_ID
 *  Optional:              FIREBASE_COLLECTION (default "autobottom"),
 *                         FIREBASE_DATABASE_ID (default "(default)")
 *
 *  ── Doc layout ─────────────────────────────────────────────────────────────
 *  Doc ID:    `{type}__{org}__{...keyParts joined by __}` (encodeDocId)
 *  Doc body:  { _type, _org, _key[], _updatedAt, _expiresAt?, ...payload }
 *
 *  Object payloads are spread into the body. Primitives are wrapped under
 *  `_value`. The high-level setStored/getStored API hides this detail. */

import { S3Ref } from "@core/data/s3/mod.ts";

const SEP = "__";

// ── Credentials ─────────────────────────────────────────────────────────────

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

/** Reset cached credentials + in-mem store (test only). */
export function resetFirestoreCredentials(): void {
  _cached = undefined;
  _token = null;
  _tokenExpiry = 0;
  _inMem.clear();
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
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFsValue) } };
  if (typeof v === "object") {
    const fields: Record<string, FsValue> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) fields[k] = toFsValue(val);
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

function safePart(p: string | number): string {
  return String(p)
    .replace(/__/g, "_") // collapse separator collisions
    .replace(/\//g, "_") // forbidden in doc IDs
    .replace(/\./g, "_"); // dots are reserved in field paths
}

/** Encode a (type, org, ...keyParts) tuple into a Firestore doc ID. */
export function encodeDocId(type: string, org: string, ...keyParts: (string | number)[]): string {
  const parts = [safePart(type), safePart(org), ...keyParts.map(safePart)];
  const id = parts.join(SEP);
  if (id.length > 1500) throw new Error(`Doc ID too long (${id.length} bytes): ${id.slice(0, 80)}...`);
  return id;
}

// ── Doc body shape ──────────────────────────────────────────────────────────

export interface DocMeta {
  type: string;
  org: string;
  key: (string | number)[];
  expireInMs?: number;
}

export interface DocBody {
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

function unwrapPayload<T>(body: DocBody): T {
  if ("_value" in body) return body._value as T;
  const { _type: _t, _org: _o, _key: _k, _updatedAt: _u, _expiresAt: _e, ...rest } = body;
  return rest as T;
}

function isExpired(body: DocBody): boolean {
  return typeof body._expiresAt === "number" && body._expiresAt > 0 && body._expiresAt < Date.now();
}

// ── In-memory store (used when creds unconfigured) ──────────────────────────

const _inMem = new Map<string, DocBody>();

function inMemGet(docId: string): DocBody | null {
  const body = _inMem.get(docId);
  if (!body) return null;
  if (isExpired(body)) {
    _inMem.delete(docId);
    return null;
  }
  return body;
}

function inMemSet(docId: string, body: DocBody): void {
  _inMem.set(docId, body);
}

function inMemDelete(docId: string): void {
  _inMem.delete(docId);
}

function inMemListByType(type: string, org: string, limit: number): DocBody[] {
  const out: DocBody[] = [];
  for (const body of _inMem.values()) {
    if (out.length >= limit) break;
    if (body._type !== type || body._org !== org) continue;
    if (isExpired(body)) continue;
    out.push(body);
  }
  return out;
}

function inMemListByIdPrefix(prefix: string, limit: number): Array<{ id: string; body: DocBody }> {
  const out: Array<{ id: string; body: DocBody }> = [];
  for (const [id, body] of _inMem.entries()) {
    if (out.length >= limit) break;
    if (!id.startsWith(prefix)) continue;
    if (isExpired(body)) continue;
    out.push({ id, body });
  }
  return out;
}

// ── REST operations (cred-explicit, used internally + by migration script) ──

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

async function restGet(creds: FirestoreCreds, docId: string): Promise<DocBody | null> {
  const res = await fsFetch(creds, docPath(creds, docId), { method: "GET" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore get failed: ${res.status} ${await res.text()}`);
  const json = await res.json() as { fields?: Record<string, FsValue> };
  const obj = objectFromFields(json.fields) as DocBody;
  if (isExpired(obj)) return null;
  return obj;
}

async function restSet(creds: FirestoreCreds, docId: string, body: DocBody): Promise<void> {
  const res = await fsFetch(creds, docPath(creds, docId), {
    method: "PATCH",
    body: JSON.stringify({ fields: fieldsFromObject(body) }),
  });
  if (!res.ok) throw new Error(`Firestore set failed: ${res.status} ${await res.text()}`);
}

async function restDelete(creds: FirestoreCreds, docId: string): Promise<void> {
  const res = await fsFetch(creds, docPath(creds, docId), { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`Firestore delete failed: ${res.status} ${await res.text()}`);
}

async function restSetIfAbsent(creds: FirestoreCreds, docId: string, body: DocBody): Promise<boolean> {
  const url = `${docPath(creds, docId)}?currentDocument.exists=false`;
  const res = await fsFetch(creds, url, {
    method: "PATCH",
    body: JSON.stringify({ fields: fieldsFromObject(body) }),
  });
  if (res.status === 409 || res.status === 412) return false;
  if (!res.ok) throw new Error(`Firestore setIfAbsent failed: ${res.status} ${await res.text()}`);
  return true;
}

async function restListByOrg(creds: FirestoreCreds, org: string, limit: number): Promise<Array<{ id: string; body: DocBody }>> {
  const parent = `projects/${creds.projectId}/databases/${creds.databaseId}/documents`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: creds.collection }],
      where: { fieldFilter: { field: { fieldPath: "_org" }, op: "EQUAL", value: { stringValue: org } } },
      limit,
    },
  };
  const res = await fsFetch(creds, `${parent}:runQuery`, { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Firestore org query failed: ${res.status} ${await res.text()}`);
  const rows = await res.json() as Array<{ document?: { name?: string; fields?: Record<string, FsValue> } }>;
  const out: Array<{ id: string; body: DocBody }> = [];
  const idPrefix = `${parent}/${creds.collection}/`;
  for (const row of rows) {
    if (!row.document?.fields || !row.document?.name) continue;
    const obj = objectFromFields(row.document.fields) as DocBody;
    if (isExpired(obj)) continue;
    const id = row.document.name.startsWith(idPrefix) ? row.document.name.slice(idPrefix.length) : row.document.name;
    out.push({ id, body: obj });
  }
  return out;
}

async function restListByType(creds: FirestoreCreds, type: string, org: string, limit: number): Promise<DocBody[]> {
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
  const out: DocBody[] = [];
  for (const row of rows) {
    if (!row.document?.fields) continue;
    const obj = objectFromFields(row.document.fields) as DocBody;
    if (isExpired(obj)) continue;
    out.push(obj);
  }
  return out;
}

/** List docs of a given type+org whose `completedAt` field falls within
 *  [from, to] (inclusive). Used by audit-history to read findings directly,
 *  bypassing the audit-done-idx denormalization. Requires a Firestore
 *  composite index on (_type, _org, completedAt) — Firestore will surface a
 *  one-click create-index URL on the first query if the index is missing. */
async function restListByCompletedAt(
  creds: FirestoreCreds,
  type: string,
  org: string,
  from: number,
  to: number,
  limit: number,
): Promise<DocBody[]> {
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
            { fieldFilter: { field: { fieldPath: "completedAt" }, op: "GREATER_THAN_OR_EQUAL", value: { integerValue: String(from) } } },
            { fieldFilter: { field: { fieldPath: "completedAt" }, op: "LESS_THAN_OR_EQUAL", value: { integerValue: String(to) } } },
          ],
        },
      },
      orderBy: [{ field: { fieldPath: "completedAt" }, direction: "DESCENDING" }],
      limit,
    },
  };
  console.log(`🔍 [FS-COMPLETED-AT] query type=${type} org=${org} from=${from} to=${to} limit=${limit}`);
  const res = await fsFetch(creds, `${parent}:runQuery`, { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) {
    const errText = await res.text().catch(() => "<no body>");
    console.error(`❌ [FS-COMPLETED-AT] Firestore returned ${res.status}: ${errText}`);
    throw new Error(`Firestore completedAt query failed: ${res.status} ${errText}`);
  }
  let rows: Array<{ document?: { fields?: Record<string, FsValue> } }>;
  try {
    rows = await res.json() as Array<{ document?: { fields?: Record<string, FsValue> } }>;
  } catch (err) {
    console.error(`❌ [FS-COMPLETED-AT] failed to parse Firestore response:`, err);
    throw err;
  }
  console.log(`✅ [FS-COMPLETED-AT] Firestore returned ${rows.length} rows`);
  const out: DocBody[] = [];
  for (const row of rows) {
    if (!row.document?.fields) continue;
    try {
      const obj = objectFromFields(row.document.fields) as DocBody;
      if (isExpired(obj)) continue;
      out.push(obj);
    } catch (err) {
      console.error(`❌ [FS-COMPLETED-AT] objectFromFields threw on row:`, err);
    }
  }
  console.log(`✅ [FS-COMPLETED-AT] decoded ${out.length} valid docs`);
  return out;
}

function inMemListByCompletedAt(type: string, org: string, from: number, to: number, limit: number): DocBody[] {
  const out: DocBody[] = [];
  for (const body of _inMem.values()) {
    if (out.length >= limit) break;
    if (body._type !== type || body._org !== org) continue;
    if (isExpired(body)) continue;
    const ts = (body as Record<string, unknown>).completedAt;
    if (typeof ts !== "number" || ts < from || ts > to) continue;
    out.push(body);
  }
  out.sort((a, b) => Number((b as Record<string, unknown>).completedAt) - Number((a as Record<string, unknown>).completedAt));
  return out;
}

async function restListByIdPrefix(creds: FirestoreCreds, prefix: string, limit: number): Promise<Array<{ id: string; body: DocBody }>> {
  const parent = `projects/${creds.projectId}/databases/${creds.databaseId}/documents`;
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
  const out: Array<{ id: string; body: DocBody }> = [];
  const idPrefix = `${parent}/${creds.collection}/`;
  for (const row of rows) {
    if (!row.document?.fields || !row.document?.name) continue;
    const obj = objectFromFields(row.document.fields) as DocBody;
    if (isExpired(obj)) continue;
    const id = row.document.name.startsWith(idPrefix) ? row.document.name.slice(idPrefix.length) : row.document.name;
    out.push({ id, body: obj });
  }
  return out;
}

// ── Public low-level API (creds resolved; in-mem fallback) ──────────────────

/** Read a doc by ID. Returns the raw body (with `_*` metadata) or null. */
export async function getDoc(docId: string): Promise<DocBody | null> {
  const creds = await loadFirestoreCredentials();
  if (!creds) return inMemGet(docId);
  return restGet(creds, docId);
}

/** Upsert a doc. */
export async function setDoc(docId: string, meta: DocMeta, value: unknown): Promise<void> {
  const body = makeBody(meta, value);
  const creds = await loadFirestoreCredentials();
  if (!creds) return inMemSet(docId, body);
  return restSet(creds, docId, body);
}

/** Delete a doc. Idempotent. */
export async function deleteDoc(docId: string): Promise<void> {
  const creds = await loadFirestoreCredentials();
  if (!creds) return inMemDelete(docId);
  return restDelete(creds, docId);
}

/** Atomic claim: writes only if doc doesn't exist. Returns true on win. */
export async function setDocIfAbsent(docId: string, meta: DocMeta, value: unknown): Promise<boolean> {
  const body = makeBody(meta, value);
  const creds = await loadFirestoreCredentials();
  if (!creds) {
    const existing = inMemGet(docId);
    if (existing) return false;
    inMemSet(docId, body);
    return true;
  }
  return restSetIfAbsent(creds, docId, body);
}

// ── High-level storage API (used by repositories) ───────────────────────────

/** Read a typed value. Type+org+key uniquely identify the doc. */
export async function getStored<T>(type: string, org: string, ...key: (string | number)[]): Promise<T | null> {
  const docId = encodeDocId(type, org, ...key);
  const body = await getDoc(docId);
  if (!body) return null;
  return unwrapPayload<T>(body);
}

/** Write a typed value. Same identity rules as getStored. */
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

/** Atomic-claim variant of setStored. Returns true if we wrote, false if a doc already existed. */
export async function setStoredIfAbsent(
  type: string,
  org: string,
  key: (string | number)[],
  value: unknown,
  opts?: { expireInMs?: number },
): Promise<boolean> {
  const docId = encodeDocId(type, org, ...key);
  return setDocIfAbsent(docId, { type, org, key, expireInMs: opts?.expireInMs }, value);
}

/** Delete a typed value. Idempotent. */
export async function deleteStored(type: string, org: string, ...key: (string | number)[]): Promise<void> {
  const docId = encodeDocId(type, org, ...key);
  await deleteDoc(docId);
}

/** List all values matching this type+org. */
export async function listStored<T>(type: string, org: string, opts: { limit?: number } = {}): Promise<T[]> {
  const limit = opts.limit ?? 1000;
  const creds = await loadFirestoreCredentials();
  const bodies = creds ? await restListByType(creds, type, org, limit) : inMemListByType(type, org, limit);
  return bodies.map((b) => unwrapPayload<T>(b));
}

/** List all values matching this type+org, with their key parts. */
export async function listStoredWithKeys<T>(
  type: string,
  org: string,
  opts: { limit?: number } = {},
): Promise<Array<{ key: string[]; value: T }>> {
  const limit = opts.limit ?? 1000;
  const creds = await loadFirestoreCredentials();
  const bodies = creds ? await restListByType(creds, type, org, limit) : inMemListByType(type, org, limit);
  return bodies.map((b) => ({ key: b._key, value: unwrapPayload<T>(b) }));
}

/** Dump every doc belonging to this org — across all types. Returns the
 *  full DocBody (with metadata) so callers can preserve type/key shape.
 *  Used by /admin/dump-state for app-level backup. */
export async function listAllStoredByOrg(
  org: string,
  opts: { limit?: number } = {},
): Promise<Array<{ id: string; body: DocBody }>> {
  const limit = opts.limit ?? 10_000;
  const creds = await loadFirestoreCredentials();
  if (!creds) {
    const out: Array<{ id: string; body: DocBody }> = [];
    for (const [id, body] of _inMem.entries()) {
      if (out.length >= limit) break;
      if (body._org !== org) continue;
      if (isExpired(body)) continue;
      out.push({ id, body });
    }
    return out;
  }
  return restListByOrg(creds, org, limit);
}

/** List values matching this type+org whose `completedAt` field is in
 *  [from, to] (ms since epoch, inclusive), sorted newest-first. Backed by
 *  a Firestore composite-indexed range query — fast and bounded.
 *  First-time use surfaces a Firestore "create index" URL; click it once,
 *  wait ~1-5 min for the index to build, then this query is fast forever. */
export async function listStoredByCompletedAt<T>(
  type: string,
  org: string,
  from: number,
  to: number,
  opts: { limit?: number } = {},
): Promise<T[]> {
  const limit = opts.limit ?? 5000;
  const creds = await loadFirestoreCredentials();
  const bodies = creds
    ? await restListByCompletedAt(creds, type, org, from, to, limit)
    : inMemListByCompletedAt(type, org, from, to, limit);
  return bodies.map((b) => unwrapPayload<T>(b));
}

/** List values whose doc ID begins with the given prefix.
 *  Useful for ordered-key walks (e.g. `audit-done-idx__org__<padTs>`). */
export async function listStoredByIdPrefix<T>(
  prefix: string,
  opts: { limit?: number } = {},
): Promise<Array<{ id: string; key: string[]; value: T }>> {
  const limit = opts.limit ?? 1000;
  const creds = await loadFirestoreCredentials();
  const rows = creds ? await restListByIdPrefix(creds, prefix, limit) : inMemListByIdPrefix(prefix, limit);
  return rows.map(({ id, body }) => ({ id, key: body._key, value: unwrapPayload<T>(body) }));
}

// ── Chunked storage (for payloads that may exceed 1MB Firestore doc limit) ──

const CHUNK_BYTES = 700_000;

/** Read a chunked value. Returns null if header missing or chunks corrupt. */
export async function getStoredChunked<T>(type: string, org: string, ...key: (string | number)[]): Promise<T | null> {
  const baseId = encodeDocId(type, org, ...key);
  const header = await getDoc(baseId);
  if (!header) return null;
  // If we never had to chunk the payload, the body IS the value (object payload).
  if (!("totalChunks" in header)) return unwrapPayload<T>(header);
  const totalChunks = header.totalChunks as number;
  const parts: string[] = [];
  for (let i = 0; i < totalChunks; i++) {
    const chunk = await getDoc(`${baseId}${SEP}chunk_${i}`);
    if (!chunk) {
      console.error(`❌ [FIRESTORE] missing chunk ${i}/${totalChunks} for ${baseId}`);
      return null;
    }
    parts.push(unwrapPayload<{ data: string }>(chunk).data);
  }
  try {
    return JSON.parse(parts.join("")) as T;
  } catch (err) {
    console.error(`❌ [FIRESTORE] failed to parse chunked JSON for ${baseId}:`, err);
    return null;
  }
}

/** Write a chunked value. Splits oversized payloads. */
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

/** Delete a chunked value (header + all chunks). */
export async function deleteStoredChunked(type: string, org: string, ...key: (string | number)[]): Promise<void> {
  const baseId = encodeDocId(type, org, ...key);
  const header = await getDoc(baseId);
  if (header && typeof header.totalChunks === "number") {
    for (let i = 0; i < (header.totalChunks as number); i++) {
      await deleteDoc(`${baseId}${SEP}chunk_${i}`);
    }
  }
  await deleteDoc(baseId);
}
