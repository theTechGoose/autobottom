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
import { AsyncLocalStorage } from "node:async_hooks";

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

/** Retry transient HTTP/2 stream errors and 5xx responses. Deno Deploy's
 *  long-lived HTTP/2 connections to Firestore intermittently fail with
 *  "stream error received: unexpected internal error" or
 *  "error reading a body from connection" — a single retry resolves most.
 *  Body consumption happens INSIDE the retry loop so mid-stream body
 *  failures also trigger retry. Per-attempt 20s abort prevents 120s hangs. */
const FS_RETRY_DELAYS_MS = [200, 600];
// Per-lane fetch behavior. timeoutMs is the per-attempt abort budget;
// retryOnTimeout controls whether we re-fire on our own watchdog firing.
//
//  - foreground: 60s, no retry. Big paginated reads (audit-history
//    pulls 5000-doc pages whose body consumption legit takes 20-40s
//    on busy orgs) need this headroom. Retrying on a real-timeout
//    here would 3× the slot wedge (60s × 3 = 180s) — we proved that's
//    bad in commit 79cd931.
//  - auth: 8s, retry on timeout. Auth/session reads are tiny
//    single-doc fetches; <500ms under any sane Firestore state. When
//    the connection pool is briefly wedged a single 8s try might
//    abort, but the wedge usually clears in <30s as Deno cycles the
//    connection. Retrying transparently means the user's login
//    completes (worst case 8s × 3 = 24s wall-clock) rather than
//    bouncing them to an error screen and asking them to retry by
//    hand.
//  - background: 15s, no retry. Maintenance work (dedup, purge,
//    backfills) should fail fast on a hung call so the operator
//    sees the error in their modal — they have the dedup-progress
//    UI to interpret it. Retrying a hung scan just compounds the
//    wedge.
type LaneConfig = { timeoutMs: number; retryOnTimeout: boolean };
const FS_LANE_CONFIG: Record<"foreground" | "background" | "auth", LaneConfig> = {
  // Foreground was 60s. Reviewers were seeing "spins then 503": a brief
  // pool wedge made the handler wait the full 60s, but Deno Deploy's
  // edge timeout fires around ~50-60s and serves a 503 BEFORE our
  // handler returned the soft-fallback. Net result: edge 503 instead
  // of graceful retry. Dropping to 25s lets us abort early, catch in
  // the controller, and return retry:true well before the edge gives
  // up. Normal queries complete in 1-2s — only genuinely-wedged
  // requests are affected.
  foreground: { timeoutMs: 25_000, retryOnTimeout: false },
  background: { timeoutMs: 15_000, retryOnTimeout: false },
  auth:       { timeoutMs:  8_000, retryOnTimeout: true  },
};

// ── Firestore concurrency semaphore ─────────────────────────────────────────
// Cap concurrent in-flight Firestore HTTP calls per isolate. Without this,
// bulk-firing 50–100 audits triggers ~250+ FS ops in parallel (init + step
// chain × per-step writes), saturates the connection pool to Firestore, and
// every other FS-dependent path on the isolate (auth middleware, dashboard,
// review queue, even /login) inherits the 60s abort timeout and cascades
// into 503/500. Bounding concurrency at the source means the pool can never
// saturate; calls beyond the cap queue and resolve in FIFO order.
//
// Three-lane sizing — total 94. Each lane now ALSO has its own
// Deno.HttpClient with its own TCP connection pool to Firestore (see
// _foregroundHttpClient / _backgroundHttpClient / _authHttpClient
// below), so the lanes provide TRUE network-level isolation, not just
// app-level concurrency caps. A burst on one lane can't saturate the
// HTTP/2 connections used by another lane.
//
//   - foreground (default): 64 slots — login, dashboard, review queue,
//     admin tools, all user-facing FS work. Anything that DIDN'T
//     explicitly opt into another lane lands here.
//   - background: 25 slots — the audit pipeline lives here now (wrapped
//     at the step dispatcher in main.ts), plus maintenance ops (dedup,
//     purge, backfill). 25 is enough for ~10 concurrent audits each
//     doing ~2-3 in-flight FS ops, without flooding the connection pool.
//   - auth: 5 slots — session reads/writes. Previously 1 with a
//     fallback-to-foreground design; now that the auth lane has its
//     own HTTP client there's no benefit to keeping it tiny, and 5
//     lets multiple concurrent logins/session reads complete in
//     parallel.
const FS_FOREGROUND_CAP = 64;
const FS_BACKGROUND_CAP = 25;
const FS_AUTH_CAP = 5;

// Per-lane HTTP clients. Each client has its own TCP connection pool to
// firestore.googleapis.com, so a flood of pipeline writes on the
// background lane can't queue at the network layer behind foreground
// reads. App-level lane caps (above) provide concurrency limits; these
// clients provide network-level isolation. Together they deliver the
// "isolated lanes" guarantee — saturating one lane can't slow another.
//
// HTTP/2 is negotiated by default for HTTPS. Each client maintains its
// own connections; expect ~1-4 connections per client under load. Total
// connection count ceiling on Deno Deploy is generous (>>12).
//
// Lazy init so unit tests that import this module without exercising
// fsFetch don't leak HTTP-client resources. Each is created on first
// real FS call from its lane and reused for the isolate's lifetime.
//
// Force HTTP/1.1 — HTTP/2 multiplexes streams over one TCP connection, so
// when one stream stalls (Google frontend hiccup, Deno h2 client quirk),
// every other in-flight stream on that connection wedges with it. That's
// the 25s [FS-PROFILE] abort pattern we've been fighting all session.
// HTTP/1.1 has no multiplexing — each request gets its own TCP slot from
// the pool, one slow request can't drag others down. Higher per-request
// connection overhead, but lane caps + keep-alive keep that bounded.
const HTTP1_ONLY_OPTS: Deno.CreateHttpClientOptions = { http1: true, http2: false };
let _foregroundHttpClient: Deno.HttpClient | null = null;
let _backgroundHttpClient: Deno.HttpClient | null = null;
let _authHttpClient: Deno.HttpClient | null = null;

function getHttpClientForLane(lane: FsLane): Deno.HttpClient {
  if (lane === "background") {
    if (!_backgroundHttpClient) {
      _backgroundHttpClient = Deno.createHttpClient(HTTP1_ONLY_OPTS);
      console.log(`🔧 [FS-HTTP] lane=background client created (HTTP/1.1 only)`);
    }
    return _backgroundHttpClient;
  }
  if (lane === "auth") {
    if (!_authHttpClient) {
      _authHttpClient = Deno.createHttpClient(HTTP1_ONLY_OPTS);
      console.log(`🔧 [FS-HTTP] lane=auth client created (HTTP/1.1 only)`);
    }
    return _authHttpClient;
  }
  if (!_foregroundHttpClient) {
    _foregroundHttpClient = Deno.createHttpClient(HTTP1_ONLY_OPTS);
    console.log(`🔧 [FS-HTTP] lane=foreground client created (HTTP/1.1 only)`);
  }
  return _foregroundHttpClient;
}
let _fsForegroundInFlight = 0;
let _fsBackgroundInFlight = 0;
let _fsAuthInFlight = 0;
const _fsForegroundWaitQueue: Array<() => void> = [];
const _fsBackgroundWaitQueue: Array<() => void> = [];

// Async-context flag for the lane choice. Threading a "lane" param through
// getStored→getDoc→restGet→fsFetch would touch every repository signature;
// AsyncLocalStorage carries the choice down the async chain without
// changing any API. Callers wrap their work in runInAuthLane /
// runInBackgroundLane; fsFetch reads the store on entry.
type FsLane = "default" | "auth" | "background";
const _laneStorage = new AsyncLocalStorage<FsLane>();

export function runInAuthLane<T>(fn: () => Promise<T>): Promise<T> {
  return _laneStorage.run("auth", fn);
}

/** Mark a block of FS work as background/maintenance. Background lane has
 *  a strict 5-slot cap that NEVER falls back to foreground — guarantees
 *  bulk maintenance can't starve user-facing operations no matter how
 *  long it runs or how many ops it issues. */
export function runInBackgroundLane<T>(fn: () => Promise<T>): Promise<T> {
  return _laneStorage.run("background", fn);
}

/** Wrap an async function and log its duration if it exceeds a threshold.
 *  Used to localize slow FS queries in production — wrapping the top-level
 *  repository functions lets prod logs tell us exactly which call is
 *  blowing 5s+ at any moment, instead of guessing from generic abort
 *  errors. Threshold defaults to 1s so we don't flood the log with the
 *  happy path. */
export async function withTiming<T>(
  label: string,
  fn: () => Promise<T>,
  thresholdMs = 1000,
): Promise<T> {
  const start = Date.now();
  let outcome: "ok" | "err" = "ok";
  try {
    return await fn();
  } catch (err) {
    outcome = "err";
    throw err;
  } finally {
    const elapsed = Date.now() - start;
    if (elapsed >= thresholdMs) {
      console.log(`⏱️  [FS-PROFILE] ${label} took ${elapsed}ms (${outcome})`);
    }
  }
}

type SlotKind = "foreground" | "background" | "auth";

/** Acquire a slot. The returned kind tells releaseFsSlot which counter to
 *  decrement — important when the auth lane falls back to foreground. */
function acquireFsSlot(lane: FsLane): Promise<SlotKind> {
  if (lane === "background") {
    if (_fsBackgroundInFlight < FS_BACKGROUND_CAP) {
      _fsBackgroundInFlight++;
      return Promise.resolve("background");
    }
    // Background NEVER falls back to foreground — that's the whole point.
    return new Promise<SlotKind>((resolve) => {
      _fsBackgroundWaitQueue.push(() => { _fsBackgroundInFlight++; resolve("background"); });
    });
  }
  if (lane === "auth" && _fsAuthInFlight < FS_AUTH_CAP) {
    _fsAuthInFlight++;
    return Promise.resolve("auth");
  }
  // Foreground (default) or auth fallback.
  if (_fsForegroundInFlight < FS_FOREGROUND_CAP) {
    _fsForegroundInFlight++;
    return Promise.resolve("foreground");
  }
  return new Promise<SlotKind>((resolve) => {
    _fsForegroundWaitQueue.push(() => { _fsForegroundInFlight++; resolve("foreground"); });
  });
}

function releaseFsSlot(slot: SlotKind): void {
  if (slot === "auth") {
    _fsAuthInFlight--;
    return;
  }
  if (slot === "background") {
    _fsBackgroundInFlight--;
    const next = _fsBackgroundWaitQueue.shift();
    if (next) next();
    return;
  }
  _fsForegroundInFlight--;
  const next = _fsForegroundWaitQueue.shift();
  if (next) next();
}

interface FsResult { status: number; ok: boolean; text: string }

function isTransientFsError(msg: string): boolean {
  return msg.includes("http2 error")
    || msg.includes("stream error")
    || msg.includes("error sending request")
    || msg.includes("error reading a body")
    || msg.includes("connection closed")
    || msg.includes("connection reset")
    || msg.includes("aborted");
}

async function fsFetch(creds: FirestoreCreds, path: string, init: RequestInit): Promise<FsResult> {
  // Acquire BEFORE any work so getAccessToken (which can itself fetch) doesn't
  // race in over the cap. Release in finally so a thrown error or abort still
  // frees the slot — without this, 60s aborts would permanently lock slots.
  const lane = _laneStorage.getStore() ?? "default";
  const slot = await acquireFsSlot(lane);
  // Per-lane HTTP client. Picked by LANE (not slot) so auth-lane callers
  // that fell back to a foreground slot still use the auth client's
  // dedicated connections — preserving the "auth never queues behind
  // dashboard" guarantee even during fallback.
  const httpClient = getHttpClientForLane(lane);
  try {
    const token = await getAccessToken(creds);
    const url = `https://firestore.googleapis.com/v1/${path}`;
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) };

    // slot maps to one of the three lane keys via SlotKind ("foreground"
    // | "background" | "auth"). Auth-lane callers may have fallen back
    // to a foreground slot if the reserved auth slot was busy — in
    // that case we still want auth's shorter timeout AND retry-on-
    // timeout behavior, because the call originated as an auth
    // request. Read the lane flag, not the slot, for config.
    const laneCfg = FS_LANE_CONFIG[lane === "default" ? "foreground" : lane];
    let lastErr: unknown;
    for (let attempt = 0; attempt <= FS_RETRY_DELAYS_MS.length; attempt++) {
      const ctrl = new AbortController();
      const timeoutId = setTimeout(() => ctrl.abort(), laneCfg.timeoutMs);
      try {
        const res = await fetch(url, { ...init, headers, signal: ctrl.signal, client: httpClient } as RequestInit & { client: Deno.HttpClient });
        const text = await res.text();
        clearTimeout(timeoutId);
        if (res.status >= 500 && res.status < 600 && attempt < FS_RETRY_DELAYS_MS.length) {
          console.warn(`⚠️ [FS] ${res.status} from Firestore (attempt ${attempt + 1}) — retrying`);
          await new Promise((r) => setTimeout(r, FS_RETRY_DELAYS_MS[attempt]));
          continue;
        }
        return { status: res.status, ok: res.ok, text };
      } catch (err) {
        clearTimeout(timeoutId);
        lastErr = err;
        // Distinguish "our own watchdog timer fired" from "the underlying
        // stream aborted unexpectedly". Both surface as AbortError with
        // "aborted" in the message. For most lanes our own timeout means
        // the query is genuinely too slow and retrying just re-fires the
        // same hung query, so we fail fast. The auth lane is the
        // exception — auth's timeout is short (8s) and the calls are
        // tiny, so retrying transparently lets a brief connection-pool
        // wedge resolve without bouncing the user to /login. See
        // FS_LANE_CONFIG comments for rationale.
        const ourTimeout = ctrl.signal.aborted;
        const msg = err instanceof Error ? err.message : String(err);
        const ourTimeoutRetryable = ourTimeout && laneCfg.retryOnTimeout;
        const transient = ourTimeoutRetryable || (!ourTimeout && isTransientFsError(msg));
        if (!transient || attempt >= FS_RETRY_DELAYS_MS.length) break;
        console.warn(`⚠️ [FS] transient fetch error (attempt ${attempt + 1}, lane=${lane}): ${msg.slice(0, 120)} — retrying`);
        await new Promise((r) => setTimeout(r, FS_RETRY_DELAYS_MS[attempt]));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  } finally {
    releaseFsSlot(slot);
  }
}

async function restGet(creds: FirestoreCreds, docId: string): Promise<DocBody | null> {
  const res = await fsFetch(creds, docPath(creds, docId), { method: "GET" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore get failed: ${res.status} ${res.text}`);
  const json = JSON.parse(res.text) as { fields?: Record<string, FsValue> };
  const obj = objectFromFields(json.fields) as DocBody;
  if (isExpired(obj)) return null;
  return obj;
}

async function restSet(creds: FirestoreCreds, docId: string, body: DocBody): Promise<void> {
  const res = await fsFetch(creds, docPath(creds, docId), {
    method: "PATCH",
    body: JSON.stringify({ fields: fieldsFromObject(body) }),
  });
  if (!res.ok) throw new Error(`Firestore set failed: ${res.status} ${res.text}`);
}

async function restDelete(creds: FirestoreCreds, docId: string): Promise<void> {
  const res = await fsFetch(creds, docPath(creds, docId), { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`Firestore delete failed: ${res.status} ${res.text}`);
}

async function restSetIfAbsent(creds: FirestoreCreds, docId: string, body: DocBody): Promise<boolean> {
  const url = `${docPath(creds, docId)}?currentDocument.exists=false`;
  const res = await fsFetch(creds, url, {
    method: "PATCH",
    body: JSON.stringify({ fields: fieldsFromObject(body) }),
  });
  if (res.status === 409 || res.status === 412) return false;
  if (!res.ok) throw new Error(`Firestore setIfAbsent failed: ${res.status} ${res.text}`);
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
  if (!res.ok) throw new Error(`Firestore org query failed: ${res.status} ${res.text}`);
  const rows = JSON.parse(res.text) as Array<{ document?: { name?: string; fields?: Record<string, FsValue> } }>;
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
  if (!res.ok) throw new Error(`Firestore query failed: ${res.status} ${res.text}`);
  const rows = JSON.parse(res.text) as Array<{ document?: { fields?: Record<string, FsValue> } }>;
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
 *  one-click create-index URL on the first query if the index is missing.
 *
 *  Internally pages via Firestore cursors (`startAt` after the previous
 *  page's last doc) so a single call can return up to `limit` docs even
 *  when that exceeds Firestore's per-runQuery response budget. */
const COMPLETED_AT_PAGE_SIZE = 5000;

async function restListByCompletedAt(
  creds: FirestoreCreds,
  type: string,
  org: string,
  from: number,
  to: number,
  limit: number,
  fieldName: string,
): Promise<DocBody[]> {
  const parent = `projects/${creds.projectId}/databases/${creds.databaseId}/documents`;
  const out: DocBody[] = [];
  let cursor: { fieldVal: number; docName: string } | null = null;
  let pageNum = 0;

  while (out.length < limit) {
    pageNum++;
    const pageLimit = Math.min(COMPLETED_AT_PAGE_SIZE, limit - out.length);
    const structuredQuery: Record<string, unknown> = {
      from: [{ collectionId: creds.collection }],
      where: {
        compositeFilter: {
          op: "AND",
          filters: [
            { fieldFilter: { field: { fieldPath: "_type" }, op: "EQUAL", value: { stringValue: type } } },
            { fieldFilter: { field: { fieldPath: "_org" }, op: "EQUAL", value: { stringValue: org } } },
            { fieldFilter: { field: { fieldPath: fieldName }, op: "GREATER_THAN_OR_EQUAL", value: { integerValue: String(from) } } },
            { fieldFilter: { field: { fieldPath: fieldName }, op: "LESS_THAN_OR_EQUAL", value: { integerValue: String(to) } } },
          ],
        },
      },
      orderBy: [
        { field: { fieldPath: fieldName }, direction: "DESCENDING" },
        { field: { fieldPath: "__name__" }, direction: "DESCENDING" },
      ],
      limit: pageLimit,
    };
    if (cursor) {
      structuredQuery.startAt = {
        values: [
          { integerValue: String(cursor.fieldVal) },
          { referenceValue: cursor.docName },
        ],
        before: false,
      };
    }

    console.log(`🔍 [AUDIT-HISTORY] [FS] page ${pageNum} type=${type} org=${org} from=${from} to=${to} pageLimit=${pageLimit} cursor=${cursor ? `ts=${cursor.fieldVal}` : "none"}`);
    const res = await fsFetch(creds, `${parent}:runQuery`, { method: "POST", body: JSON.stringify({ structuredQuery }) });
    if (!res.ok) {
      console.error(`❌ [AUDIT-HISTORY] [FS] Firestore returned ${res.status}: ${res.text}`);
      throw new Error(`Firestore completedAt query failed: ${res.status} ${res.text}`);
    }
    let rows: Array<{ document?: { name?: string; fields?: Record<string, FsValue> } }>;
    try {
      rows = JSON.parse(res.text) as Array<{ document?: { name?: string; fields?: Record<string, FsValue> } }>;
    } catch (err) {
      console.error(`❌ [AUDIT-HISTORY] [FS] failed to parse Firestore response:`, err);
      throw err;
    }

    let docRows = 0;
    let lastFieldVal: number | null = null;
    let lastDocName: string | null = null;
    for (const row of rows) {
      if (!row.document?.fields || !row.document?.name) continue;
      docRows++;
      try {
        const obj = objectFromFields(row.document.fields) as DocBody;
        if (isExpired(obj)) continue;
        out.push(obj);
        const fv = (obj as Record<string, unknown>)[fieldName];
        if (typeof fv === "number") lastFieldVal = fv;
        lastDocName = row.document.name;
        if (out.length >= limit) break;
      } catch (err) {
        console.error(`❌ [AUDIT-HISTORY] [FS] objectFromFields threw on row:`, err);
      }
    }
    console.log(`✅ [AUDIT-HISTORY] [FS] page ${pageNum} returned ${docRows} doc rows (accumulated ${out.length})`);

    if (docRows < pageLimit) break;
    if (lastFieldVal == null || !lastDocName) break;
    cursor = { fieldVal: lastFieldVal, docName: lastDocName };
  }

  console.log(`✅ [AUDIT-HISTORY] [FS] decoded ${out.length} valid docs across ${pageNum} page(s)`);
  return out;
}

function inMemListByCompletedAt(type: string, org: string, from: number, to: number, limit: number, fieldName: string): DocBody[] {
  const out: DocBody[] = [];
  for (const body of _inMem.values()) {
    if (out.length >= limit) break;
    if (body._type !== type || body._org !== org) continue;
    if (isExpired(body)) continue;
    const ts = (body as Record<string, unknown>)[fieldName];
    if (typeof ts !== "number" || ts < from || ts > to) continue;
    out.push(body);
  }
  out.sort((a, b) => Number((b as Record<string, unknown>)[fieldName]) - Number((a as Record<string, unknown>)[fieldName]));
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
  if (!res.ok) throw new Error(`Firestore prefix query failed: ${res.status} ${res.text}`);
  const rows = JSON.parse(res.text) as Array<{ document?: { name?: string; fields?: Record<string, FsValue> } }>;
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

/** Paginated by-type scan. Pages 5000 docs at a time using __name__ as the
 *  cursor (no custom composite index needed — Firestore always indexes
 *  __name__). Returns every doc matching (_type, _org), even when the
 *  total exceeds the per-runQuery response budget. Used by
 *  listStoredWithKeysAll for bulk maintenance work that must NOT silently
 *  truncate at a single-shot limit. */
const LIST_BY_TYPE_PAGE_SIZE = 5_000;

async function restListByTypePaged(creds: FirestoreCreds, type: string, org: string): Promise<DocBody[]> {
  const parent = `projects/${creds.projectId}/databases/${creds.databaseId}/documents`;
  const out: DocBody[] = [];
  let cursorDocName: string | null = null;
  let pageNum = 0;

  while (true) {
    pageNum++;
    const structuredQuery: Record<string, unknown> = {
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
      orderBy: [
        { field: { fieldPath: "__name__" }, direction: "ASCENDING" },
      ],
      limit: LIST_BY_TYPE_PAGE_SIZE,
    };
    if (cursorDocName) {
      structuredQuery.startAt = {
        values: [{ referenceValue: cursorDocName }],
        before: false,
      };
    }
    console.log(`🔍 [LIST-PAGED] type=${type} org=${org} page=${pageNum} cursor=${cursorDocName ? cursorDocName.split("/").pop() : "none"}`);
    const res = await fsFetch(creds, `${parent}:runQuery`, { method: "POST", body: JSON.stringify({ structuredQuery }) });
    if (!res.ok) throw new Error(`paged list failed: ${res.status} ${res.text}`);
    const rows = JSON.parse(res.text) as Array<{ document?: { name?: string; fields?: Record<string, FsValue> } }>;
    let pageRows = 0;
    let lastDocName: string | null = null;
    for (const row of rows) {
      if (!row.document?.fields || !row.document?.name) continue;
      pageRows++;
      const obj = objectFromFields(row.document.fields) as DocBody;
      if (isExpired(obj)) continue;
      out.push(obj);
      lastDocName = row.document.name;
    }
    console.log(`✅ [LIST-PAGED] type=${type} page=${pageNum} returned ${pageRows} rows (accumulated ${out.length})`);
    if (pageRows < LIST_BY_TYPE_PAGE_SIZE || !lastDocName) break;
    cursorDocName = lastDocName;
  }
  return out;
}

/** Like listStoredWithKeys, but paginates internally — returns EVERY doc
 *  of (_type, _org), no silent truncation. Use for bulk maintenance ops
 *  (dedup, purge) where leaving orphans isn't acceptable. Heavier per
 *  call than listStoredWithKeys (multi-page), so do NOT use on the
 *  request-hot-path; this is meant for background-lane work. */
export async function listStoredWithKeysAll<T>(
  type: string,
  org: string,
): Promise<Array<{ key: string[]; value: T }>> {
  const creds = await loadFirestoreCredentials();
  if (!creds) {
    // In-mem fallback: just dump everything matching.
    return inMemListByType(type, org, Number.MAX_SAFE_INTEGER).map((b) => ({
      key: b._key, value: unwrapPayload<T>(b),
    }));
  }
  const bodies = await restListByTypePaged(creds, type, org);
  return bodies.map((b) => ({ key: b._key, value: unwrapPayload<T>(b) }));
}

/** Paginated keys-only scan. Returns the parsed key parts for every
 *  matching (_type, _org) doc, WITHOUT fetching the doc body. For types
 *  with large bodies (audit-finding chunks contain transcripts + Q&A,
 *  ~50KB each), bringing back the body for a 5000-row page produces
 *  multi-hundred-MB responses that hog the HTTP/2 stream pool to
 *  Firestore — every other concurrent FS call on the isolate stalls
 *  waiting for free streams and aborts at 60s. select: __name__ keeps
 *  responses tiny (~100 bytes per row) so the connection pool stays
 *  free for foreground work.
 *
 *  Decodes the key from the doc name. Doc names encode the key as
 *  `type__org__keyPart0__keyPart1__...` (see encodeDocId). safePart
 *  collapses any `__` inside an individual part down to `_`, so a
 *  simple split on `__` is unambiguous. */
export async function listStoredKeysAll(type: string, org: string): Promise<Array<{ key: string[] }>> {
  const creds = await loadFirestoreCredentials();
  if (!creds) {
    return inMemListByType(type, org, Number.MAX_SAFE_INTEGER).map((b) => ({ key: b._key }));
  }
  const parent = `projects/${creds.projectId}/databases/${creds.databaseId}/documents`;
  const out: Array<{ key: string[] }> = [];
  let cursorDocName: string | null = null;
  let pageNum = 0;
  const safeType = type.replace(/__/g, "_").replace(/\//g, "_").replace(/\./g, "_");
  const safeOrg = org.replace(/__/g, "_").replace(/\//g, "_").replace(/\./g, "_");
  const docPrefix = `${safeType}${SEP}${safeOrg}${SEP}`;

  while (true) {
    pageNum++;
    const structuredQuery: Record<string, unknown> = {
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
      orderBy: [{ field: { fieldPath: "__name__" }, direction: "ASCENDING" }],
      select: { fields: [{ fieldPath: "__name__" }] },
      limit: LIST_BY_TYPE_PAGE_SIZE,
    };
    if (cursorDocName) {
      structuredQuery.startAt = {
        values: [{ referenceValue: cursorDocName }],
        before: false,
      };
    }
    console.log(`🔍 [LIST-KEYS] type=${type} org=${org} page=${pageNum} cursor=${cursorDocName ? cursorDocName.split("/").pop() : "none"}`);
    const res = await fsFetch(creds, `${parent}:runQuery`, { method: "POST", body: JSON.stringify({ structuredQuery }) });
    if (!res.ok) throw new Error(`paged keys list failed: ${res.status} ${res.text}`);
    const rows = JSON.parse(res.text) as Array<{ document?: { name?: string } }>;
    let pageRows = 0;
    let lastDocName: string | null = null;
    for (const row of rows) {
      if (!row.document?.name) continue;
      pageRows++;
      lastDocName = row.document.name;
      // Doc name: projects/.../documents/<collection>/<encodedDocId>
      const encoded = row.document.name.split("/").pop() ?? "";
      if (!encoded.startsWith(docPrefix)) continue;
      const keyJoined = encoded.slice(docPrefix.length);
      const key = keyJoined.length > 0 ? keyJoined.split(SEP) : [];
      out.push({ key });
    }
    console.log(`✅ [LIST-KEYS] type=${type} page=${pageNum} returned ${pageRows} rows (accumulated ${out.length})`);
    if (pageRows < LIST_BY_TYPE_PAGE_SIZE || !lastDocName) break;
    cursorDocName = lastDocName;
  }
  return out;
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

/** Bulk-purge every doc of `type` belonging to `org` using Firestore's batch
 *  commit endpoint (up to 500 deletes per HTTP call). Sequential per-doc
 *  deletes via REST do not scale: 700 rows × Firestore latency consistently
 *  blows the 60s isolate timeout in production. This routes through the
 *  `:commit` endpoint instead — one HTTP call clears 500 docs in ~1s.
 *
 *  Returns the number of docs deleted. Safe to call on a non-existent
 *  type/org combo (returns 0). Falls back to in-memory wipe in local mode. */
export async function purgeByTypeAndOrg(type: string, org: string, limit = 50_000): Promise<number> {
  const creds = await loadFirestoreCredentials();
  if (!creds) {
    let count = 0;
    for (const [id, body] of [..._inMem.entries()]) {
      if (body._type === type && body._org === org) {
        _inMem.delete(id);
        count++;
        if (count >= limit) break;
      }
    }
    return count;
  }

  const parent = `projects/${creds.projectId}/databases/${creds.databaseId}/documents`;
  const collectionPrefix = `${parent}/${creds.collection}/`;

  // Fetch matching doc names. We only need name (not full body), so use a
  // selector — keeps the response tiny even for tens of thousands of rows.
  const queryBody = {
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
      select: { fields: [{ fieldPath: "__name__" }] },
      limit,
    },
  };
  const queryRes = await fsFetch(creds, `${parent}:runQuery`, { method: "POST", body: JSON.stringify(queryBody) });
  if (!queryRes.ok) throw new Error(`purgeByTypeAndOrg query failed: ${queryRes.status} ${queryRes.text}`);
  const rows = JSON.parse(queryRes.text) as Array<{ document?: { name?: string } }>;
  const names = rows.map((r) => r.document?.name).filter((n): n is string => !!n);
  if (names.length === 0) return 0;

  let deleted = 0;
  const BATCH = 500;
  for (let i = 0; i < names.length; i += BATCH) {
    const slice = names.slice(i, i + BATCH);
    const commitBody = { writes: slice.map((name) => ({ delete: name })) };
    const res = await fsFetch(creds, `${parent}:commit`, { method: "POST", body: JSON.stringify(commitBody) });
    if (!res.ok) throw new Error(`purgeByTypeAndOrg commit failed: ${res.status} ${res.text}`);
    deleted += slice.length;
  }
  // Touch collectionPrefix so unused-var lint stays quiet without changing semantics.
  void collectionPrefix;
  return deleted;
}

/** Bulk-delete a list of doc IDs via Firestore's `:commit` endpoint.
 *  Up to 500 deletes per HTTP call. `delete` writes are idempotent —
 *  the call succeeds whether or not the doc exists, so callers can
 *  blind-emit candidate IDs without checking existence first.
 *
 *  Returns the number of doc IDs sent to commit (NOT the number that
 *  actually existed; Firestore doesn't report that distinction here).
 *  Used by deleteDuplicates and similar batch maintenance ops to drop
 *  the FS-call-per-finding cost from N×K to N/500. */
export async function commitDeletes(docIds: string[]): Promise<number> {
  if (docIds.length === 0) return 0;
  const creds = await loadFirestoreCredentials();
  if (!creds) {
    let count = 0;
    for (const id of docIds) {
      if (_inMem.delete(id)) count++;
    }
    return count;
  }
  const parent = `projects/${creds.projectId}/databases/${creds.databaseId}/documents`;
  const collectionPrefix = `${parent}/${creds.collection}/`;
  const BATCH = 500;
  let sent = 0;
  for (let i = 0; i < docIds.length; i += BATCH) {
    const slice = docIds.slice(i, i + BATCH);
    const writes = slice.map((id) => ({ delete: `${collectionPrefix}${id}` }));
    const res = await fsFetch(creds, `${parent}:commit`, { method: "POST", body: JSON.stringify({ writes }) });
    if (!res.ok) throw new Error(`commitDeletes failed: ${res.status} ${res.text}`);
    sent += slice.length;
  }
  return sent;
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

/** List values matching this type+org whose timestamp field is in [from, to]
 *  (ms since epoch, inclusive), sorted newest-first. Backed by a Firestore
 *  composite-indexed range query — fast and bounded.
 *  First-time use surfaces a Firestore "create index" URL; click it once,
 *  wait ~1-5 min for the index to build, then this query is fast forever.
 *
 *  fieldName defaults to "completedAt" for backwards compat. For
 *  completed-audit-stat use fieldName="ts". */
/** Shared field-filter scan core. Wrapped by the two public variants
 *  below — one that returns values-only (the common case), one that
 *  preserves keys (used when the caller needs to filter by a key part
 *  e.g. review-active's reviewer-email prefix). Single Firestore call
 *  + decode loop; the wrappers just pick which shape to project. */
async function _listStoredByFieldRaw(
  type: string,
  org: string,
  from: number,
  to: number,
  opts: { limit?: number; fieldName?: string } = {},
): Promise<DocBody[]> {
  const limit = opts.limit ?? 5000;
  const fieldName = opts.fieldName ?? "completedAt";
  const creds = await loadFirestoreCredentials();
  return creds
    ? await restListByCompletedAt(creds, type, org, from, to, limit, fieldName)
    : inMemListByCompletedAt(type, org, from, to, limit, fieldName);
}

export async function listStoredByCompletedAt<T>(
  type: string,
  org: string,
  from: number,
  to: number,
  opts: { limit?: number; fieldName?: string } = {},
): Promise<T[]> {
  const bodies = await _listStoredByFieldRaw(type, org, from, to, opts);
  return bodies.map((b) => unwrapPayload<T>(b));
}

/** Same field-filter scan as listStoredByCompletedAt, but returns each
 *  result paired with its key parts. */
export async function listStoredByCompletedAtWithKeys<T>(
  type: string,
  org: string,
  from: number,
  to: number,
  opts: { limit?: number; fieldName?: string } = {},
): Promise<Array<{ key: string[]; value: T }>> {
  const bodies = await _listStoredByFieldRaw(type, org, from, to, opts);
  return bodies.map((b) => ({ key: b._key, value: unwrapPayload<T>(b) }));
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
