/** KV → Firestore migration business logic.
 *
 *  Reads prod data over HTTP via password-protected endpoints on the prod
 *  (`main` branch) deployment:
 *    POST {PROD_EXPORT_BASE_URL}/admin/kv-export    — paginated list (data)
 *    POST {PROD_EXPORT_BASE_URL}/admin/kv-inventory — paginated counts
 *  Both authenticated by KV_EXPORT_SECRET in the Authorization header.
 *
 *  Driver-mode architecture: job state is persisted to Firestore. The
 *  /admin/migration/status endpoint is the tick — each call processes up
 *  to TICK_BUDGET_MS of work, then returns the rendered fragment. The
 *  frontend self-polls every ~2s. Survives any number of isolate restarts.
 *  Never writes to prod KV.
 *
 *  All log lines include the literal string [MIGRATION] for filterability. */

import { setStored, setStoredChunked, getStored, getStoredChunked, listStored } from "@core/data/firestore/mod.ts";

// ── Constants ────────────────────────────────────────────────────────────────

/** Firestore "type" namespace for persisted job state. */
const JOB_TYPE = "migration-job";
/** Firestore "type" namespace for the chunked-group reassembly queue. */
const QUEUE_TYPE = "migration-chunked-queue";
/** Max wall-clock seconds spent inside one tick. Must stay well under
 *  Deno Deploy's 60s request timeout so the response always returns. */
const TICK_BUDGET_MS = 30_000;
/** A job whose lastTickAt is older than this is auto-marked errored to
 *  prevent zombie-polling. */
const STALE_TICK_MS = 5 * 60_000;
/** /kv-export pagination batch size. Higher = fewer round-trips, more
 *  memory per request. Deno KV's `kv.list({ limit })` is hard-capped at
 *  1000 by the runtime — exceeding throws "Too many entries (max 1000)". */
const EXPORT_BATCH_LIMIT = 1000;
/** Max chunked-group reassemblies to fire in parallel within one tick.
 *  Each is one /kv-export prefix walk (returning ~5-6 entries). */
const CHUNKED_PARALLEL = 10;
/** Chunk-N variants to probe per (org, type) when prefix-narrowing.
 *  Variants beyond this are missed; we widen if needed. */
const CHUNK_VARIANT_PROBE_MAX = 10;

// ── Type classification ──────────────────────────────────────────────────────

export const GLOBAL_TYPES = new Set([
  "org", "org-by-slug", "email-index", "session", "default-org",
  "audit-finding", "audit-transcript", "token-usage",
]);

export const SKIP_TYPES = new Set([
  "session",
  "review-pending", "review-decided", "review-audit-pending",
]);

const TIMESTAMPED_FIELDS: Record<string, string[]> = {
  "audit-finding": ["startedAt", "ts", "createdAt"],
  "audit-done-idx": ["startedAt", "ts"],
  "completed-audit-stat": ["ts", "completedAt"],
  "appeal": ["createdAt", "ts"],
  "appeal-history": ["ts", "createdAt"],
  "manager-queue": ["createdAt"],
  "manager-remediation": ["createdAt"],
  "review-done": ["reviewedAt"],
};

// ── Key decoder ──────────────────────────────────────────────────────────────

export interface DecodedKey {
  type: string;
  org: string;
  keyParts: (string | number)[];
  isChunkPart: boolean;
  isChunkMeta: boolean;
}

export function decodeKey(key: Deno.KvKey): DecodedKey | null {
  if (!Array.isArray(key) || key.length === 0) return null;
  const first = String(key[0] ?? "");

  if (first.startsWith("__") && first.endsWith("__")) {
    const typeName = first.slice(2, -2);
    const kebab = typeName.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
    const org = String(key[1] ?? "");
    const rest = key.slice(2).map((p) => typeof p === "number" ? p : String(p));
    return classifyChunk(kebab, org, rest);
  }

  if (GLOBAL_TYPES.has(first)) {
    const rest = key.slice(1).map((p) => typeof p === "number" ? p : String(p));
    return classifyChunk(first, "", rest);
  }

  if (key.length >= 2 && typeof key[1] === "string") {
    const org = first;
    const type = String(key[1]);
    const rest = key.slice(2).map((p) => typeof p === "number" ? p : String(p));
    return classifyChunk(type, org, rest);
  }

  return null;
}

function classifyChunk(type: string, org: string, rest: (string | number)[]): DecodedKey {
  const last = rest[rest.length - 1];
  if (last === "_n") {
    return { type, org, keyParts: rest.slice(0, -1), isChunkPart: false, isChunkMeta: true };
  }
  if (rest.length >= 2 && typeof last === "number") {
    return { type, org, keyParts: rest.slice(0, -1), isChunkPart: true, isChunkMeta: false };
  }
  return { type, org, keyParts: rest, isChunkPart: false, isChunkMeta: false };
}

/** Strip `-chunk-N` suffix so `audit-finding-chunk-0` matches user filter
 *  `audit-finding`. Without this, chunked types are silently dropped from
 *  type-filtered runs. */
const CHUNK_SUFFIX_RE = /-chunk-\d+$/;
export function baseType(decodedType: string): string {
  return decodedType.replace(CHUNK_SUFFIX_RE, "");
}

// ── Prod connection ──────────────────────────────────────────────────────────

export function prodExportBaseUrl(): string {
  return (Deno.env.get("PROD_EXPORT_BASE_URL") ?? "").replace(/\/+$/, "");
}

export function ensureProdKvConfigured(): { ok: true } | { ok: false; error: string } {
  const url = prodExportBaseUrl();
  if (!url) return { ok: false, error: "PROD_EXPORT_BASE_URL env var is not set" };
  if (!Deno.env.get("KV_EXPORT_SECRET")) {
    return { ok: false, error: "KV_EXPORT_SECRET env var is not set" };
  }
  if (!url.startsWith("https://")) {
    return { ok: false, error: `PROD_EXPORT_BASE_URL must start with https://: ${url}` };
  }
  return { ok: true };
}

function decodeValue(v: unknown, skipped: Array<{ reason: string }>): unknown {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map((x) => decodeValue(x, skipped));
  const obj = v as Record<string, unknown>;
  const tag = obj["__kvType"];
  if (typeof tag === "string") {
    if (tag === "u8a" && typeof obj["data"] === "string") {
      const bin = atob(obj["data"]);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    if (tag === "date" && typeof obj["iso"] === "string") {
      return new Date(obj["iso"]);
    }
    if (tag === "skipped") {
      skipped.push({ reason: String(obj["reason"] ?? "unknown") });
      return null;
    }
    return v;
  }
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(obj)) out[k] = decodeValue(val, skipped);
  return out;
}

interface ExportPage {
  ok: boolean;
  entries: Array<{ key: Deno.KvKey; value: unknown; versionstamp: string }>;
  nextCursor?: string;
  done: boolean;
  error?: string;
}

/** Fetches one /kv-export page. Surfaces decode-skip warnings via the
 *  passed-in array so the caller can record them on the job state. */
async function fetchExportPage(
  base: string, secret: string, prefix: Deno.KvKey, cursor: string | null,
  skipped: Array<{ reason: string }>,
): Promise<{ entries: Array<{ key: Deno.KvKey; value: unknown; versionstamp: string }>; nextCursor: string | null; done: boolean }> {
  const body: Record<string, unknown> = { prefix, limit: EXPORT_BATCH_LIMIT };
  if (cursor) body.cursor = cursor;
  const res = await fetch(`${base}/admin/kv-export`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`kv-export HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json() as ExportPage;
  if (!data.ok) throw new Error(`kv-export error: ${data.error ?? "unknown"}`);
  const decoded = data.entries.map((e) => ({
    key: e.key,
    value: decodeValue(e.value, skipped),
    versionstamp: e.versionstamp,
  }));
  return { entries: decoded, nextCursor: data.nextCursor ?? null, done: data.done };
}

// ── Inventory ────────────────────────────────────────────────────────────────

export interface InventoryRow {
  org: string;
  type: string;
  count: number;
  chunkedCount: number;
}

interface InventoryPage {
  ok: boolean;
  scannedThisCall?: number;
  totalKeys?: number;
  byPrefix: Record<string, number>;
  nextCursor?: string;
  done: boolean;
  error?: string;
}

/** Drives prod's paginated /admin/kv-inventory endpoint. Loops cursor-by-
 *  cursor with a tight wall-clock budget so the surrounding HTTP request
 *  doesn't exceed Deno Deploy's 60s timeout. Returns whatever counts we've
 *  accumulated; on partial completion (done=false at budget exhaustion)
 *  the caller can decide whether to display partial data or error. */
export async function inventoryProdKv(): Promise<{ rows: InventoryRow[]; partial: boolean; scanned: number }> {
  const ck = ensureProdKvConfigured();
  if (!ck.ok) throw new Error(ck.error);

  const base = prodExportBaseUrl();
  const secret = (Deno.env.get("KV_EXPORT_SECRET") ?? "").trim();

  const start = Date.now();
  const BUDGET_MS = 50_000;
  const accum: Record<string, number> = {};
  let cursor: string | null = null;
  let totalScanned = 0;
  let done = false;
  let pages = 0;

  console.log(`[MIGRATION:INVENTORY] starting paginated walk base=${base}`);

  while (Date.now() - start < BUDGET_MS) {
    const body: Record<string, unknown> = { budgetMs: 30_000 };
    if (cursor) body.cursor = cursor;
    const res = await fetch(`${base}/admin/kv-inventory`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`kv-inventory HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = await res.json() as InventoryPage;
    if (!data.ok) throw new Error(`kv-inventory error: ${data.error ?? "unknown"}`);

    pages++;
    const pageCount = data.scannedThisCall ?? 0;
    totalScanned += pageCount;
    for (const [k, v] of Object.entries(data.byPrefix)) {
      accum[k] = (accum[k] ?? 0) + v;
    }
    console.log(`[MIGRATION:INVENTORY] page=${pages} scannedThisCall=${pageCount} totalScanned=${totalScanned} done=${data.done}`);

    if (data.done) { done = true; break; }
    if (!data.nextCursor) {
      throw new Error(`kv-inventory done=false but no nextCursor (page ${pages})`);
    }
    cursor = data.nextCursor;
  }

  console.log(`[MIGRATION:INVENTORY] complete pages=${pages} totalScanned=${totalScanned} done=${done} elapsedMs=${Date.now() - start}`);

  // Translate byPrefix → InventoryRow[]
  const rows = new Map<string, { count: number; chunkedCount: number }>();
  const chunkRe = /^(.+)-chunk-(\d+)$/;
  for (const [prefix, count] of Object.entries(accum)) {
    const slash = prefix.indexOf("/");
    const org = slash < 0 ? "" : prefix.slice(0, slash);
    const typeRaw = slash < 0 ? prefix : prefix.slice(slash + 1);
    const m = chunkRe.exec(typeRaw);
    if (m) {
      const chunkIdx = Number(m[2]);
      const baseType = m[1];
      const k = `${org}\u0001${baseType}`;
      const cur = rows.get(k) ?? { count: 0, chunkedCount: 0 };
      if (chunkIdx === 0) cur.chunkedCount += count;
      rows.set(k, cur);
    } else {
      const k = `${org}\u0001${typeRaw}`;
      const cur = rows.get(k) ?? { count: 0, chunkedCount: 0 };
      cur.count += count;
      rows.set(k, cur);
    }
  }

  const out: InventoryRow[] = [];
  for (const [k, v] of rows) {
    const [org, type] = k.split("\u0001", 2);
    out.push({ org, type, count: v.count, chunkedCount: v.chunkedCount });
  }
  out.sort((a, b) => (b.count + b.chunkedCount) - (a.count + a.chunkedCount));
  return { rows: out, partial: !done, scanned: totalScanned };
}

// ── Job state (Firestore-persisted) ──────────────────────────────────────────

export type JobStatus = "running" | "done" | "cancelled" | "error";
export type JobPhase = "init" | "scanning" | "chunked" | "done";

export interface RunOpts {
  types?: string[];
  since?: number;
  until?: number;
  dryRun?: boolean;
  sinceVersionstamp?: string;
}

export interface PersistedJob {
  jobId: string;
  startedAt: number;
  endedAt: number | null;
  status: JobStatus;
  cancelled: boolean;
  phase: JobPhase;
  cursor: string | null;
  scanned: number;
  written: number;
  writtenChunked: number;
  skipped: number;
  errors: string[];
  message: string;
  lastTickAt: number;
  opts: RunOpts;
  /** Per-base-type counters; populated even on dry-run so the user can see
   *  what's being matched live. Key = base type (chunk suffix stripped). */
  byType: Record<string, { count: number; chunkedCount: number }>;
  /** Index into the (deterministic) list of scan prefixes, currently being
   *  walked. The prefix list itself is recomputed from (opts.types,
   *  knownOrgs) on every tick — Firestore disallows nested arrays so we
   *  don't persist Array<Deno.KvKey> directly. */
  scanPrefixIdx: number;
  /** Orgs discovered during init phase. Used to compute scan prefixes. */
  knownOrgs: string[];
  /** Number of chunked-groups discovered so far. */
  chunkedQueueSize: number;
  /** Number of chunked-groups processed (or marked seen) so far. */
  chunkedQueueProcessed: number;
}

interface ChunkedQueueDoc {
  jobId: string;
  entries: Array<{ type: string; org: string; keyParts: (string | number)[] }>;
}

// ─── Persistence helpers ───
async function loadJob(jobId: string): Promise<PersistedJob | null> {
  return await getStored<PersistedJob>(JOB_TYPE, "", jobId);
}

async function saveJob(state: PersistedJob): Promise<void> {
  await setStored(JOB_TYPE, "", [state.jobId], state);
}

async function loadQueue(jobId: string): Promise<ChunkedQueueDoc> {
  const q = await getStoredChunked<ChunkedQueueDoc>(QUEUE_TYPE, "", jobId);
  return q ?? { jobId, entries: [] };
}

async function saveQueue(q: ChunkedQueueDoc): Promise<void> {
  await setStoredChunked(QUEUE_TYPE, "", [q.jobId], q);
}

// ─── Public API ───
function newJobId(): string {
  return "m_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

export async function getJob(jobId: string): Promise<PersistedJob | null> {
  return await loadJob(jobId);
}

export async function listJobs(): Promise<PersistedJob[]> {
  const all = await listStored<PersistedJob>(JOB_TYPE, "");
  return all.sort((a, b) => b.startedAt - a.startedAt);
}

export async function createJob(opts: RunOpts): Promise<string> {
  const ck = ensureProdKvConfigured();
  if (!ck.ok) throw new Error(ck.error);

  const jobId = newJobId();
  const sid = jobId.slice(-6);
  const now = Date.now();
  const state: PersistedJob = {
    jobId,
    startedAt: now,
    endedAt: null,
    status: "running",
    cancelled: false,
    phase: "init",
    cursor: null,
    scanned: 0, written: 0, writtenChunked: 0, skipped: 0,
    errors: [],
    message: "queued — first tick pending",
    lastTickAt: now,
    opts,
    byType: {},
    scanPrefixIdx: 0,
    knownOrgs: [],
    chunkedQueueSize: 0,
    chunkedQueueProcessed: 0,
  };
  await saveJob(state);
  await saveQueue({ jobId, entries: [] });
  console.log(`🚀 [MIGRATION:CREATE:${sid}] types=${opts.types?.join(",") ?? "(all)"} since=${opts.since ?? "-"} until=${opts.until ?? "-"} dryRun=${!!opts.dryRun} sinceVS=${opts.sinceVersionstamp ?? "-"}`);
  return jobId;
}

export async function cancelJob(jobId: string): Promise<boolean> {
  const state = await loadJob(jobId);
  if (!state) return false;
  if (state.status !== "running") return false;
  state.cancelled = true;
  state.message = "cancellation requested — will halt at next tick boundary";
  await saveJob(state);
  console.log(`🛑 [MIGRATION:CANCEL:${jobId.slice(-6)}] flag set`);
  return true;
}

export async function forceCancelJob(jobId: string): Promise<boolean> {
  const state = await loadJob(jobId);
  if (!state) return false;
  if (state.status !== "running") return false;
  state.status = "cancelled";
  state.cancelled = true;
  state.endedAt = Date.now();
  state.message = `force-cancelled at scanned=${state.scanned}`;
  await saveJob(state);
  console.log(`⛔ [MIGRATION:FORCE-CANCEL:${jobId.slice(-6)}] terminated immediately scanned=${state.scanned}`);
  return true;
}

export async function killAllRunningJobs(): Promise<number> {
  const all = await listJobs();
  let killed = 0;
  for (const j of all) {
    if (j.status === "running") {
      j.status = "cancelled";
      j.cancelled = true;
      j.endedAt = Date.now();
      j.message = "killed by Kill All";
      await saveJob(j);
      killed++;
      console.log(`⛔ [MIGRATION:KILL-ALL:${j.jobId.slice(-6)}] terminated`);
    }
  }
  console.log(`⛔ [MIGRATION:KILL-ALL] killed=${killed}`);
  return killed;
}

// ── Tick loop ────────────────────────────────────────────────────────────────

/** Drives one tick of the job. Returns the (possibly updated) state. Safe
 *  to call repeatedly; idempotent at any granularity. */
export async function tickJob(jobId: string): Promise<PersistedJob | null> {
  const sid = jobId.slice(-6);
  let state = await loadJob(jobId);
  if (!state) {
    console.log(`⚠️ [MIGRATION:TICK:${sid}] job not found`);
    return null;
  }

  if (state.status !== "running") {
    return state;
  }

  // Stale-job detection: if we haven't ticked in 5 minutes, something's
  // wrong and we shouldn't keep racking up cost on a zombie.
  const sinceLast = Date.now() - state.lastTickAt;
  if (sinceLast > STALE_TICK_MS && state.scanned > 0) {
    state.status = "error";
    state.endedAt = Date.now();
    state.message = `stale — no progress in ${Math.round(sinceLast / 1000)}s`;
    state.errors.push(`stale: lastTickAt was ${sinceLast}ms ago`);
    await saveJob(state);
    console.log(`⚠️ [MIGRATION:TICK:${sid}] STALE sinceLast=${sinceLast}ms`);
    return state;
  }

  if (state.cancelled) {
    state.status = "cancelled";
    state.endedAt = Date.now();
    state.message = `cancelled at scanned=${state.scanned}`;
    await saveJob(state);
    console.log(`🛑 [MIGRATION:TICK:${sid}] cancelled scanned=${state.scanned} written=${state.written}`);
    return state;
  }

  const tickStart = Date.now();
  const skipped: Array<{ reason: string }> = [];
  const base = prodExportBaseUrl();
  const secret = (Deno.env.get("KV_EXPORT_SECRET") ?? "").trim();
  let queue: ChunkedQueueDoc | null = null;
  let queueDirty = false;
  let progressed = false;
  let lastCancelCheckAt = tickStart;

  try {
    while (Date.now() - tickStart < TICK_BUDGET_MS) {
      // Re-check cancel flag every ~5s so a cancel during a long tick is observed
      if (Date.now() - lastCancelCheckAt > 5000) {
        const fresh = await loadJob(jobId);
        if (fresh?.cancelled) {
          state.cancelled = true;
          break;
        }
        lastCancelCheckAt = Date.now();
      }

      if (state.phase === "init") {
        await initScanPrefixes(state, base, secret);
        progressed = true;
      } else if (state.phase === "scanning") {
        if (queue === null) queue = await loadQueue(jobId);
        const moved = await scanOneBatch(state, queue, base, secret, skipped);
        if (moved) { progressed = true; queueDirty = true; }
        if (state.phase !== "scanning") {
          if (queueDirty) { await saveQueue(queue); queueDirty = false; }
        }
      } else if (state.phase === "chunked") {
        if (queue === null) queue = await loadQueue(jobId);
        const moved = await reassembleChunkedBatch(state, queue, base, secret);
        if (moved) progressed = true;
      } else {
        break;
      }

      if (!progressed) break;
      progressed = false;
    }
  } catch (err) {
    const msg = `tick error: ${String(err).slice(0, 200)}`;
    state.errors.push(msg);
    if (state.errors.length > 50) state.errors = state.errors.slice(-50);
    console.log(`❌ [MIGRATION:TICK:${sid}] ${msg}`);
    // Do NOT transition to error — let the next tick try again. Only fatal
    // configuration errors set status="error" (caught at createJob time).
  }

  // Surface skipped values from decode (bigint/Map/Set on prod side)
  if (skipped.length > 0) {
    const reasons = new Map<string, number>();
    for (const s of skipped) reasons.set(s.reason, (reasons.get(s.reason) ?? 0) + 1);
    for (const [reason, n] of reasons) {
      state.errors.push(`⚠️ ${n} value(s) un-migrated this tick: prod-side ${reason} cannot be JSON-encoded`);
    }
    if (state.errors.length > 50) state.errors = state.errors.slice(-50);
  }

  // Persist queue if dirty
  if (queueDirty && queue !== null) {
    await saveQueue(queue);
  }

  state.lastTickAt = Date.now();

  if (state.cancelled && state.status === "running") {
    state.status = "cancelled";
    state.endedAt = Date.now();
    state.message = `cancelled at scanned=${state.scanned}`;
    console.log(`🛑 [MIGRATION:TICK:${sid}] cancelled mid-tick scanned=${state.scanned}`);
  } else if (state.phase === "done" && state.status === "running") {
    state.status = "done";
    state.endedAt = Date.now();
    state.message = `complete — scanned ${state.scanned}, wrote ${state.written} simple + ${state.writtenChunked} chunked`;
    console.log(`✅ [MIGRATION:TICK:${sid}] DONE scanned=${state.scanned} written=${state.written} chunked=${state.writtenChunked} skipped=${state.skipped} errors=${state.errors.length}`);
  } else {
    const elapsed = Date.now() - tickStart;
    console.log(`📝 [MIGRATION:TICK:${sid}] phase=${state.phase} scanned=${state.scanned} written=${state.written} chunked=${state.writtenChunked} skipped=${state.skipped} errors=${state.errors.length} tickMs=${elapsed}`);
    state.message = `${state.phase}: scanned ${state.scanned} keys, ${state.chunkedQueueProcessed}/${state.chunkedQueueSize} chunked`;
  }

  await saveJob(state);
  return state;
}

// ── Tick phase: init (discover orgs + compute prefixes) ─────────────────────

async function initScanPrefixes(
  state: PersistedJob, base: string, secret: string,
): Promise<void> {
  const sid = state.jobId.slice(-6);
  console.log(`🔧 [MIGRATION:INIT:${sid}] discovering orgs`);

  // Discover orgs by walking ["org"] prefix. Tiny — usually 1-10 entries.
  const orgs = new Set<string>();
  let cursor: string | null = null;
  const skipped: Array<{ reason: string }> = [];
  while (true) {
    const page = await fetchExportPage(base, secret, ["org"], cursor, skipped);
    for (const e of page.entries) {
      // ["org", orgId] — orgId is at position 1
      if (e.key.length >= 2 && typeof e.key[1] === "string") {
        orgs.add(e.key[1]);
      }
    }
    if (page.done) break;
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  state.knownOrgs = [...orgs];
  state.scanPrefixIdx = 0;
  state.cursor = null;
  state.phase = "scanning";
  const total = computeScanPrefixes(state.opts.types, state.knownOrgs).length;
  console.log(`🔧 [MIGRATION:INIT:${sid}] orgs=${state.knownOrgs.join(",") || "(none)"} prefixes=${total} types=${state.opts.types?.join(",") ?? "(all)"}`);
}

/** Computes the list of prefix walks to perform during the scanning phase.
 *  When `types` is empty/undefined, we walk the entire DB (one walk of `[]`).
 *  When `types` is specified, we narrow to just the keyspaces that could
 *  contain matching values, across all three known prod key shapes:
 *    1. ["__TypePascal__", ...]            — TypedStore convention
 *    2. ["type", ...]                      — global-keyed (only for known globals)
 *    3. [orgId, "type", ...] AND
 *       [orgId, "type-chunk-N", ...]       — orgKey + chunked variants
 *  Empty prefixes are still walked but return one quick HTTP call (~200ms). */
export function computeScanPrefixes(
  types: string[] | undefined, knownOrgs: string[],
): Array<Deno.KvKey> {
  if (!types || types.length === 0) return [[]];
  const prefixes: Deno.KvKey[] = [];
  for (const type of types) {
    const pascal = type.split("-").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
    prefixes.push([`__${pascal}__`]);
    if (GLOBAL_TYPES.has(type)) prefixes.push([type]);
    for (const org of knownOrgs) {
      prefixes.push([org, type]);
      for (let n = 0; n < CHUNK_VARIANT_PROBE_MAX; n++) {
        prefixes.push([org, `${type}-chunk-${n}`]);
      }
    }
  }
  return prefixes;
}

// ── Tick phase: scan ─────────────────────────────────────────────────────────

async function scanOneBatch(
  state: PersistedJob,
  queue: ChunkedQueueDoc,
  base: string,
  secret: string,
  skipped: Array<{ reason: string }>,
): Promise<boolean> {
  const sid = state.jobId.slice(-6);
  // Recompute the prefix list from (opts.types, knownOrgs) — it's deterministic
  // and avoids persisting Array<Deno.KvKey> (Firestore disallows nested arrays).
  const scanPrefixes = computeScanPrefixes(state.opts.types, state.knownOrgs);
  if (state.scanPrefixIdx >= scanPrefixes.length) {
    state.phase = state.chunkedQueueSize === 0 ? "done" : "chunked";
    console.log(`📦 [MIGRATION:SCAN:${sid}] all prefixes done queueSize=${state.chunkedQueueSize} phase=${state.phase}`);
    return false;
  }

  const prefix = scanPrefixes[state.scanPrefixIdx];
  const page = await fetchExportPage(base, secret, prefix, state.cursor, skipped);
  console.log(`🔍 [MIGRATION:SCAN:${sid}] prefix=${JSON.stringify(prefix)} cursor=${(state.cursor ?? "-").slice(-8)} returned=${page.entries.length} done=${page.done}`);

  for (const entry of page.entries) {
    state.scanned++;

    const decoded = decodeKey(entry.key);
    if (!decoded) { state.skipped++; continue; }
    if (SKIP_TYPES.has(baseType(decoded.type))) { state.skipped++; continue; }
    if (state.opts.types && !state.opts.types.includes(baseType(decoded.type))) { state.skipped++; continue; }

    if (state.opts.sinceVersionstamp && entry.versionstamp <= state.opts.sinceVersionstamp) {
      state.skipped++; continue;
    }

    if (state.opts.since !== undefined || state.opts.until !== undefined) {
      const ts = valueTimestamp(baseType(decoded.type), entry.value);
      if (ts !== null) {
        if (state.opts.since !== undefined && ts < state.opts.since) { state.skipped++; continue; }
        if (state.opts.until !== undefined && ts > state.opts.until) { state.skipped++; continue; }
      }
    }

    const bt = baseType(decoded.type);

    if (decoded.isChunkPart || decoded.isChunkMeta) {
      // De-dupe by group hash; chunk-part and chunk-meta both surface the same group
      if (!queue.entries.some((e) =>
        e.type === decoded.type && e.org === decoded.org &&
        JSON.stringify(e.keyParts) === JSON.stringify(decoded.keyParts)
      )) {
        queue.entries.push({ type: decoded.type, org: decoded.org, keyParts: decoded.keyParts });
        state.chunkedQueueSize++;
        const acc = state.byType[bt] ?? { count: 0, chunkedCount: 0 };
        acc.chunkedCount++;
        state.byType[bt] = acc;
      }
      continue;
    }

    // Non-chunked match — count it for byType regardless of dryRun
    const acc = state.byType[bt] ?? { count: 0, chunkedCount: 0 };
    acc.count++;
    state.byType[bt] = acc;

    if (state.opts.dryRun) { state.skipped++; continue; }

    try {
      await setStored(bt, decoded.org, decoded.keyParts, entry.value);
      state.written++;
    } catch (err) {
      state.errors.push(`${bt}/${decoded.org}/${decoded.keyParts.join(",")}: ${String(err).slice(0, 200)}`);
      if (state.errors.length > 50) state.errors = state.errors.slice(-50);
    }
  }

  state.cursor = page.nextCursor;

  if (page.done) {
    // Move to next prefix
    state.scanPrefixIdx++;
    state.cursor = null;
    if (state.scanPrefixIdx >= scanPrefixes.length) {
      state.phase = state.chunkedQueueSize === 0 ? "done" : "chunked";
      console.log(`📦 [MIGRATION:SCAN:${sid}] all prefixes done queueSize=${state.chunkedQueueSize} phase=${state.phase}`);
    }
  }

  return page.entries.length > 0 || page.done;
}

function valueTimestamp(type: string, value: unknown): number | null {
  const fields = TIMESTAMPED_FIELDS[type];
  if (!fields || typeof value !== "object" || value === null) return null;
  for (const f of fields) {
    const v = (value as Record<string, unknown>)[f];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const parsed = Date.parse(v);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return null;
}

// ── Tick phase: chunked reassembly ───────────────────────────────────────────

/** Processes up to CHUNKED_PARALLEL chunked groups concurrently, then
 *  updates state. Returns true if any progress was made this call. */
async function reassembleChunkedBatch(
  state: PersistedJob,
  queue: ChunkedQueueDoc,
  base: string,
  secret: string,
): Promise<boolean> {
  const sid = state.jobId.slice(-6);
  if (state.chunkedQueueProcessed >= queue.entries.length) {
    state.phase = "done";
    return false;
  }

  const start = state.chunkedQueueProcessed;
  const end = Math.min(start + CHUNKED_PARALLEL, queue.entries.length);
  const batch = queue.entries.slice(start, end);

  console.log(`📦 [MIGRATION:CHUNK:${sid}] processing ${start + 1}-${end}/${queue.entries.length} (parallel=${batch.length})`);

  const results = await Promise.allSettled(batch.map(async (group) => {
    const skipped: Array<{ reason: string }> = [];
    try {
      await migrateChunkedGroup(state, group, base, secret, skipped);
      return { ok: true as const, group, skipped };
    } catch (err) {
      return { ok: false as const, group, err: String(err).slice(0, 200), skipped };
    }
  }));

  for (const r of results) {
    if (r.status !== "fulfilled") {
      state.errors.push(`chunked tick exception: ${String(r.reason).slice(0, 200)}`);
      continue;
    }
    const v = r.value;
    if (v.ok) {
      if (!state.opts.dryRun) state.writtenChunked++;
    } else {
      state.errors.push(`chunked ${v.group.type}/${v.group.org}/${v.group.keyParts.join(",")}: ${v.err}`);
      console.log(`❌ [MIGRATION:CHUNK:${sid}] ${v.group.type}/${v.group.org}: ${v.err}`);
    }
    if (v.skipped.length > 0) {
      const reasons = new Map<string, number>();
      for (const s of v.skipped) reasons.set(s.reason, (reasons.get(s.reason) ?? 0) + 1);
      for (const [reason, n] of reasons) {
        state.errors.push(`⚠️ chunked ${v.group.type}/${v.group.org}: ${n} ${reason}-typed value(s) un-migrated`);
      }
    }
    if (state.errors.length > 50) state.errors = state.errors.slice(-50);
  }

  state.chunkedQueueProcessed = end;

  if (state.chunkedQueueProcessed >= queue.entries.length) {
    state.phase = "done";
  }
  return true;
}

async function migrateChunkedGroup(
  state: PersistedJob,
  group: { type: string; org: string; keyParts: (string | number)[] },
  base: string, secret: string,
  skipped: Array<{ reason: string }>,
): Promise<void> {
  const { type, org, keyParts } = group;
  const pascal = type.split("-").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
  const candidates: Deno.KvKey[] = [];
  candidates.push([`__${pascal}__`, org, ...keyParts]);
  if (org === "") candidates.push([type, ...keyParts]);
  candidates.push([org, type, ...keyParts]);

  for (const groupPrefix of candidates) {
    let metaTotal: number | null = null;
    const slices: string[] = [];
    let foundAny = false;
    let cursor: string | null = null;

    while (true) {
      const page = await fetchExportPage(base, secret, groupPrefix, cursor, skipped);
      for (const e of page.entries) {
        foundAny = true;
        const last = e.key[e.key.length - 1];
        if (last === "_n" && typeof e.value === "number") {
          metaTotal = e.value;
        } else if (typeof last === "number" && typeof e.value === "string") {
          slices[last] = e.value;
        }
      }
      if (page.done) break;
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }

    if (!foundAny) continue;
    if (metaTotal === null || metaTotal <= 0) {
      throw new Error(`no _n meta found for chunked group ${JSON.stringify(groupPrefix)}`);
    }
    for (let i = 0; i < metaTotal; i++) {
      if (typeof slices[i] !== "string") {
        throw new Error(`chunk ${i}/${metaTotal} missing for ${JSON.stringify(groupPrefix)}`);
      }
    }
    const payload = JSON.parse(slices.slice(0, metaTotal).join(""));
    if (!state.opts.dryRun) {
      // Write under the BASE type so chunked + non-chunked findings live
      // in the same Firestore namespace.
      await setStoredChunked(baseType(type), org, keyParts, payload);
    }
    return;
  }
  throw new Error(`chunked group not found at any known key shape for ${type}/${org}/${keyParts.join(",")}`);
}

// ── Snapshot + Verify ────────────────────────────────────────────────────────

export interface Snapshot {
  capturedAt: number;
  versionstamp: string;
  sampleKey: string;
}

/** Walks ~5000 keys via /kv-export and finds the largest versionstamp.
 *  Single-shot HTTP request (no driver mode) — caller's request must
 *  complete in <60s. For huge DBs the sample is biased to the start of
 *  the keyspace; that's fine because we only need an approximate floor. */
export async function captureSnapshot(): Promise<Snapshot> {
  const ck = ensureProdKvConfigured();
  if (!ck.ok) throw new Error(ck.error);
  const base = prodExportBaseUrl();
  const secret = (Deno.env.get("KV_EXPORT_SECRET") ?? "").trim();
  const skipped: Array<{ reason: string }> = [];

  let maxVs = "00000000000000000000";
  let sampleKey = "";
  let scanned = 0;
  let cursor: string | null = null;

  console.log(`[MIGRATION:SNAPSHOT] starting`);
  while (scanned < 5000) {
    const page = await fetchExportPage(base, secret, [], cursor, skipped);
    for (const entry of page.entries) {
      scanned++;
      if (entry.versionstamp > maxVs) {
        maxVs = entry.versionstamp;
        sampleKey = JSON.stringify(entry.key);
      }
      if (scanned >= 5000) break;
    }
    if (page.done) break;
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  console.log(`[MIGRATION:SNAPSHOT] complete scanned=${scanned} maxVs=${maxVs}`);
  return { capturedAt: Date.now(), versionstamp: maxVs, sampleKey };
}

export interface VerifyReport {
  sampled: number;
  matched: number;
  missing: number;
  mismatched: number;
  examples: Array<{ key: string; status: "match" | "missing" | "mismatch"; note?: string }>;
}

export async function verifyMigration(sampleSize = 50): Promise<VerifyReport> {
  const ck = ensureProdKvConfigured();
  if (!ck.ok) throw new Error(ck.error);
  const base = prodExportBaseUrl();
  const secret = (Deno.env.get("KV_EXPORT_SECRET") ?? "").trim();
  const skipped: Array<{ reason: string }> = [];

  const samples: Array<{ key: Deno.KvKey; value: unknown }> = [];
  let i = 0;
  let cursor: string | null = null;
  console.log(`[MIGRATION:VERIFY] sampling sampleSize=${sampleSize}`);
  while (i < 10_000) {
    const page = await fetchExportPage(base, secret, [], cursor, skipped);
    for (const entry of page.entries) {
      i++;
      if (samples.length < sampleSize) {
        samples.push({ key: entry.key, value: entry.value });
      } else {
        const j = Math.floor(Math.random() * i);
        if (j < sampleSize) samples[j] = { key: entry.key, value: entry.value };
      }
      if (i >= 10_000) break;
    }
    if (page.done) break;
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }

  const examples: VerifyReport["examples"] = [];
  let matched = 0, missing = 0, mismatched = 0;
  for (const s of samples) {
    const decoded = decodeKey(s.key);
    if (!decoded || decoded.isChunkPart || decoded.isChunkMeta) continue;
    if (SKIP_TYPES.has(decoded.type)) continue;
    const got = await getStored(decoded.type, decoded.org, ...decoded.keyParts);
    const keyStr = `${decoded.type}/${decoded.org}/${decoded.keyParts.join(",")}`;
    if (got === null) {
      missing++;
      if (examples.length < 20) examples.push({ key: keyStr, status: "missing" });
    } else if (JSON.stringify(got) === JSON.stringify(s.value)) {
      matched++;
    } else {
      mismatched++;
      if (examples.length < 20) examples.push({ key: keyStr, status: "mismatch", note: "value differs" });
    }
  }
  console.log(`[MIGRATION:VERIFY] complete sampled=${samples.length} matched=${matched} missing=${missing} mismatched=${mismatched}`);
  return { sampled: samples.length, matched, missing, mismatched, examples };
}
