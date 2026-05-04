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

import { setStored, setStoredChunked, getStored, getStoredChunked, listStored, listStoredWithKeys } from "@core/data/firestore/mod.ts";

// ── Constants ────────────────────────────────────────────────────────────────

/** Firestore "type" namespace for persisted job state. */
const JOB_TYPE = "migration-job";
/** Firestore "type" namespace for the chunked-group reassembly queue. */
const QUEUE_TYPE = "migration-chunked-queue";
/** Max wall-clock seconds spent inside one tick. Must stay well under
 *  Deno Deploy's 60s request timeout so the response always returns. */
/** Per-tick wall-clock budget. Was 30s but Deno Deploy isolates were OOMing
 *  on long ticks — too many KV-export pages allocated and held before GC.
 *  10s caps allocations at ~10 pages worth, well under the memory limit. */
const TICK_BUDGET_MS = 10_000;
/** A job whose lastTickAt is older than this is auto-marked errored to
 *  prevent zombie-polling. */
/** Threshold for marking a job as stale (zombie). Was 15 min but Deno
 *  Deploy's cron scheduler turned out to be unreliable — operators end up
 *  driving via the manual Tick Now button with arbitrary gaps. 24h means
 *  the watchdog only fires for genuinely abandoned jobs, not ones being
 *  babysat manually. Resume + Cancel give the operator manual control. */
const STALE_TICK_MS = 24 * 60 * 60_000;
/** /kv-export pagination batch size for value-bearing requests.
 *  Deno KV's `kv.list({ limit })` is hard-capped at 1000 by the runtime,
 *  but we use 300 here to keep peak memory below the 512MB isolate limit
 *  on heavy values (token-usage 27K records, audit-job 10K, etc). */
const EXPORT_BATCH_LIMIT_FULL = 300;
/** /kv-export pagination batch size for keysOnly requests. Responses are
 *  tiny (just keys + versionstamps), so we use Deno KV's runtime max for
 *  ~3.3x fewer round-trips on chunked-only prefixes. */
const EXPORT_BATCH_LIMIT_KEYS_ONLY = 1000;
/** Max chunked-group reassemblies to fire in parallel within one tick.
 *  Each pulls a full chunked group's worth of value data (transcripts
 *  can be ~1MB each). 20 × 1MB = 20MB peak memory — comfortable under
 *  512MB. Bumped from 5 because per-group network latency was the
 *  reassembly bottleneck. Now mostly superseded by BATCH_LIST_*. */
const CHUNKED_PARALLEL = 20;
/** Initial batch size for /admin/kv-batch-list during chunked phase.
 *  Prod hard-caps at 100 prefixes/request; we start at 50 to leave
 *  headroom for the response's 100MB budget on transcript-heavy
 *  batches. Adaptively halved when prod returns `partial: true`. */
const BATCH_LIST_INITIAL = 50;
/** Floor for the adaptive batch size — never go below this even after
 *  repeated partial responses. */
const BATCH_LIST_MIN = 4;
/** Max prefix walks fired in parallel within one tick. With keysOnly on
 *  heavy chunked-only prefixes, the dominant memory pressure is gone, so
 *  we push parallelism up. The remaining full-value prefixes are smaller
 *  org-keyed types where 300 entries × 8 parallel = ~12MB peak. */
const PARALLEL_PREFIX_WALKS = 8;
/** Sentinel stored in `state.cursors[idx]` for prefixes that have been
 *  assigned to a parallel slot but haven't yielded a real cursor yet
 *  (either: not yet fetched, or the first fetch errored). Distinct from
 *  "real cursor" and from "not in cursors at all = done". */
const FRESH_CURSOR = "__FRESH__";
/** Chunk-N variants to probe per (org, type) when prefix-narrowing.
 *  Variants beyond this are missed; we widen if needed. */
const CHUNK_VARIANT_PROBE_MAX = 10;

// ── Type classification ──────────────────────────────────────────────────────

export const GLOBAL_TYPES = new Set([
  "org", "org-by-slug", "email-index", "session", "default-org",
  "audit-finding", "audit-transcript",
  // token-usage intentionally excluded — opted out of migration for speed.
]);

/** TypedStore prefixes that hold chunked values exclusively. During scan
 *  the consumer only needs keys (to enqueue group hashes) — values are
 *  never used because reassembly fetches them later from the group's own
 *  prefix. We pass `keysOnly: true` to /admin/kv-export for these to skip
 *  ~95% of bandwidth and prevent isolate-OOM on transcript walks.
 *  Verified by prior runs showing 0 simple entries under these prefixes. */
export const CHUNKED_ONLY_TYPED_STORE_PREFIXES: ReadonlySet<string> = new Set([
  "__audit-finding__",
  "__audit-transcript__",
  "__batch-answers__",
  "__populated-questions__",
  "__destination-questions__",
]);

/** TypedStore prefixes used by prod's lib/storage. Keys are
 *  [__type__, orgId, ...]. Walking [orgId] does NOT cover these — prod
 *  stores findings/transcripts/etc under TypedStore prefixes (lowercase
 *  kebab), not orgKey prefixes. List sourced from
 *  main:lib/storage/dtos/{audit,stats,config,email,gamification}.ts.
 *  Add new entries here when prod adds new DTOs. */
export const KNOWN_TYPED_STORE_PREFIXES: ReadonlyArray<string> = [
  // audit DTOs
  "__audit-finding__", "__audit-transcript__", "__audit-job__",
  "__question-cache__", "__destination-questions__", "__batch-counter__",
  "__populated-questions__", "__batch-answers__",
  // stats DTOs
  "__active-tracking__", "__watchdog-active__", "__completed-audit-stat__",
  "__error-tracking__", "__retry-tracking__",
  "__chargeback-entry__", "__wire-deduction-entry__",
  // config DTOs
  "__pipeline-config__", "__webhook-config-dto__", "__bad-word-config__",
  "__reviewer-config__", "__office-bypass-config__",
  "__manager-scope-config__", "__audit-dimensions-config__",
  "__partner-dimensions-config__", "__bonus-points-config__",
  // email DTOs
  "__email-report-config__", "__email-template__",
  // game/store DTOs
  "__gamification-settings-dto__", "__sound-pack-meta__",
  "__custom-store-item__", "__earned-badge-dto__",
  "__badge-stats-dto__", "__game-state-dto__",
];

export const SKIP_TYPES = new Set([
  "session",
  "review-pending", "review-decided", "review-audit-pending",
  // Opted out of migration — high-volume LLM token counters not worth
  // the migration cost relative to their value.
  "token-usage",
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

/** Strip `-chunk-N` suffix so `audit-finding-chunk-0` matches user filter
 *  `audit-finding`. Without this, chunked types are silently dropped from
 *  type-filtered runs. */
const CHUNK_SUFFIX_RE = /-chunk-\d+$/;
export function baseType(decodedType: string): string {
  return decodedType.replace(CHUNK_SUFFIX_RE, "");
}

function classifyChunk(type: string, org: string, rest: (string | number)[]): DecodedKey {
  const last = rest[rest.length - 1];
  if (last === "_n") {
    return { type, org, keyParts: rest.slice(0, -1), isChunkPart: false, isChunkMeta: true };
  }
  // Treat numeric-tailed entries as chunk parts. False positives (per-list-
  // item indexed records like judge-decided/review-active that have qIdx as
  // a numeric tail) are caught by the fallback path in migrateChunkedGroup,
  // which writes each entry individually when no _n meta exists.
  if (rest.length >= 2 && typeof last === "number") {
    return { type, org, keyParts: rest.slice(0, -1), isChunkPart: true, isChunkMeta: false };
  }
  return { type, org, keyParts: rest, isChunkPart: false, isChunkMeta: false };
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
 *  passed-in array so the caller can record them on the job state.
 *  When `keysOnly: true`, response entries omit the `value` field —
 *  caller must handle `entry.value === undefined`. Useful for chunked-
 *  only TypedStore prefixes during scan (95%+ bandwidth savings).
 *  When `since`/`until` are set, prod applies a server-side date filter
 *  on date-filterable types (audit-finding/appeal/etc per
 *  TIMESTAMPED_FIELDS) so out-of-range entries never cross the wire.
 *  Chunk parts always pass through regardless of date — the consumer
 *  reassembly handles the date check on the full reconstructed value. */
async function fetchExportPage(
  base: string, secret: string, prefix: Deno.KvKey, cursor: string | null,
  skipped: Array<{ reason: string }>,
  opts: { keysOnly?: boolean; since?: number; until?: number } = {},
): Promise<{ entries: Array<{ key: Deno.KvKey; value: unknown; versionstamp: string }>; nextCursor: string | null; done: boolean }> {
  const limit = opts.keysOnly ? EXPORT_BATCH_LIMIT_KEYS_ONLY : EXPORT_BATCH_LIMIT_FULL;
  const body: Record<string, unknown> = { prefix, limit };
  if (cursor) body.cursor = cursor;
  if (opts.keysOnly) body.keysOnly = true;
  if (opts.since !== undefined) body.since = opts.since;
  if (opts.until !== undefined) body.until = opts.until;
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

interface BatchListGroup {
  prefix: Deno.KvKey;
  entries: Array<{ key: Deno.KvKey; value: unknown; versionstamp: string }>;
  truncated: boolean;
}

interface BatchListResponse {
  ok: boolean;
  groups: Array<{
    prefix: Deno.KvKey;
    entries: Array<{ key: Deno.KvKey; value: unknown; versionstamp: string }>;
    truncated: boolean;
  }>;
  partial?: boolean;
  error?: string;
}

/** POST /admin/kv-batch-list: fetch up to 100 group prefixes in one
 *  request, prod walks each to completion (or perPrefixLimit) and
 *  returns entries grouped by prefix in the same order. Used by chunked
 *  reassembly to amortize per-request latency across many groups.
 *  Caller MUST check `partial` flag — when true, trailing groups with
 *  empty `entries[]` are placeholders (budget cutoff), not real empties. */
async function fetchBatchList(
  base: string, secret: string, prefixes: Array<Deno.KvKey>,
  skipped: Array<{ reason: string }>,
  perPrefixLimit?: number,
): Promise<{ groups: BatchListGroup[]; partial: boolean }> {
  const body: Record<string, unknown> = { prefixes };
  if (perPrefixLimit !== undefined) body.perPrefixLimit = perPrefixLimit;
  const res = await fetch(`${base}/admin/kv-batch-list`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`kv-batch-list HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json() as BatchListResponse;
  if (!data.ok) throw new Error(`kv-batch-list error: ${data.error ?? "unknown"}`);
  const groups: BatchListGroup[] = data.groups.map((g) => ({
    prefix: g.prefix,
    entries: g.entries.map((e) => ({
      key: e.key,
      value: decodeValue(e.value, skipped),
      versionstamp: e.versionstamp,
    })),
    truncated: g.truncated,
  }));
  return { groups, partial: !!data.partial };
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
export type JobPhase =
  | "init" | "scanning" | "index-walk" | "chunked" | "writing" | "done"
  // verify-repair phases:
  | "prod-count" | "fs-count" | "diff" | "sample" | "repair";

/** Per-bucket state for verify-repair runs. A "bucket" = one (org, type)
 *  pair. Lives inside PersistedJob.verifyBuckets so all state survives
 *  isolate restarts and re-runs skip already-verified buckets. */
export type VerifyBucketStatus =
  | "pending" | "counted" | "sampling" | "sampled"
  | "verified" | "mismatched" | "repairing" | "repaired" | "error";

export interface VerifyBucket {
  type: string;
  org: string;
  prodCount: number;
  fsCount: number;
  isChunked: boolean;          // chunked groups counted (chunk parts merged)
  status: VerifyBucketStatus;
  sampled: number;             // sample-verify: how many sampled so far
  matchedSamples: number;      // sample-verify: how many matched
  repairCursor?: string;       // repair phase: paginated cursor inside this bucket
  repairedCount: number;       // repair phase: how many writes happened
  matchedCount: number;        // repair phase: how many already-matched (skipped writes)
  mismatchExamples: string[];  // capped at 10 — first few keys that didn't match
  errors: string[];            // capped at 5
}

export interface RunOpts {
  types?: string[];
  since?: number;
  until?: number;
  dryRun?: boolean;
  sinceVersionstamp?: string;
  /** Migration strategy.
   *  - "scan" (default): walks every prefix in the keyspace.
   *  - "index-driven": walks audit-done-idx with date filter, queues
   *    finding+transcript+audit-job per indexed findingId. Skips full
   *    TypedStore walk. ~100x faster for date-bounded runs.
   *  - "verify-repair": walks every prod key, compares to Firestore,
   *    writes any missing/different values. Bit-identical guarantee
   *    when run reports repaired=0 + errors=[] on a re-run. */
  mode?: "scan" | "index-driven" | "verify-repair";
  /** verify-repair only: also do per-entry compare on count-matched
   *  buckets (default skips them and only samples). Stretches runtime
   *  to 1-3h but provides absolute coverage for cutover paranoia. */
  deepCompare?: boolean;
}

export interface PersistedJob {
  jobId: string;
  startedAt: number;
  endedAt: number | null;
  status: JobStatus;
  cancelled: boolean;
  phase: JobPhase;
  /** Cursors for in-progress prefix walks, keyed by prefix idx (as string).
   *  `FRESH_CURSOR` sentinel = assigned but no real cursor yet. Absent =
   *  prefix is done OR not yet started. Replaces the single `cursor` field
   *  to support parallel prefix walks. */
  cursors: Record<string, string>;
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
  /** index-driven mode: cursors for audit-done-idx walks, keyed by orgId.
   *  FRESH_CURSOR sentinel means started but no real cursor yet.
   *  Absent means walk for that org is done. */
  indexCursors?: Record<string, string>;
  /** Adaptive batch size for /admin/kv-batch-list during chunked phase.
   *  Halved when prod returns partial:true; reset to BATCH_LIST_INITIAL
   *  on job start. Persisted across ticks so back-off survives restarts. */
  batchListSize?: number;
  /** Server-side migration proxy: if set, this job is delegated to prod's
   *  /admin/kv-migrate-day endpoint. tickJob just polls prod and mirrors
   *  state back. createJob attempts the proxy when mode=index-driven and
   *  falls back to local index-walk if prod's endpoint is unavailable. */
  prodJobId?: string;
  /** verify-repair only — paginated cursor for prod-count phase 1 walk. */
  prodScanCursor?: string;
  /** verify-repair only — pages walked so far in phase 1 (UI display). */
  prodScanPageNum?: number;
  /** verify-repair only — bucket map keyed by `${type}/${org}`. Single
   *  source of truth for the per-bucket grid + resumability. */
  verifyBuckets?: Record<string, VerifyBucket>;
  /** verify-repair only — index into the deterministic bucket key list,
   *  used by sequential phases (fs-count, sample, repair) to resume. */
  verifyBucketIdx?: number;
  /** verify-repair only — total matched + repaired entry counters. */
  verifyMatched?: number;
  verifyRepaired?: number;
  /** Rolling activity log — last 200 lines, FIFO. Lets the operator see
   *  what's happening RIGHT NOW inside the job (per-page, per-bucket,
   *  per-write). Each tick appends multiple lines; oldest drop. */
  logTail?: string[];
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
    cursors: {},
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
    indexCursors: {},
    logTail: [],
  };

  // Index-driven mode: delegate to prod's /admin/kv-migrate-day for
  // server-side migration (eliminates the cross-isolate bandwidth bottleneck
  // that capped local index-driven runs at ~27min/day). Falls back to local
  // index-walk if prod's endpoint is unavailable (e.g. not yet deployed).
  if (opts.mode === "index-driven") {
    try {
      const base = prodExportBaseUrl();
      const secret = (Deno.env.get("KV_EXPORT_SECRET") ?? "").trim();
      const res = await fetch(`${base}/admin/kv-migrate-day`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          since: opts.since,
          until: opts.until,
          dryRun: opts.dryRun,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      const data = await res.json() as { ok: boolean; jobId?: string; error?: string };
      if (!data.ok || !data.jobId) {
        throw new Error(`prod error: ${data.error ?? "unknown"}`);
      }
      state.prodJobId = data.jobId;
      state.message = `proxying to prod jobId=${data.jobId}`;
      console.log(`🚀 [MIGRATION:CREATE:${sid}] proxying index-driven to prod jobId=${data.jobId}`);
    } catch (err) {
      console.log(`⚠️ [MIGRATION:CREATE:${sid}] prod proxy unavailable, falling back to local index-walk: ${err}`);
      state.message = `proxy unavailable, running locally — ${String(err).slice(0, 100)}`;
    }
  }

  // Verify-repair mode: initialise verify-specific state. Phase advances
  // happen inside tickVerifyRepair; createJob just sets the entry point.
  if (opts.mode === "verify-repair") {
    state.phase = "prod-count";
    state.prodScanCursor = undefined;
    state.prodScanPageNum = 0;
    state.verifyBuckets = {};
    state.verifyBucketIdx = 0;
    state.verifyMatched = 0;
    state.verifyRepaired = 0;
    state.message = "verify-repair queued — first tick will start prod-count";
  }

  await saveJob(state);
  await saveQueue({ jobId, entries: [] });
  console.log(`🚀 [MIGRATION:CREATE:${sid}] mode=${opts.mode ?? "scan"} types=${opts.types?.join(",") ?? "(all)"} since=${opts.since ?? "-"} until=${opts.until ?? "-"} dryRun=${!!opts.dryRun} sinceVS=${opts.sinceVersionstamp ?? "-"}`);
  return jobId;
}

async function propagateCancelToProd(prodJobId: string, sid: string): Promise<void> {
  try {
    const base = prodExportBaseUrl();
    const secret = (Deno.env.get("KV_EXPORT_SECRET") ?? "").trim();
    await fetch(`${base}/admin/kv-migrate-cancel`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: prodJobId }),
    });
    console.log(`🛑 [MIGRATION:PROXY-CANCEL:${sid}] forwarded to prod jobId=${prodJobId}`);
  } catch (err) {
    console.log(`⚠️ [MIGRATION:PROXY-CANCEL:${sid}] failed: ${err}`);
  }
}

export async function cancelJob(jobId: string): Promise<boolean> {
  const state = await loadJob(jobId);
  if (!state) return false;
  if (state.status !== "running") return false;
  if (state.prodJobId) await propagateCancelToProd(state.prodJobId, jobId.slice(-6));
  state.cancelled = true;
  state.message = "cancellation requested — will halt at next tick boundary";
  await saveJob(state);
  console.log(`🛑 [MIGRATION:CANCEL:${jobId.slice(-6)}] flag set${state.prodJobId ? " (+ prod cancel)" : ""}`);
  return true;
}

export async function forceCancelJob(jobId: string): Promise<boolean> {
  const state = await loadJob(jobId);
  if (!state) return false;
  if (state.status !== "running") return false;
  if (state.prodJobId) await propagateCancelToProd(state.prodJobId, jobId.slice(-6));
  state.status = "cancelled";
  state.cancelled = true;
  state.endedAt = Date.now();
  state.message = `force-cancelled at scanned=${state.scanned}`;
  await saveJob(state);
  console.log(`⛔ [MIGRATION:FORCE-CANCEL:${jobId.slice(-6)}] terminated immediately scanned=${state.scanned}${state.prodJobId ? " (+ prod cancel)" : ""}`);
  return true;
}

/** Manually advance a verify-repair job to the next phase. Used when
 *  prod-count is wedged — bucket discovery is already done (counts visible
 *  in UI) but state.phase didn't persist its advance to "fs-count" due to
 *  earlier race or OOM. fs-count is small + memory-light; once we're there,
 *  the rest of the pipeline can run cleanly. */
export async function skipToPhase(jobId: string, target: JobPhase): Promise<boolean> {
  const state = await loadJob(jobId);
  if (!state) return false;
  if (state.opts.mode !== "verify-repair") return false;
  const before = state.phase;
  state.phase = target;
  state.verifyBucketIdx = 0;
  state.lastTickAt = Date.now();
  state.message = `manually advanced ${before} → ${target}`;
  appendLog(state, `[skip-phase] ${before} → ${target} (manual override)`);
  await saveJob(state);
  console.log(`⏭  [MIGRATION:SKIP-PHASE:${jobId.slice(-6)}] ${before} → ${target}`);
  return true;
}

/** Re-arm an errored job so the cron driver picks it back up. Used when
 *  the stale watchdog fired incorrectly (cron lull, isolate cycling, etc.).
 *  Cursor + verifyBuckets are intact so work resumes without duplication. */
export async function resumeJob(jobId: string): Promise<boolean> {
  const state = await loadJob(jobId);
  if (!state) return false;
  if (state.status !== "error") return false;
  state.status = "running";
  state.endedAt = null;
  state.cancelled = false;
  state.lastTickAt = Date.now();
  state.message = `resumed at ${state.phase}`;
  appendLog(state, `[resume] flipped error → running, cursor preserved (cron will tick within 1 min)`);
  await saveJob(state);
  console.log(`▶️  [MIGRATION:RESUME:${jobId.slice(-6)}] error → running phase=${state.phase}`);
  return true;
}

export async function killAllRunningJobs(): Promise<number> {
  const all = await listJobs();
  let killed = 0;
  for (const j of all) {
    if (j.status === "running") {
      if (j.prodJobId) await propagateCancelToProd(j.prodJobId, j.jobId.slice(-6));
      j.status = "cancelled";
      j.cancelled = true;
      j.endedAt = Date.now();
      j.message = "killed by Kill All";
      await saveJob(j);
      killed++;
      console.log(`⛔ [MIGRATION:KILL-ALL:${j.jobId.slice(-6)}] terminated${j.prodJobId ? " (+ prod cancel)" : ""}`);
    }
  }
  console.log(`⛔ [MIGRATION:KILL-ALL] killed=${killed}`);
  return killed;
}

// ── Proxy tick (delegates to prod's server-side migration) ──────────────────

interface ProxyJobShape {
  jobId?: string;
  startedAt?: number;
  endedAt?: number | null;
  status?: JobStatus;
  phase?: JobPhase;
  scanned?: number;
  written?: number;
  writtenChunked?: number;
  skipped?: number;
  errors?: string[];
  message?: string;
  byType?: Record<string, { count: number; chunkedCount: number }>;
  opts?: RunOpts;
  elapsedMs?: number;
}

/** Polls prod's /admin/kv-migrate-status, mirrors its state into ours,
 *  saves and returns. Doesn't do any local work — prod owns the job. */
async function tickProxiedJob(state: PersistedJob, sid: string): Promise<PersistedJob> {
  const base = prodExportBaseUrl();
  const secret = (Deno.env.get("KV_EXPORT_SECRET") ?? "").trim();
  try {
    const res = await fetch(
      `${base}/admin/kv-migrate-status?jobId=${encodeURIComponent(state.prodJobId!)}`,
      { headers: { "Authorization": `Bearer ${secret}` } },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      state.errors.push(`prod status HTTP ${res.status}: ${text.slice(0, 160)}`);
      if (state.errors.length > 50) state.errors = state.errors.slice(-50);
      state.lastTickAt = Date.now();
      await saveJob(state);
      return state;
    }
    const data = await res.json() as { ok: boolean; job?: ProxyJobShape; error?: string };
    if (!data.ok || !data.job) {
      state.errors.push(`prod status error: ${data.error ?? "unknown"}`);
      if (state.errors.length > 50) state.errors = state.errors.slice(-50);
      state.lastTickAt = Date.now();
      await saveJob(state);
      return state;
    }
    const pj = data.job;
    if (pj.status) state.status = pj.status;
    if (pj.phase) state.phase = pj.phase;
    if (typeof pj.scanned === "number") state.scanned = pj.scanned;
    if (typeof pj.written === "number") state.written = pj.written;
    if (typeof pj.writtenChunked === "number") state.writtenChunked = pj.writtenChunked;
    if (typeof pj.skipped === "number") state.skipped = pj.skipped;
    if (Array.isArray(pj.errors)) state.errors = pj.errors;
    if (pj.message) state.message = pj.message;
    if (pj.byType) state.byType = pj.byType;
    if (pj.endedAt) state.endedAt = pj.endedAt;
    state.lastTickAt = Date.now();
    await saveJob(state);
    console.log(`🔁 [MIGRATION:PROXY:${sid}] status=${state.status} phase=${state.phase} scanned=${state.scanned} written=${state.written}`);
  } catch (err) {
    state.errors.push(`proxy fetch failed: ${String(err).slice(0, 200)}`);
    if (state.errors.length > 50) state.errors = state.errors.slice(-50);
    state.lastTickAt = Date.now();
    await saveJob(state);
    console.log(`❌ [MIGRATION:PROXY:${sid}] fetch failed: ${err}`);
  }
  return state;
}

// ── Verify-and-Repair: 6-phase bit-identical guarantee ──────────────────────
//
// Goal: prove every prod KV value is mirrored at the right Firestore path
// (or repair it inline if not). When a re-run reports verifyRepaired=0
// + errors=[], the migration is bit-identical to prod and cutover-safe.
//
// Phases (state.phase advances through these in order):
//   prod-count → fs-count → diff → sample → repair → done
//
// Resumability: every phase persists its cursor + per-bucket progress to
// state.verifyBuckets after each step. Killed mid-walk → next tick picks
// up at exact cursor + bucket index. Re-run on already-verified data
// short-circuits Phase 4-5 for any bucket already at "verified" status.

const VERIFY_SAMPLE_PER_BUCKET = 50;
const VERIFY_REPAIR_PARALLEL = 8;
const VERIFY_PROD_PAGE_LIMIT = 1000;

async function tickVerifyRepair(state: PersistedJob, sid: string): Promise<PersistedJob> {
  const tickStart = Date.now();
  const base = prodExportBaseUrl();
  const secret = (Deno.env.get("KV_EXPORT_SECRET") ?? "").trim();
  let progressed = false;
  let lastCancelCheckAt = tickStart;

  // Make sure verify-repair fields are initialised (defensive — createJob
  // already does this but cheap to re-check).
  state.verifyBuckets ??= {};
  state.verifyBucketIdx ??= 0;
  state.verifyMatched ??= 0;
  state.verifyRepaired ??= 0;
  state.prodScanPageNum ??= 0;

  try {
    while (Date.now() - tickStart < TICK_BUDGET_MS) {
      if (Date.now() - lastCancelCheckAt > 5000) {
        const fresh = await loadJob(state.jobId);
        if (fresh?.cancelled) { state.cancelled = true; break; }
        lastCancelCheckAt = Date.now();
      }

      if (state.phase === "prod-count") {
        progressed = await walkProdCount(state, base, secret) || progressed;
      } else if (state.phase === "fs-count") {
        progressed = await walkFsCount(state) || progressed;
      } else if (state.phase === "diff") {
        computeVerifyDiff(state);
        state.phase = "sample";
        state.verifyBucketIdx = 0;
        progressed = true;
      } else if (state.phase === "sample") {
        progressed = await walkSample(state, base, secret) || progressed;
      } else if (state.phase === "repair") {
        progressed = await walkRepair(state, base, secret) || progressed;
      } else if (state.phase === "done") {
        break;
      } else {
        // Unknown phase for verify-repair — recover by going to prod-count
        state.phase = "prod-count";
        progressed = true;
      }

      if (!progressed) break;
      progressed = false;
    }
  } catch (err) {
    const msg = `verify tick error: ${String(err).slice(0, 200)}`;
    state.errors.push(msg);
    if (state.errors.length > 50) state.errors = state.errors.slice(-50);
    appendLog(state, `[error] ${msg}`);
    console.log(`❌ [MIGRATION:VERIFY:${sid}] ${msg}`);
  }

  state.lastTickAt = Date.now();

  if (state.cancelled && state.status === "running") {
    state.status = "cancelled";
    state.endedAt = Date.now();
    state.message = `cancelled at ${state.phase}`;
  } else if (state.phase === "done" && state.status === "running") {
    state.status = "done";
    state.endedAt = Date.now();
    const buckets = Object.values(state.verifyBuckets ?? {});
    const verified = buckets.filter((b) => b.status === "verified" || b.status === "repaired").length;
    state.message = `verify complete — ${verified}/${buckets.length} buckets · ${state.verifyMatched} matched · ${state.verifyRepaired} repaired`;
    console.log(`✅ [MIGRATION:VERIFY:${sid}] DONE buckets=${buckets.length} matched=${state.verifyMatched} repaired=${state.verifyRepaired} errors=${state.errors.length}`);
  } else {
    const elapsed = Date.now() - tickStart;
    const buckets = Object.values(state.verifyBuckets ?? {});
    const inFlight = buckets.filter((b) => b.status === "sampling" || b.status === "repairing").length;
    const done = buckets.filter((b) => b.status === "verified" || b.status === "repaired").length;
    state.message = `${state.phase}: ${done}/${buckets.length} buckets · matched=${state.verifyMatched} repaired=${state.verifyRepaired}${inFlight > 0 ? ` · ${inFlight} in-flight` : ""}`;
    console.log(`📝 [MIGRATION:VERIFY:${sid}] phase=${state.phase} buckets=${buckets.length} done=${done} matched=${state.verifyMatched} repaired=${state.verifyRepaired} tickMs=${elapsed}`);
  }

  await saveJob(state);
  return state;
}

/** Phase 1 — paginated walk of every prod KV key in keysOnly mode.
 *  Group counts by `${type}/${org}` bucket. Each page persists the
 *  cursor + accumulated counts, so kill-resume restarts at the exact
 *  page (no duplicate KV reads). */
async function walkProdCount(state: PersistedJob, base: string, secret: string): Promise<boolean> {
  const skipped: Array<{ reason: string }> = [];
  const page = await fetchExportPage(base, secret, [], state.prodScanCursor ?? null, skipped, { keysOnly: true });
  let added = 0;
  for (const e of page.entries) {
    const decoded = decodeKey(e.key);
    if (!decoded) continue;
    if (SKIP_TYPES.has(decoded.type)) continue;
    const bucketKey = `${decoded.type}/${decoded.org}`;
    let bucket = state.verifyBuckets![bucketKey];
    if (!bucket) {
      bucket = state.verifyBuckets![bucketKey] = {
        type: decoded.type, org: decoded.org,
        prodCount: 0, fsCount: 0, isChunked: false,
        status: "pending",
        sampled: 0, matchedSamples: 0,
        repairedCount: 0, matchedCount: 0,
        mismatchExamples: [], errors: [],
      };
    }
    if (decoded.isChunkPart) {
      bucket.isChunked = true;
      // Don't count chunk parts — count chunked GROUPS via _n meta only
      continue;
    }
    if (decoded.isChunkMeta) {
      bucket.isChunked = true;
      bucket.prodCount++;
      added++;
      continue;
    }
    bucket.prodCount++;
    added++;
  }
  state.scanned += page.entries.length;
  state.prodScanPageNum = (state.prodScanPageNum ?? 0) + 1;
  state.prodScanCursor = page.nextCursor ?? undefined;
  const totalBuckets = Object.keys(state.verifyBuckets!).length;
  state.message = `prod-count: ${state.prodScanPageNum} pages · ${state.scanned} keys scanned · ${totalBuckets} buckets`;
  appendLog(state, `[prod-count] page ${state.prodScanPageNum}: +${page.entries.length} keys (total ${state.scanned}), ${totalBuckets} buckets discovered`);
  if (page.done) {
    state.phase = "fs-count";
    state.verifyBucketIdx = 0;
    state.message = `prod-count complete: ${totalBuckets} buckets, ${state.scanned} keys`;
    appendLog(state, `[prod-count] DONE — ${totalBuckets} buckets, ${state.scanned} keys total → starting fs-count`);
    return true;
  }
  return added > 0 || page.entries.length > 0;
}

/** Phase 2 — for each bucket, count Firestore docs via the _type index.
 *  Sequential bucket-by-bucket; persists state.verifyBucketIdx after each
 *  one so kill-resume skips already-counted buckets. */
async function walkFsCount(state: PersistedJob): Promise<boolean> {
  const bucketKeys = Object.keys(state.verifyBuckets!).sort();
  if ((state.verifyBucketIdx ?? 0) >= bucketKeys.length) {
    state.phase = "diff";
    state.verifyBucketIdx = 0;
    state.message = `fs-count complete · ${bucketKeys.length} buckets counted`;
    return true;
  }
  const idx = state.verifyBucketIdx ?? 0;
  const bk = bucketKeys[idx];
  const bucket = state.verifyBuckets![bk];
  try {
    // Use a high limit; typical bucket is well under 100K. listStoredWithKeys
    // returns array of {key, value}; we just need the count.
    const rows = await listStoredWithKeys(bucket.type, bucket.org, { limit: 100_000 });
    bucket.fsCount = rows.length;
    bucket.status = "counted";
    appendLog(state, `[fs-count] ${bk}: prod=${bucket.prodCount} fs=${bucket.fsCount}${bucket.fsCount === bucket.prodCount ? " ✓" : " ⚠ drift"}`);
  } catch (err) {
    bucket.errors.push(`fs-count: ${String(err).slice(0, 100)}`);
    bucket.status = "error";
    appendLog(state, `[fs-count] ${bk}: ERROR ${String(err).slice(0, 80)}`);
  }
  state.verifyBucketIdx = idx + 1;
  state.message = `fs-count: ${idx + 1}/${bucketKeys.length} buckets`;
  return true;
}

/** Phase 3 — pure in-memory diff. Classify each bucket: match (counts equal),
 *  mismatch (fs short), missing-fs (fs is 0), extra-fs (fs has more). */
function computeVerifyDiff(state: PersistedJob): void {
  let mismatches = 0;
  let matches = 0;
  for (const [bk, bucket] of Object.entries(state.verifyBuckets!)) {
    if (bucket.status === "error") continue;
    if (bucket.fsCount === 0 && bucket.prodCount > 0) {
      bucket.status = "mismatched";
      bucket.mismatchExamples.push(`(empty in firestore, ${bucket.prodCount} on prod)`);
      appendLog(state, `[diff] ${bk}: prod=${bucket.prodCount} fs=0 → MISSING-FS, queued for repair`);
      mismatches++;
    } else if (bucket.fsCount < bucket.prodCount) {
      bucket.status = "mismatched";
      bucket.mismatchExamples.push(`(fs=${bucket.fsCount} < prod=${bucket.prodCount})`);
      appendLog(state, `[diff] ${bk}: prod=${bucket.prodCount} fs=${bucket.fsCount} → MISMATCHED (-${bucket.prodCount - bucket.fsCount}), queued for repair`);
      mismatches++;
    } else {
      // counts equal OR fs has more (extra-fs is logged as note but not a repair-need)
      bucket.status = state.opts.deepCompare ? "mismatched" : "counted";
      if (bucket.fsCount > bucket.prodCount) {
        bucket.errors.push(`extra in fs: ${bucket.fsCount - bucket.prodCount} more rows than prod`);
        appendLog(state, `[diff] ${bk}: prod=${bucket.prodCount} fs=${bucket.fsCount} → extra-fs (+${bucket.fsCount - bucket.prodCount}), no repair needed`);
      }
      if (state.opts.deepCompare) mismatches++; else matches++;
    }
  }
  state.message = `diff complete · ${mismatches} buckets need repair`;
  appendLog(state, `[diff] DONE — ${matches} count-matched, ${mismatches} need repair → starting sample`);
}

/** Phase 4 — random sample N entries per count-matched bucket, value-compare
 *  against Firestore. If any sample fails, reclassify bucket as mismatched
 *  for full per-entry repair in Phase 5. */
async function walkSample(state: PersistedJob, base: string, secret: string): Promise<boolean> {
  const bucketKeys = Object.keys(state.verifyBuckets!).sort();
  // Find next bucket needing sampling: status === "counted"
  while ((state.verifyBucketIdx ?? 0) < bucketKeys.length) {
    const idx = state.verifyBucketIdx ?? 0;
    const bk = bucketKeys[idx];
    const bucket = state.verifyBuckets![bk];
    if (bucket.status === "counted") {
      bucket.status = "sampling";
      appendLog(state, `[sample] ${bk}: sampling up to ${VERIFY_SAMPLE_PER_BUCKET} entries…`);
      const ok = await sampleBucket(bucket, base, secret);
      bucket.status = ok ? "verified" : "mismatched";
      appendLog(state, `[sample] ${bk}: ${bucket.matchedSamples}/${bucket.sampled} matched ${ok ? "✓ verified" : "✗ → queued for repair"}`);
      state.verifyBucketIdx = idx + 1;
      state.message = `sample: ${idx + 1}/${bucketKeys.length} buckets`;
      return true;
    }
    state.verifyBucketIdx = idx + 1;
  }
  state.phase = "repair";
  state.verifyBucketIdx = 0;
  const toRepair = Object.values(state.verifyBuckets!).filter((b) => b.status === "mismatched").length;
  state.message = `sample complete · ${toRepair} buckets to repair`;
  appendLog(state, `[sample] DONE — ${toRepair} buckets need full repair → starting repair phase`);
  return true;
}

async function sampleBucket(bucket: VerifyBucket, base: string, secret: string): Promise<boolean> {
  const skipped: Array<{ reason: string }> = [];
  const wantedSamples = VERIFY_SAMPLE_PER_BUCKET;
  // Walk this bucket's prefix, collect first N value-bearing entries (NOT keysOnly).
  // Random sampling would require knowing the total — for simplicity, take the
  // first N entries returned by /admin/kv-export. That's deterministic but spread
  // across the bucket since KV iteration is by key order, not random.
  let cursor: string | null = null;
  const prefix = buildPrefixForBucket(bucket);
  for (let pages = 0; pages < 4; pages++) {  // cap at 4 pages of 300 = 1200 candidates
    const page = await fetchExportPage(base, secret, prefix, cursor, skipped, {});
    for (const e of page.entries) {
      if (bucket.sampled >= wantedSamples) break;
      const decoded = decodeKey(e.key);
      if (!decoded) continue;
      if (decoded.isChunkPart) continue;  // skip chunk parts; we'd need reassembly
      if (decoded.isChunkMeta) continue;  // only sample simple values + known _n metas
      bucket.sampled++;
      try {
        const fsVal = await getStored(decoded.type, decoded.org, ...decoded.keyParts);
        if (stableEq(fsVal, e.value)) {
          bucket.matchedSamples++;
        } else {
          if (bucket.mismatchExamples.length < 10) {
            bucket.mismatchExamples.push(decoded.keyParts.join("/"));
          }
          // First failed sample → bail and mark for repair
          return false;
        }
      } catch (err) {
        bucket.errors.push(`sample fetch: ${String(err).slice(0, 80)}`);
        if (bucket.errors.length > 5) bucket.errors = bucket.errors.slice(-5);
        return false;
      }
    }
    if (bucket.sampled >= wantedSamples) break;
    if (page.done || !page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return true;
}

/** Phase 5 — for each mismatched bucket, walk every prod entry. Per-entry:
 *  getStored → JSON-compare → setStored only when absent or different.
 *  Bucket cursor persisted every page so kill-resume continues mid-bucket. */
async function walkRepair(state: PersistedJob, base: string, secret: string): Promise<boolean> {
  const bucketKeys = Object.keys(state.verifyBuckets!).sort();
  while ((state.verifyBucketIdx ?? 0) < bucketKeys.length) {
    const idx = state.verifyBucketIdx ?? 0;
    const bk = bucketKeys[idx];
    const bucket = state.verifyBuckets![bk];
    if (bucket.status === "mismatched" || bucket.status === "repairing") {
      const wasFresh = bucket.status === "mismatched";
      bucket.status = "repairing";
      if (wasFresh) appendLog(state, `[repair] ${bk}: starting (prod=${bucket.prodCount} fs=${bucket.fsCount})`);
      const repairedBefore = bucket.repairedCount;
      const matchedBefore = bucket.matchedCount;
      const done = await repairBucketPage(bucket, state, base, secret);
      const repairedDelta = bucket.repairedCount - repairedBefore;
      const matchedDelta = bucket.matchedCount - matchedBefore;
      appendLog(state, `[repair] ${bk}: page → matched +${matchedDelta} · repaired +${repairedDelta} (bucket totals: matched=${bucket.matchedCount} repaired=${bucket.repairedCount})`);
      if (done) {
        bucket.status = "repaired";
        state.verifyBucketIdx = idx + 1;
        appendLog(state, `[repair] ${bk}: ✓ DONE — matched=${bucket.matchedCount} repaired=${bucket.repairedCount}`);
      }
      return true;
    }
    state.verifyBucketIdx = idx + 1;
  }
  state.phase = "done";
  state.message = `verify-repair complete · ${state.verifyMatched} matched · ${state.verifyRepaired} repaired`;
  appendLog(state, `[done] verify-repair complete — matched=${state.verifyMatched} repaired=${state.verifyRepaired} errors=${state.errors.length}`);
  return true;
}

async function repairBucketPage(
  bucket: VerifyBucket, state: PersistedJob, base: string, secret: string,
): Promise<boolean> {
  const skipped: Array<{ reason: string }> = [];
  const prefix = buildPrefixForBucket(bucket);
  const page = await fetchExportPage(base, secret, prefix, bucket.repairCursor ?? null, skipped, {});
  // Group chunked entries together for chunked types; write simple ones inline.
  const chunkedGroups = new Map<string, { metaCount?: number; parts: Map<number, unknown>; baseKey: (string | number)[] }>();
  await Promise.all(page.entries.map(async (e) => {
    const decoded = decodeKey(e.key);
    if (!decoded) return;
    if (SKIP_TYPES.has(decoded.type)) return;
    if (decoded.isChunkPart) {
      const groupKey = decoded.keyParts.join("/");
      let g = chunkedGroups.get(groupKey);
      if (!g) g = { parts: new Map(), baseKey: decoded.keyParts };
      const partIdx = (e.key[e.key.length - 1] as number);
      g.parts.set(partIdx, e.value);
      chunkedGroups.set(groupKey, g);
      return;
    }
    if (decoded.isChunkMeta) {
      const groupKey = decoded.keyParts.join("/");
      let g = chunkedGroups.get(groupKey);
      if (!g) g = { parts: new Map(), baseKey: decoded.keyParts };
      g.metaCount = (e.value as { n?: number })?.n ?? 0;
      chunkedGroups.set(groupKey, g);
      return;
    }
    // Simple entry — compare-and-write
    try {
      const fsVal = await getStored(decoded.type, decoded.org, ...decoded.keyParts);
      if (stableEq(fsVal, e.value)) {
        bucket.matchedCount++;
        state.verifyMatched = (state.verifyMatched ?? 0) + 1;
      } else {
        const reason = fsVal == null ? "missing in fs" : "fs value differed";
        await setStored(decoded.type, decoded.org, decoded.keyParts, e.value as Record<string, unknown> | null);
        bucket.repairedCount++;
        state.verifyRepaired = (state.verifyRepaired ?? 0) + 1;
        if (bucket.mismatchExamples.length < 10) bucket.mismatchExamples.push(decoded.keyParts.join("/"));
        appendLog(state, `[repair] wrote ${decoded.type}/${decoded.org}/${decoded.keyParts.join("/")} (${reason})`);
      }
    } catch (err) {
      bucket.errors.push(`repair: ${String(err).slice(0, 80)}`);
      if (bucket.errors.length > 5) bucket.errors = bucket.errors.slice(-5);
      appendLog(state, `[repair] ERROR ${decoded.type}/${decoded.org}/${decoded.keyParts.join("/")}: ${String(err).slice(0, 80)}`);
    }
  }));
  // Process completed chunked groups
  for (const [, g] of chunkedGroups) {
    if (g.metaCount == null) continue;  // meta hasn't arrived yet
    if (g.parts.size < g.metaCount) continue;  // not all parts here yet
    try {
      // Reassemble prod-side payload
      const sortedParts: unknown[] = [];
      for (let i = 0; i < g.metaCount; i++) {
        const p = g.parts.get(i);
        if (p === undefined) throw new Error(`missing chunk part ${i} of ${g.metaCount}`);
        sortedParts.push(p);
      }
      const concat = (sortedParts as string[]).join("");
      const prodValue = JSON.parse(concat);
      // Compare to firestore
      const fsValue = await getStoredChunked(bucket.type, bucket.org, ...g.baseKey);
      if (stableEq(fsValue, prodValue)) {
        bucket.matchedCount++;
        state.verifyMatched = (state.verifyMatched ?? 0) + 1;
      } else {
        const reason = fsValue == null ? "missing in fs" : "fs value differed";
        await setStoredChunked(bucket.type, bucket.org, g.baseKey, prodValue);
        bucket.repairedCount++;
        state.verifyRepaired = (state.verifyRepaired ?? 0) + 1;
        if (bucket.mismatchExamples.length < 10) bucket.mismatchExamples.push(g.baseKey.join("/"));
        appendLog(state, `[repair] wrote chunked ${bucket.type}/${bucket.org}/${g.baseKey.join("/")} (${g.metaCount} parts, ${reason})`);
      }
    } catch (err) {
      bucket.errors.push(`chunked: ${String(err).slice(0, 80)}`);
      if (bucket.errors.length > 5) bucket.errors = bucket.errors.slice(-5);
      appendLog(state, `[repair] ERROR chunked ${bucket.type}/${bucket.org}/${g.baseKey.join("/")}: ${String(err).slice(0, 80)}`);
    }
  }
  bucket.repairCursor = page.nextCursor ?? undefined;
  return page.done;
}

/** Build a prod-KV prefix array for a bucket (for /admin/kv-export with prefix). */
function buildPrefixForBucket(bucket: VerifyBucket): Deno.KvKey {
  // TypedStore prefixes use __<type>__ as first key element + org as second.
  // Global types (org, org-by-slug, email-index, etc.) don't have an org prefix.
  if (GLOBAL_TYPES.has(bucket.type)) {
    return [bucket.type] as Deno.KvKey;
  }
  return [`__${bucket.type}__`, bucket.org] as Deno.KvKey;
}

/** Append a line to the job's rolling activity log (last 200 lines, FIFO).
 *  Cheap — just an array push + trim. Persisted on next saveJob(). Lets the
 *  operator watch what's actively being processed inside the job card. */
const LOG_TAIL_MAX = 50;
function appendLog(state: PersistedJob, line: string): void {
  state.logTail ??= [];
  const ts = new Date().toISOString().slice(11, 19); // HH:MM:SS
  state.logTail.push(`${ts} ${line}`);
  if (state.logTail.length > LOG_TAIL_MAX) {
    state.logTail = state.logTail.slice(-LOG_TAIL_MAX);
  }
}

/** Stable structural equality check via sorted-key JSON. Good enough for
 *  the deeply-nested but-plain JSON values our migration carries. */
function stableEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  return stableStringify(a) === stableStringify(b);
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
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

  // Proxy mode: this job is delegated to prod. Just poll prod's status,
  // mirror its state into ours, return. No local work.
  if (state.prodJobId) {
    return await tickProxiedJob(state, sid);
  }

  // Verify-and-repair mode: completely separate phase tree. Dispatched
  // here so it shares the same job lifecycle (status / cancel / kill-all)
  // but doesn't share any walk plumbing with the scan/index-driven paths.
  if (state.opts.mode === "verify-repair") {
    return await tickVerifyRepair(state, sid);
  }

  const tickStart = Date.now();
  const skipped: Array<{ reason: string }> = [];
  const base = prodExportBaseUrl();
  const secret = (Deno.env.get("KV_EXPORT_SECRET") ?? "").trim();
  let queue: ChunkedQueueDoc | null = null;
  let dedupe: Set<string> | null = null;
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
        if (queue === null) {
          queue = await loadQueue(jobId);
          dedupe = buildDedupeSet(queue);
        }
        const moved = await scanParallelBatch(state, queue, dedupe!, base, secret, skipped);
        if (moved) {
          progressed = true;
          // Persist queue immediately so an isolate-OOM mid-tick doesn't lose
          // discovered chunked groups. Without this we'd re-walk many GB of
          // value data to rediscover them after each restart.
          await saveQueue(queue);
          queueDirty = false;
        }
      } else if (state.phase === "index-walk") {
        if (queue === null) {
          queue = await loadQueue(jobId);
          dedupe = buildDedupeSet(queue);
        }
        const moved = await walkIndexBatch(state, queue, dedupe!, base, secret, skipped);
        if (moved) {
          progressed = true;
          await saveQueue(queue);
          queueDirty = false;
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
  console.log(`🔧 [MIGRATION:INIT:${sid}] discovering orgs (uuids + slugs)`);

  // Discover org identifiers. Prod uses BOTH UUIDs and slugs in different
  // contexts: ["org", uuid] for org records, but [slug, "<type>"] for
  // most org-keyed data (audit-finding, user, etc). We walk both indexes
  // to enumerate identifiers from both spaces.
  const ids = new Set<string>();
  const skipped: Array<{ reason: string }> = [];

  for (const indexPrefix of [["org"], ["org-by-slug"]] as Deno.KvKey[]) {
    let cursor: string | null = null;
    while (true) {
      const page = await fetchExportPage(base, secret, indexPrefix, cursor, skipped);
      for (const e of page.entries) {
        // Both shapes: [indexType, identifier, ...] — identifier at position 1
        if (e.key.length >= 2 && typeof e.key[1] === "string") {
          ids.add(e.key[1]);
        }
      }
      if (page.done) break;
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
  }

  state.knownOrgs = [...ids];
  state.scanPrefixIdx = 0;
  state.cursors = {};
  state.indexCursors = {};
  if (state.opts.mode === "index-driven") {
    state.phase = "index-walk";
    console.log(`🔧 [MIGRATION:INIT:${sid}] mode=index-driven → walking audit-done-idx for ${state.knownOrgs.length} org(s) with date filter since=${state.opts.since ?? "-"} until=${state.opts.until ?? "-"}`);
  } else {
    state.phase = "scanning";
    const total = computeScanPrefixes(state.opts.types, state.knownOrgs).length;
    console.log(`🔧 [MIGRATION:INIT:${sid}] mode=scan knownOrgs=${state.knownOrgs.length} (${state.knownOrgs.slice(0, 6).join(",")}${state.knownOrgs.length > 6 ? "…" : ""}) prefixes=${total} types=${state.opts.types?.join(",") ?? "(all)"}`);
  }
}

/** Computes the list of prefix walks to perform during the scanning phase.
 *
 *  When `types` is empty/undefined, we cover the entire DB by walking
 *  per-org and per-global-type prefixes — this gives us 5-15 parallelizable
 *  prefixes instead of one giant `[]` walk. (If knownOrgs is empty we fall
 *  back to a single `[]` walk; should only happen if init failed.)
 *
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
  if (!types || types.length === 0) {
    if (knownOrgs.length === 0) return [[]];
    const prefixes: Deno.KvKey[] = [];
    for (const org of knownOrgs) prefixes.push([org]);
    for (const globalType of GLOBAL_TYPES) prefixes.push([globalType]);
    // TypedStore prefixes — findings/transcripts/configs live here.
    for (const tp of KNOWN_TYPED_STORE_PREFIXES) prefixes.push([tp]);
    return prefixes;
  }
  const prefixes: Deno.KvKey[] = [];
  for (const type of types) {
    const pascal = type.split("-").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
    // Both PascalCase (legacy) and lowercase-kebab (prod actual) TypedStore prefixes.
    prefixes.push([`__${pascal}__`]);
    prefixes.push([`__${type}__`]);
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

function groupHash(type: string, org: string, keyParts: (string | number)[]): string {
  return `${type}\u0001${org}\u0001${JSON.stringify(keyParts)}`;
}

/** Builds a Set of group hashes from queue.entries for O(1) dedupe checks
 *  during a tick. Without this, each new chunked entry would do an O(n)
 *  linear scan of the queue — fine when scan is slow, quadratic when it
 *  isn't. Built once per tick from the persisted queue. */
function buildDedupeSet(queue: ChunkedQueueDoc): Set<string> {
  const s = new Set<string>();
  for (const e of queue.entries) s.add(groupHash(e.type, e.org, e.keyParts));
  return s;
}

/** Process a single entry from /kv-export — apply filters, count by type,
 *  enqueue chunked groups, write non-chunked values. Returns nothing;
 *  mutates state and queue in place. */
async function processEntry(
  state: PersistedJob,
  queue: ChunkedQueueDoc,
  dedupe: Set<string>,
  entry: { key: Deno.KvKey; value: unknown; versionstamp: string },
): Promise<void> {
  state.scanned++;

  const decoded = decodeKey(entry.key);
  if (!decoded) { state.skipped++; return; }
  const bt = baseType(decoded.type);
  if (SKIP_TYPES.has(bt)) { state.skipped++; return; }
  if (state.opts.types && !state.opts.types.includes(bt)) { state.skipped++; return; }

  if (state.opts.sinceVersionstamp && entry.versionstamp <= state.opts.sinceVersionstamp) {
    state.skipped++; return;
  }

  if (state.opts.since !== undefined || state.opts.until !== undefined) {
    const ts = valueTimestamp(bt, entry.value);
    if (ts !== null) {
      if (state.opts.since !== undefined && ts < state.opts.since) { state.skipped++; return; }
      if (state.opts.until !== undefined && ts > state.opts.until) { state.skipped++; return; }
    }
  }

  if (decoded.isChunkPart || decoded.isChunkMeta) {
    const h = groupHash(decoded.type, decoded.org, decoded.keyParts);
    if (!dedupe.has(h)) {
      dedupe.add(h);
      queue.entries.push({ type: decoded.type, org: decoded.org, keyParts: decoded.keyParts });
      state.chunkedQueueSize++;
      const acc = state.byType[bt] ?? { count: 0, chunkedCount: 0 };
      acc.chunkedCount++;
      state.byType[bt] = acc;
    }
    return;
  }

  // Non-chunked match — count for byType regardless of dryRun
  const acc = state.byType[bt] ?? { count: 0, chunkedCount: 0 };
  acc.count++;
  state.byType[bt] = acc;

  if (state.opts.dryRun) { state.skipped++; return; }

  // Defensive: if we got here without a value, the entry was fetched with
  // keysOnly=true (chunked-only TypedStore prefix) but somehow decoded as
  // non-chunked. That'd indicate the prefix list is wrong. Surface the
  // anomaly rather than silently writing undefined.
  if (entry.value === undefined) {
    state.errors.push(`unexpected non-chunked under keysOnly prefix: ${bt}/${decoded.org}/${decoded.keyParts.join(",")}`);
    if (state.errors.length > 50) state.errors = state.errors.slice(-50);
    state.skipped++;
    return;
  }

  try {
    await setStored(bt, decoded.org, decoded.keyParts, entry.value);
    state.written++;
  } catch (err) {
    state.errors.push(`${bt}/${decoded.org}/${decoded.keyParts.join(",")}: ${String(err).slice(0, 200)}`);
    if (state.errors.length > 50) state.errors = state.errors.slice(-50);
  }
}

/** Fires up to PARALLEL_PREFIX_WALKS /kv-export calls concurrently. Each
 *  call corresponds to one scan-prefix at its current cursor. Returns true
 *  if any progress was made this call. */
async function scanParallelBatch(
  state: PersistedJob,
  queue: ChunkedQueueDoc,
  dedupe: Set<string>,
  base: string,
  secret: string,
  skipped: Array<{ reason: string }>,
): Promise<boolean> {
  const sid = state.jobId.slice(-6);
  const scanPrefixes = computeScanPrefixes(state.opts.types, state.knownOrgs);

  // Build the work batch: continue any in-progress prefixes, then top up
  // with fresh ones from scanPrefixIdx.
  const todo: Array<{ idx: number; cursor: string | null }> = [];
  for (const [idxStr, c] of Object.entries(state.cursors)) {
    if (todo.length >= PARALLEL_PREFIX_WALKS) break;
    todo.push({ idx: Number(idxStr), cursor: c === FRESH_CURSOR ? null : c });
  }
  while (todo.length < PARALLEL_PREFIX_WALKS && state.scanPrefixIdx < scanPrefixes.length) {
    state.cursors[String(state.scanPrefixIdx)] = FRESH_CURSOR;
    todo.push({ idx: state.scanPrefixIdx, cursor: null });
    state.scanPrefixIdx++;
  }

  if (todo.length === 0) {
    state.phase = state.chunkedQueueSize === 0 ? "done" : "chunked";
    console.log(`📦 [MIGRATION:SCAN:${sid}] all prefixes done queueSize=${state.chunkedQueueSize} phase=${state.phase}`);
    return false;
  }

  // Fire all in parallel. Use keysOnly for chunked-only TypedStore
  // prefixes — values aren't needed at scan time and would blow memory.
  // Pass since/until from the operator's run options so prod applies the
  // server-side date filter (drops out-of-range entries pre-wire on
  // date-filterable types — chunk parts always pass through).
  const results = await Promise.allSettled(todo.map(async (t) => {
    const prefix = scanPrefixes[t.idx];
    const useKeysOnly = prefix.length === 1
      && typeof prefix[0] === "string"
      && CHUNKED_ONLY_TYPED_STORE_PREFIXES.has(prefix[0] as string);
    return {
      idx: t.idx,
      page: await fetchExportPage(base, secret, prefix, t.cursor, skipped, {
        keysOnly: useKeysOnly,
        since: state.opts.since,
        until: state.opts.until,
      }),
    };
  }));

  let totalReturned = 0;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const idx = todo[i].idx;
    if (r.status !== "fulfilled") {
      state.errors.push(`prefix#${idx} (${JSON.stringify(scanPrefixes[idx])}): ${String(r.reason).slice(0, 160)}`);
      if (state.errors.length > 50) state.errors = state.errors.slice(-50);
      // Cursor stays as-is (FRESH or previous) so we retry next tick.
      continue;
    }
    const { page } = r.value;
    totalReturned += page.entries.length;
    for (const entry of page.entries) {
      await processEntry(state, queue, dedupe, entry);
    }
    if (page.done) {
      delete state.cursors[String(idx)];
    } else if (page.nextCursor) {
      state.cursors[String(idx)] = page.nextCursor;
    } else {
      // done=false but no cursor — defensive: treat as done to avoid loop
      delete state.cursors[String(idx)];
    }
  }

  console.log(`🔍 [MIGRATION:SCAN:${sid}] parallel=${todo.length} returned=${totalReturned} inFlight=${Object.keys(state.cursors).length} nextIdx=${state.scanPrefixIdx}/${scanPrefixes.length}`);

  // If everything assigned has finished AND no new prefixes left, we're done.
  if (Object.keys(state.cursors).length === 0 && state.scanPrefixIdx >= scanPrefixes.length) {
    state.phase = state.chunkedQueueSize === 0 ? "done" : "chunked";
    console.log(`📦 [MIGRATION:SCAN:${sid}] all prefixes done queueSize=${state.chunkedQueueSize} phase=${state.phase}`);
  }

  return totalReturned > 0 || todo.length > 0;
}

// ── Tick phase: index-walk ──────────────────────────────────────────────────

/** Walks `[orgId, "audit-done-idx"]` per known org with server-side date
 *  filter. For each entry, queues 3 chunked-group migrations keyed by the
 *  same findingId: audit-finding, audit-transcript, audit-job. Skips the
 *  full TypedStore prefix scan entirely — orders of magnitude faster for
 *  date-bounded runs. */
async function walkIndexBatch(
  state: PersistedJob,
  queue: ChunkedQueueDoc,
  dedupe: Set<string>,
  base: string,
  secret: string,
  skipped: Array<{ reason: string }>,
): Promise<boolean> {
  const sid = state.jobId.slice(-6);
  const cursors = state.indexCursors ?? (state.indexCursors = {});

  // Build todo: for each known org, walk if not yet done.
  const todo: Array<{ org: string; cursor: string | null }> = [];
  for (const org of state.knownOrgs) {
    if (todo.length >= PARALLEL_PREFIX_WALKS) break;
    const c = cursors[org];
    if (c === undefined) {
      // Not started yet — start now.
      cursors[org] = FRESH_CURSOR;
      todo.push({ org, cursor: null });
    } else if (c !== "__DONE__") {
      todo.push({ org, cursor: c === FRESH_CURSOR ? null : c });
    }
  }

  if (todo.length === 0) {
    // All orgs' index walks done → transition to chunked phase
    state.phase = state.chunkedQueueSize === 0 ? "done" : "chunked";
    console.log(`📦 [MIGRATION:INDEX:${sid}] all orgs done queueSize=${state.chunkedQueueSize} phase=${state.phase}`);
    return false;
  }

  // Fire all in parallel. Server-side date filter drops out-of-range
  // entries; audit-done-idx is in TIMESTAMPED_FIELDS so this works.
  const results = await Promise.allSettled(todo.map(async (t) => ({
    org: t.org,
    page: await fetchExportPage(base, secret, [t.org, "audit-done-idx"], t.cursor, skipped, {
      since: state.opts.since,
      until: state.opts.until,
    }),
  })));

  let totalReturned = 0;
  let totalQueued = 0;
  for (const r of results) {
    if (r.status !== "fulfilled") {
      state.errors.push(`index walk: ${String(r.reason).slice(0, 200)}`);
      if (state.errors.length > 50) state.errors = state.errors.slice(-50);
      continue;
    }
    const { org, page } = r.value;
    totalReturned += page.entries.length;

    for (const entry of page.entries) {
      // Key shape: [orgId, "audit-done-idx", findingId] — findingId at [2]
      if (entry.key.length < 3 || typeof entry.key[2] !== "string") continue;
      const findingId = entry.key[2];
      state.scanned++;

      // Queue the three per-finding TypedStore migrations. De-dupe via
      // the existing groupHash mechanism so re-runs are idempotent.
      for (const t of ["audit-finding", "audit-transcript", "audit-job"] as const) {
        const h = groupHash(t, org, [findingId]);
        if (!dedupe.has(h)) {
          dedupe.add(h);
          queue.entries.push({ type: t, org, keyParts: [findingId] });
          state.chunkedQueueSize++;
          const acc = state.byType[t] ?? { count: 0, chunkedCount: 0 };
          acc.chunkedCount++;
          state.byType[t] = acc;
          totalQueued++;
        }
      }
    }

    if (page.done) {
      cursors[org] = "__DONE__";
    } else if (page.nextCursor) {
      cursors[org] = page.nextCursor;
    } else {
      cursors[org] = "__DONE__";
    }
  }

  const remainingOrgs = state.knownOrgs.filter((o) => cursors[o] !== "__DONE__").length;
  console.log(`🔍 [MIGRATION:INDEX:${sid}] parallel=${todo.length} returned=${totalReturned} queued=${totalQueued} totalQueue=${state.chunkedQueueSize} remainingOrgs=${remainingOrgs}`);

  if (remainingOrgs === 0) {
    state.phase = state.chunkedQueueSize === 0 ? "done" : "chunked";
    console.log(`📦 [MIGRATION:INDEX:${sid}] all orgs complete → phase=${state.phase} queueSize=${state.chunkedQueueSize}`);
  }

  return totalReturned > 0;
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

/** Processes a batch of chunked groups via /admin/kv-batch-list — one
 *  HTTP round-trip pulls all entries for up to BATCH_LIST_INITIAL groups
 *  at once, then we reassemble each in memory. Falls back to per-group
 *  fetch (migrateChunkedGroup) for groups whose batched response was
 *  empty (either a real empty due to wrong primary candidate, or a
 *  placeholder from a `partial: true` budget cutoff).
 *
 *  Adaptive batch size: prod's `partial: true` triggers a halving
 *  (saved on state.batchListSize) so subsequent ticks back off. */
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

  const batchSize = state.batchListSize ?? BATCH_LIST_INITIAL;
  const start = state.chunkedQueueProcessed;
  const end = Math.min(start + batchSize, queue.entries.length);
  const batch = queue.entries.slice(start, end);

  console.log(`📦 [MIGRATION:CHUNK:${sid}] batched ${start + 1}-${end}/${queue.entries.length} (batchSize=${batchSize})`);

  // Compute primary candidate prefix per group — lowercase TypedStore
  // first since that's what audit-finding/transcript/job all use. False-
  // positive types (judge-decided/review-active) will return empty here
  // and fall back to the per-group migrateChunkedGroup which tries all
  // candidate shapes.
  const prefixes: Deno.KvKey[] = batch.map((g) =>
    [`__${g.type}__`, g.org, ...g.keyParts]
  );

  const skipped: Array<{ reason: string }> = [];
  let result;
  try {
    result = await fetchBatchList(base, secret, prefixes, skipped, 200);
  } catch (err) {
    state.errors.push(`batch-list: ${String(err).slice(0, 200)}`);
    if (state.errors.length > 50) state.errors = state.errors.slice(-50);
    console.log(`❌ [MIGRATION:CHUNK:${sid}] batch-list failed: ${err}`);
    return false;
  }

  if (result.partial) {
    const newSize = Math.max(BATCH_LIST_MIN, Math.floor(batchSize / 2));
    state.batchListSize = newSize;
    console.log(`⚠️ [MIGRATION:CHUNK:${sid}] partial response — halving batch ${batchSize} → ${newSize} for next tick`);
  }

  // Process each group. If batched returned empty AND the response was
  // partial, that group might be a placeholder — fall back to per-group
  // fetch which is authoritative.
  for (let i = 0; i < batch.length; i++) {
    const group = batch[i];
    const r = result.groups[i];

    try {
      if (r.entries.length === 0) {
        // Either real empty (false-positive type) or placeholder. Use
        // the per-group fallback — it tries all candidate shapes and
        // handles both cases correctly.
        await migrateChunkedGroup(state, group, base, secret, skipped);
        if (!state.opts.dryRun) state.writtenChunked++;
      } else {
        await reassembleFromEntries(state, group, r.entries, skipped);
        if (!state.opts.dryRun) state.writtenChunked++;
      }
    } catch (err) {
      const msg = `chunked ${group.type}/${group.org}/${group.keyParts.join(",")}: ${String(err).slice(0, 200)}`;
      state.errors.push(msg);
      if (state.errors.length > 50) state.errors = state.errors.slice(-50);
      console.log(`❌ [MIGRATION:CHUNK:${sid}] ${msg}`);
    }
  }

  if (skipped.length > 0) {
    const reasons = new Map<string, number>();
    for (const s of skipped) reasons.set(s.reason, (reasons.get(s.reason) ?? 0) + 1);
    for (const [reason, n] of reasons) {
      state.errors.push(`⚠️ chunked batch: ${n} ${reason}-typed value(s) un-migrated`);
    }
    if (state.errors.length > 50) state.errors = state.errors.slice(-50);
  }

  state.chunkedQueueProcessed = end;

  if (state.chunkedQueueProcessed >= queue.entries.length) {
    state.phase = "done";
  }
  return true;
}

/** Reassembly path from already-fetched entries (the batched fast path).
 *  Mirrors the inner logic of migrateChunkedGroup but skips the prefix
 *  walk since the batch endpoint already gave us the entries. */
async function reassembleFromEntries(
  state: PersistedJob,
  group: { type: string; org: string; keyParts: (string | number)[] },
  entries: Array<{ key: Deno.KvKey; value: unknown; versionstamp: string }>,
  skipped: Array<{ reason: string }>,
): Promise<void> {
  let metaTotal: number | null = null;
  const slices: string[] = [];
  for (const e of entries) {
    const last = e.key[e.key.length - 1];
    if (last === "_n" && typeof e.value === "number") {
      metaTotal = e.value;
    } else if (typeof last === "number" && typeof e.value === "string") {
      slices[last] = e.value;
    }
  }

  if (metaTotal === null || metaTotal <= 0) {
    // No _n meta — false-positive type, write each entry as individual
    // record preserving its full key path. Same fallback behavior as
    // migrateChunkedGroup's "FALLBACK" branch.
    if (!state.opts.dryRun) {
      for (const e of entries) {
        const decoded = decodeKey(e.key);
        if (!decoded) continue;
        const last = e.key[e.key.length - 1];
        const fullKey: (string | number)[] = [...decoded.keyParts];
        if (typeof last === "number") fullKey.push(last);
        else if (typeof last === "string" && last !== "_n") fullKey.push(last);
        await setStored(baseType(decoded.type), decoded.org, fullKey, e.value);
      }
    }
    // Note: don't reference `skipped` directly here — the surrounding
    // batch loop captures decode-skipped warnings via the shared array.
    void skipped;
    return;
  }
  for (let i = 0; i < metaTotal; i++) {
    if (typeof slices[i] !== "string") {
      throw new Error(`chunk ${i}/${metaTotal} missing for ${group.type}/${group.org}/${group.keyParts.join(",")}`);
    }
  }
  const payload = JSON.parse(slices.slice(0, metaTotal).join(""));
  if (!state.opts.dryRun) {
    await setStoredChunked(baseType(group.type), group.org, group.keyParts, payload);
  }
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
  // Lowercase-kebab TypedStore (what prod actually uses, e.g. __audit-finding__)
  candidates.push([`__${type}__`, org, ...keyParts]);
  // PascalCase TypedStore (legacy / convention check)
  candidates.push([`__${pascal}__`, org, ...keyParts]);
  if (org === "") candidates.push([type, ...keyParts]);
  candidates.push([org, type, ...keyParts]);

  for (const groupPrefix of candidates) {
    let metaTotal: number | null = null;
    const slices: string[] = [];
    let foundAny = false;
    let cursor: string | null = null;
    /** Collected entries for the fallback path — preserved with full key
     *  so we can write each as an individual record if no _n is found. */
    const collected: Array<{ key: Deno.KvKey; value: unknown }> = [];

    while (true) {
      const page = await fetchExportPage(base, secret, groupPrefix, cursor, skipped);
      for (const e of page.entries) {
        foundAny = true;
        collected.push({ key: e.key, value: e.value });
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

    // FALLBACK: no _n meta found means our chunk-part heuristic
    // false-positived on this group — these aren't chunked records, they're
    // per-list-item indexed records (e.g. judge-decided per-question, review-
    // active per-reviewer, etc.). Write each entry as its own Firestore
    // record, preserving the full original key path. No reassembly.
    if (metaTotal === null || metaTotal <= 0) {
      if (!state.opts.dryRun) {
        for (const e of collected) {
          const decoded = decodeKey(e.key);
          if (!decoded) continue;
          const last = e.key[e.key.length - 1];
          // Reconstruct the full keyParts INCLUDING the trailing index that
          // the chunk-part heuristic stripped during scan. For the fallback
          // these are real key components, not chunk indices.
          const fullKey: (string | number)[] = [...decoded.keyParts];
          if (typeof last === "number") fullKey.push(last);
          else if (typeof last === "string" && last !== "_n") fullKey.push(last);
          await setStored(baseType(decoded.type), decoded.org, fullKey, e.value);
        }
      }
      return;
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
  // None of the candidate shapes had any entries. This is normally a race —
  // the entry was scanned but deleted before reassembly. With the type-name-
  // based chunked detection, false positives shouldn't queue here anyway.
  // Log and skip rather than blocking the migration with an error.
  console.log(`⚠️ [MIGRATION:CHUNK] race-skip: ${type}/${org}/${keyParts.join(",")} — not found at any known shape (likely deleted in flight)`);
}

// ── Orphan check ─────────────────────────────────────────────────────────────

export interface OrphanReport {
  orphans: Array<{ org: string; findingId: string }>;
  totalFindings: number;
  totalIndexed: number;
  cappedAt: number | null;
}

/** Lists findings present in __audit-finding__ that lack a corresponding
 *  audit-done-idx entry. These are findings the index-driven migration
 *  would skip — usually failed/in-progress audits. Capped at 500 to keep
 *  the response bounded. */
export async function orphanCheck(): Promise<OrphanReport> {
  const ck = ensureProdKvConfigured();
  if (!ck.ok) throw new Error(ck.error);
  const base = prodExportBaseUrl();
  const secret = (Deno.env.get("KV_EXPORT_SECRET") ?? "").trim();
  const skipped: Array<{ reason: string }> = [];
  const CAP = 500;

  console.log(`[MIGRATION:ORPHAN] starting`);

  // Set of "<org>::<findingId>" pairs that have an audit-done-idx entry.
  const indexed = new Set<string>();
  let totalIndexed = 0;
  {
    let cursor: string | null = null;
    while (true) {
      const page = await fetchExportPage(base, secret, ["audit-done-idx"], cursor, skipped, { keysOnly: true });
      // Note: audit-done-idx might be at [orgId, "audit-done-idx", findingId]
      // not [], so we walk per-org instead. Per-org walks are below.
      if (page.done) break;
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
      if (page.entries.length === 0) break;
    }
  }

  // Better: walk per-org. We need orgs first — re-use init's discovery.
  const orgs = new Set<string>();
  for (const indexPrefix of [["org"], ["org-by-slug"]] as Deno.KvKey[]) {
    let cursor: string | null = null;
    while (true) {
      const page = await fetchExportPage(base, secret, indexPrefix, cursor, skipped, { keysOnly: true });
      for (const e of page.entries) {
        if (e.key.length >= 2 && typeof e.key[1] === "string") orgs.add(e.key[1]);
      }
      if (page.done || !page.nextCursor) break;
      cursor = page.nextCursor;
    }
  }
  console.log(`[MIGRATION:ORPHAN] orgs=${orgs.size}`);

  // Walk per-org audit-done-idx
  for (const org of orgs) {
    let cursor: string | null = null;
    while (true) {
      const page = await fetchExportPage(base, secret, [org, "audit-done-idx"], cursor, skipped, { keysOnly: true });
      for (const e of page.entries) {
        if (e.key.length >= 3 && typeof e.key[2] === "string") {
          indexed.add(`${org}::${e.key[2]}`);
          totalIndexed++;
        }
      }
      if (page.done || !page.nextCursor) break;
      cursor = page.nextCursor;
    }
  }
  console.log(`[MIGRATION:ORPHAN] indexed findings=${totalIndexed}`);

  // Walk __audit-finding__ keysOnly to enumerate ALL findings in prod
  const orphans: Array<{ org: string; findingId: string }> = [];
  let totalFindings = 0;
  let cursor: string | null = null;
  // Track chunked groups by (org, findingId) — multiple chunk parts per group.
  const seenGroups = new Set<string>();
  while (true) {
    const page = await fetchExportPage(base, secret, ["__audit-finding__"], cursor, skipped, { keysOnly: true });
    for (const e of page.entries) {
      // [__audit-finding__, orgId, findingId, partIdx | "_n"]
      if (e.key.length < 3) continue;
      const org = String(e.key[1]);
      const findingId = String(e.key[2]);
      const k = `${org}::${findingId}`;
      if (seenGroups.has(k)) continue;
      seenGroups.add(k);
      totalFindings++;
      if (!indexed.has(k)) {
        if (orphans.length < CAP) orphans.push({ org, findingId });
      }
    }
    if (page.done || !page.nextCursor) break;
    cursor = page.nextCursor;
  }

  const capped = orphans.length >= CAP ? CAP : null;
  console.log(`[MIGRATION:ORPHAN] complete totalFindings=${totalFindings} totalIndexed=${totalIndexed} orphans=${orphans.length}${capped ? ` (capped at ${CAP})` : ""}`);
  return { orphans, totalFindings, totalIndexed, cappedAt: capped };
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
  const startedAt = Date.now();

  const samples: Array<{ key: Deno.KvKey; value: unknown }> = [];
  let i = 0;
  let cursor: string | null = null;
  let pageNum = 0;
  console.log(`🔬 [MIGRATION:VERIFY] PHASE 1 — reservoir-sampling ${sampleSize} entries from up to 10000 prod KV keys`);
  while (i < 10_000) {
    const page = await fetchExportPage(base, secret, [], cursor, skipped);
    pageNum++;
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
    console.log(`🔬 [MIGRATION:VERIFY] sampling page ${pageNum}: scanned ${i}/10000 keys, reservoir=${samples.length}/${sampleSize}${page.done ? " (prod walk complete)" : ""}`);
    if (page.done) break;
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  const sampledMs = Date.now() - startedAt;
  console.log(`🔬 [MIGRATION:VERIFY] PHASE 1 done in ${sampledMs}ms — ${samples.length} samples drawn from ${i} keys, now comparing each to Firestore`);

  const examples: VerifyReport["examples"] = [];
  let matched = 0, missing = 0, mismatched = 0, skippedCount = 0;
  let n = 0;
  for (const s of samples) {
    n++;
    const decoded = decodeKey(s.key);
    if (!decoded || decoded.isChunkPart || decoded.isChunkMeta) {
      skippedCount++;
      console.log(`🔬 [MIGRATION:VERIFY] (${n}/${samples.length}) SKIP chunked/undecodable`);
      continue;
    }
    if (SKIP_TYPES.has(decoded.type)) {
      skippedCount++;
      console.log(`🔬 [MIGRATION:VERIFY] (${n}/${samples.length}) SKIP type=${decoded.type}`);
      continue;
    }
    const got = await getStored(decoded.type, decoded.org, ...decoded.keyParts);
    const keyStr = `${decoded.type}/${decoded.org}/${decoded.keyParts.join(",")}`;
    if (got === null) {
      missing++;
      console.log(`❌ [MIGRATION:VERIFY] (${n}/${samples.length}) MISSING ${keyStr}`);
      if (examples.length < 20) examples.push({ key: keyStr, status: "missing" });
    } else if (JSON.stringify(got) === JSON.stringify(s.value)) {
      matched++;
      console.log(`✅ [MIGRATION:VERIFY] (${n}/${samples.length}) MATCH ${keyStr}`);
    } else {
      mismatched++;
      console.log(`⚠️  [MIGRATION:VERIFY] (${n}/${samples.length}) MISMATCH ${keyStr}`);
      if (examples.length < 20) examples.push({ key: keyStr, status: "mismatch", note: "value differs" });
    }
  }
  const totalMs = Date.now() - startedAt;
  console.log(`🏁 [MIGRATION:VERIFY] DONE in ${totalMs}ms — sampled=${samples.length} matched=${matched} missing=${missing} mismatched=${mismatched} skipped=${skippedCount}`);
  return { sampled: samples.length, matched, missing, mismatched, examples };
}

// ── Health check ────────────────────────────────────────────────────────────

export interface HealthCheckBucket {
  type: string;
  org: string;
  prodCount: number;
  isChunked: boolean;
  samplesChecked: number;
  samplesMatched: number;
  samplesMissing: number;
  samplesMismatched: number;
  status: "healthy" | "missing-data" | "mismatched-data" | "skipped" | "error";
  notes: string[];
}

export interface HealthCheckReport {
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  totalBuckets: number;
  healthyBuckets: number;
  unhealthyBuckets: number;
  totalSamplesChecked: number;
  totalSamplesMatched: number;
  totalSamplesMissing: number;
  totalSamplesMismatched: number;
  buckets: HealthCheckBucket[];
  runningJobs: Array<{ jobId: string; phase: JobPhase; status: JobStatus; mode: string; startedAt: number; message: string }>;
  source: "verify-repair-job" | "fresh-inventory";
  sourceJobId?: string;
  notes: string[];
}

const HEALTH_SAMPLES_PER_BUCKET = 3;

/** Comprehensive migration health check. Answers three questions in one shot:
 *  1) What jobs are running? (lists all running migration jobs)
 *  2) What writes are left? (per-bucket: prod count, samples-present-in-fs)
 *  3) Is everything operating correctly? (per-bucket health status)
 *
 *  Strategy: reuses the verify-repair job's already-discovered bucket counts
 *  (no need to re-walk all of prod KV). For each bucket, samples N entries
 *  via prod kv-export with the bucket prefix, then checks each in Firestore
 *  via getStored / getStoredChunked. This avoids the OOM-prone full-bucket
 *  list that broke fs-count. Synchronous — runs in one HTTP request,
 *  ~60-90s for ~80 buckets at 3 samples each. */
export async function healthCheck(): Promise<HealthCheckReport> {
  const ck = ensureProdKvConfigured();
  if (!ck.ok) throw new Error(ck.error);
  const base = prodExportBaseUrl();
  const secret = (Deno.env.get("KV_EXPORT_SECRET") ?? "").trim();
  const startedAt = Date.now();

  console.log(`🩺 [HEALTH-CHECK] start`);

  // 1. List jobs — surface what's running so the operator sees activity
  const allJobs = await listJobs();
  const running = allJobs
    .filter((j) => j.status === "running")
    .map((j) => ({
      jobId: j.jobId,
      phase: j.phase,
      status: j.status,
      mode: j.opts.mode ?? "scan",
      startedAt: j.startedAt,
      message: j.message,
    }));
  console.log(`🩺 [HEALTH-CHECK] ${running.length} running job(s)`);

  // 2. Get bucket counts. Prefer a recent verify-repair job (already walked
  //    prod once). Otherwise fall back to a fresh inventory.
  const verifyJob = allJobs.find(
    (j) => j.opts.mode === "verify-repair" && j.verifyBuckets && Object.keys(j.verifyBuckets).length > 0,
  );
  let bucketEntries: Array<{ type: string; org: string; prodCount: number; isChunked: boolean }>;
  let source: HealthCheckReport["source"];
  let sourceJobId: string | undefined;
  const reportNotes: string[] = [];

  if (verifyJob && verifyJob.verifyBuckets) {
    source = "verify-repair-job";
    sourceJobId = verifyJob.jobId;
    bucketEntries = Object.values(verifyJob.verifyBuckets).map((b) => ({
      type: b.type,
      org: b.org,
      prodCount: b.prodCount,
      isChunked: b.isChunked,
    }));
    reportNotes.push(`Bucket counts sourced from verify-repair job ${verifyJob.jobId.slice(-6)}`);
    console.log(`🩺 [HEALTH-CHECK] using verify-repair job ${verifyJob.jobId.slice(-6)} for ${bucketEntries.length} bucket counts`);
  } else {
    source = "fresh-inventory";
    reportNotes.push("No verify-repair job found — running fresh inventory walk");
    console.log(`🩺 [HEALTH-CHECK] no verify job, walking prod inventory`);
    const inv = await inventoryProdKv();
    bucketEntries = inv.rows.map((r) => ({
      type: r.type,
      org: r.org,
      prodCount: r.count + r.chunkedCount,
      isChunked: r.chunkedCount > 0,
    }));
  }

  // 3. For each bucket, sample N entries from prod, check Firestore
  const buckets: HealthCheckBucket[] = [];
  let totalSamplesChecked = 0, totalSamplesMatched = 0, totalSamplesMissing = 0, totalSamplesMismatched = 0;

  for (let i = 0; i < bucketEntries.length; i++) {
    const b = bucketEntries[i];
    const bk = `${b.type}/${b.org}`;
    const bucket: HealthCheckBucket = {
      type: b.type,
      org: b.org,
      prodCount: b.prodCount,
      isChunked: b.isChunked,
      samplesChecked: 0,
      samplesMatched: 0,
      samplesMissing: 0,
      samplesMismatched: 0,
      status: "healthy",
      notes: [],
    };

    if (SKIP_TYPES.has(b.type)) {
      bucket.status = "skipped";
      bucket.notes.push(`type ${b.type} is in SKIP_TYPES`);
      buckets.push(bucket);
      console.log(`🩺 [HEALTH-CHECK] (${i + 1}/${bucketEntries.length}) ${bk} — SKIPPED`);
      continue;
    }

    if (b.prodCount === 0) {
      bucket.notes.push("prod count is 0, nothing to verify");
      buckets.push(bucket);
      console.log(`🩺 [HEALTH-CHECK] (${i + 1}/${bucketEntries.length}) ${bk} — empty in prod, OK`);
      continue;
    }

    try {
      // Sample first N keys from prod for this bucket via prefixed kv-export
      const skipped: Array<{ reason: string }> = [];
      const prefix: Deno.KvKey = GLOBAL_TYPES.has(b.type) ? [b.type] : [`__${b.type}__`, b.org];
      const page = await fetchExportPage(base, secret, prefix, null, skipped, {});
      const candidates: Array<{ key: Deno.KvKey; value: unknown; isChunked: boolean }> = [];
      for (const e of page.entries) {
        const decoded = decodeKey(e.key);
        if (!decoded) continue;
        // For chunked types: only sample chunk META keys (we'll reassemble via getStoredChunked)
        // For simple types: skip chunk parts and metas
        if (b.isChunked) {
          if (!decoded.isChunkMeta) continue;
        } else {
          if (decoded.isChunkPart || decoded.isChunkMeta) continue;
        }
        candidates.push({ key: e.key, value: e.value, isChunked: decoded.isChunkMeta });
        if (candidates.length >= HEALTH_SAMPLES_PER_BUCKET) break;
      }

      if (candidates.length === 0) {
        bucket.notes.push("no checkable samples in first prod page");
        buckets.push(bucket);
        console.log(`🩺 [HEALTH-CHECK] (${i + 1}/${bucketEntries.length}) ${bk} — no samples drawn`);
        continue;
      }

      for (const c of candidates) {
        bucket.samplesChecked++;
        totalSamplesChecked++;
        const decoded = decodeKey(c.key)!;
        try {
          if (b.isChunked) {
            // Chunked: reassemble in Firestore, just check existence (value compare requires re-parsing prod side)
            const fsVal = await getStoredChunked(b.type, b.org, ...decoded.keyParts);
            if (fsVal === null) {
              bucket.samplesMissing++;
              totalSamplesMissing++;
              if (bucket.notes.length < 5) bucket.notes.push(`missing chunked: ${decoded.keyParts.join("/")}`);
            } else {
              bucket.samplesMatched++;
              totalSamplesMatched++;
            }
          } else {
            const fsVal = await getStored(b.type, b.org, ...decoded.keyParts);
            if (fsVal === null) {
              bucket.samplesMissing++;
              totalSamplesMissing++;
              if (bucket.notes.length < 5) bucket.notes.push(`missing: ${decoded.keyParts.join("/")}`);
            } else if (JSON.stringify(fsVal) === JSON.stringify(c.value)) {
              bucket.samplesMatched++;
              totalSamplesMatched++;
            } else {
              bucket.samplesMismatched++;
              totalSamplesMismatched++;
              if (bucket.notes.length < 5) bucket.notes.push(`mismatch: ${decoded.keyParts.join("/")}`);
            }
          }
        } catch (err) {
          bucket.samplesMissing++;
          totalSamplesMissing++;
          if (bucket.notes.length < 5) bucket.notes.push(`fetch error: ${String(err).slice(0, 60)}`);
        }
      }

      if (bucket.samplesMissing > 0) bucket.status = "missing-data";
      else if (bucket.samplesMismatched > 0) bucket.status = "mismatched-data";
      else bucket.status = "healthy";

      console.log(`🩺 [HEALTH-CHECK] (${i + 1}/${bucketEntries.length}) ${bk} — ${bucket.status} matched=${bucket.samplesMatched} missing=${bucket.samplesMissing} mismatched=${bucket.samplesMismatched}`);
    } catch (err) {
      bucket.status = "error";
      bucket.notes.push(`bucket sample failed: ${String(err).slice(0, 100)}`);
      console.log(`🩺 [HEALTH-CHECK] (${i + 1}/${bucketEntries.length}) ${bk} — ERROR: ${String(err).slice(0, 100)}`);
    }
    buckets.push(bucket);
  }

  const finishedAt = Date.now();
  const durationMs = finishedAt - startedAt;
  const healthy = buckets.filter((b) => b.status === "healthy" || b.status === "skipped").length;
  const unhealthy = buckets.length - healthy;
  console.log(`🏁 [HEALTH-CHECK] done in ${durationMs}ms — ${healthy}/${buckets.length} healthy, ${unhealthy} need attention`);

  return {
    startedAt,
    finishedAt,
    durationMs,
    totalBuckets: buckets.length,
    healthyBuckets: healthy,
    unhealthyBuckets: unhealthy,
    totalSamplesChecked,
    totalSamplesMatched,
    totalSamplesMissing,
    totalSamplesMismatched,
    buckets,
    runningJobs: running,
    source,
    sourceJobId,
    notes: reportNotes,
  };
}
