/** KV → Firestore migration business logic.
 *
 *  Reads prod data over HTTP via a password-protected export endpoint on the
 *  prod (`main` branch) deployment. The prod app exposes:
 *    POST {PROD_EXPORT_BASE_URL}/admin/kv-export    — paginated list
 *    POST {PROD_EXPORT_BASE_URL}/admin/kv-inventory — single-shot key counts
 *  Both authenticated by KV_EXPORT_SECRET in the Authorization header.
 *
 *  Writes Firestore via the same setStored API the rest of the app uses.
 *  Never writes back to prod KV.
 *
 *  Jobs are tracked in-memory; survive only as long as the isolate is alive.
 *  Re-running is safe — every write is an idempotent upsert keyed by
 *  (type, org, ...keyParts). */

import { setStored, setStoredChunked, getStored } from "@core/data/firestore/mod.ts";

// ── Type classification ──────────────────────────────────────────────────────

/** Top-level "global" prefixes used by prod's main.ts that aren't org-scoped.
 *  These appear in keys as ["typeName", ...rest] (no orgId in slot 0). */
export const GLOBAL_TYPES = new Set([
  "org", "org-by-slug", "email-index", "session", "default-org",
  "audit-finding", "audit-transcript", "token-usage",
]);

/** Types we never migrate — transient/in-flight state that would corrupt the
 *  cutover if copied. Sessions expire naturally; review-pending/decided are
 *  active queue state owned by the running pipeline. */
export const SKIP_TYPES = new Set([
  "session",
  "review-pending", "review-decided", "review-audit-pending",
]);

/** Types whose value carries a `ts`/`startedAt`/`createdAt` we can date-filter. */
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
  org: string;          // "" for globals
  keyParts: (string | number)[];
  isChunkPart: boolean;
  isChunkMeta: boolean;
}

/** Decode a Deno KV key from prod into (type, org, keyParts).
 *
 *  Three shapes are recognized:
 *    1. ["__TypeName__", orgId, ...rest]  — TypedStore convention
 *    2. ["type-name", ...rest]            — globals (org, email-index, ...)
 *    3. [orgId, "kebab-name", ...rest]    — orgKey() convention
 *
 *  Returns null if we can't decode (probably noise / stray key). */
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

// ── Prod connection (HTTP-based) ─────────────────────────────────────────────

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

/** Reverse of the prod-side encodeValue tag scheme. */
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
    // Unknown tag — pass through as-is so it's visible in errors
    return v;
  }
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(obj)) out[k] = decodeValue(val, skipped);
  return out;
}

/** Read-only HTTP client over the prod /admin/kv-export endpoint. Exposes
 *  a Deno.Kv-like .list() async iterator + .close() so the migration loop's
 *  call sites stay unchanged. */
export interface ProdReaderEntry {
  key: Deno.KvKey;
  value: unknown;
  versionstamp: string;
}

export interface ProdKvReader {
  list(opts: { prefix: Deno.KvKey }): AsyncIterable<ProdReaderEntry>;
  /** Skipped values surfaced during decode — values the prod side couldn't
   *  represent over JSON (bigint/Map/Set). Caller should surface these as
   *  errors. Mutated in place as iteration proceeds. */
  readonly skipped: Array<{ reason: string }>;
  close(): void;
}

const EXPORT_BATCH_LIMIT = 500;

class HttpProdKvReader implements ProdKvReader {
  readonly skipped: Array<{ reason: string }> = [];
  constructor(private readonly base: string, private readonly secret: string) {}

  async *list(opts: { prefix: Deno.KvKey }): AsyncIterable<ProdReaderEntry> {
    let cursor: string | undefined;
    let page = 0;
    while (true) {
      const body: Record<string, unknown> = { prefix: opts.prefix, limit: EXPORT_BATCH_LIMIT };
      if (cursor) body.cursor = cursor;
      const res = await fetch(`${this.base}/admin/kv-export`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`kv-export HTTP ${res.status}: ${text.slice(0, 300)}`);
      }
      const data = await res.json() as {
        ok: boolean;
        entries: Array<{ key: Deno.KvKey; value: unknown; versionstamp: string }>;
        nextCursor?: string;
        done: boolean;
        error?: string;
      };
      if (!data.ok) throw new Error(`kv-export error: ${data.error ?? "unknown"}`);
      page++;
      for (const e of data.entries) {
        yield {
          key: e.key,
          value: decodeValue(e.value, this.skipped),
          versionstamp: e.versionstamp,
        };
      }
      if (data.done) return;
      cursor = data.nextCursor;
      if (!cursor) {
        throw new Error(`kv-export done=false but no nextCursor (page ${page})`);
      }
    }
  }

  close(): void {
    // No-op — HTTP is stateless, no connection to release.
  }
}

function openProdReader(): ProdKvReader {
  const base = prodExportBaseUrl();
  if (!base) throw new Error("PROD_EXPORT_BASE_URL not configured");
  const rawSecret = Deno.env.get("KV_EXPORT_SECRET");
  if (!rawSecret) throw new Error("KV_EXPORT_SECRET env var is not set");
  const secret = rawSecret.trim();
  console.log(`[MIGRATE] prod reader: base=${base} secretLen=${secret.length}`);
  return new HttpProdKvReader(base, secret);
}

// ── Inventory ────────────────────────────────────────────────────────────────

export interface InventoryRow {
  org: string;
  type: string;
  count: number;
  chunkedCount: number;
}

interface InventoryResponse {
  ok: boolean;
  totalKeys: number;
  byPrefix: Record<string, number>;
  error?: string;
}

/** Calls the prod /admin/kv-inventory endpoint (single ~30s POST that walks
 *  the entire prod KV server-side and returns aggregate counts). Translates
 *  the response into the {org, type, count, chunkedCount} row shape the UI
 *  expects. Surfaces errors directly — never silently falls back. */
export async function inventoryProdKv(): Promise<InventoryRow[]> {
  const ck = ensureProdKvConfigured();
  if (!ck.ok) throw new Error(ck.error);

  const base = prodExportBaseUrl();
  const secret = (Deno.env.get("KV_EXPORT_SECRET") ?? "").trim();
  const res = await fetch(`${base}/admin/kv-inventory`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`kv-inventory HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json() as InventoryResponse;
  if (!data.ok) throw new Error(`kv-inventory error: ${data.error ?? "unknown"}`);

  // Aggregate prefixes into {org, type, count, chunkedCount} rows.
  const rows = new Map<string, { count: number; chunkedCount: number }>();
  const chunkRe = /^(.+)-chunk-(\d+)$/;
  for (const [prefix, count] of Object.entries(data.byPrefix)) {
    const slash = prefix.indexOf("/");
    let org: string;
    let typeRaw: string;
    if (slash < 0) {
      org = "";
      typeRaw = prefix;
    } else {
      org = prefix.slice(0, slash);
      typeRaw = prefix.slice(slash + 1);
    }
    const m = chunkRe.exec(typeRaw);
    if (m) {
      // Per the contract, chunk-N counts are equal across N (each group has
      // every chunk index). Count chunked groups exactly once via chunk-0.
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
  return out;
}

// ── Job state ────────────────────────────────────────────────────────────────

export type JobStatus = "running" | "done" | "cancelled" | "error";

export interface JobState {
  jobId: string;
  startedAt: number;
  endedAt: number | null;
  status: JobStatus;
  cancelled: boolean;
  scanned: number;
  written: number;
  writtenChunked: number;
  skipped: number;
  errors: string[];
  message: string;
  opts: RunOpts;
}

export interface RunOpts {
  types?: string[];
  since?: number;
  until?: number;
  dryRun?: boolean;
  /** Versionstamp lower bound — only entries with versionstamp > this get migrated. */
  sinceVersionstamp?: string;
}

const jobs = new Map<string, JobState>();

export function getJob(jobId: string): JobState | null {
  return jobs.get(jobId) ?? null;
}

export function listJobs(): JobState[] {
  return [...jobs.values()].sort((a, b) => b.startedAt - a.startedAt);
}

export function cancelJob(jobId: string): boolean {
  const j = jobs.get(jobId);
  if (!j || j.status !== "running") return false;
  j.cancelled = true;
  return true;
}

// ── Run migration ────────────────────────────────────────────────────────────

function newJobId(): string {
  return "m_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
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

/** Spawn a migration job. Returns immediately with the jobId; the job runs
 *  asynchronously and updates its JobState entry. Poll via getJob(jobId). */
export function startMigration(opts: RunOpts): string {
  const jobId = newJobId();
  const sid = jobId.slice(-6);
  const job: JobState = {
    jobId, startedAt: Date.now(), endedAt: null,
    status: "running", cancelled: false,
    scanned: 0, written: 0, writtenChunked: 0, skipped: 0,
    errors: [], message: "starting…", opts,
  };
  jobs.set(jobId, job);
  // Fire-and-forget; runs in the same isolate.
  (async () => {
    try {
      await runMigrationLoop(job, sid);
    } catch (err) {
      job.status = "error";
      job.message = String(err);
      console.error(`❌ [MIGRATE:${sid}] FATAL`, err);
    } finally {
      job.endedAt = Date.now();
    }
  })();
  return jobId;
}

async function runMigrationLoop(job: JobState, sid: string): Promise<void> {
  const ck = ensureProdKvConfigured();
  if (!ck.ok) { job.status = "error"; job.message = ck.error; return; }

  console.log(`🚀 [MIGRATE:${sid}] start types=${job.opts.types?.join(",") ?? "(all)"} since=${job.opts.since ?? "-"} until=${job.opts.until ?? "-"} dryRun=${!!job.opts.dryRun} sinceVS=${job.opts.sinceVersionstamp ?? "-"}`);

  const kv = openProdReader();
  job.message = "scanning prod KV";
  const chunkedQueued = new Set<string>();

  try {
    for await (const entry of kv.list({ prefix: [] })) {
      if (job.cancelled) break;
      job.scanned++;

      const decoded = decodeKey(entry.key);
      if (!decoded) { job.skipped++; continue; }
      if (SKIP_TYPES.has(decoded.type)) { job.skipped++; continue; }
      if (job.opts.types && !job.opts.types.includes(decoded.type)) { job.skipped++; continue; }

      // Versionstamp delta filter (cutover catch-up)
      if (job.opts.sinceVersionstamp && entry.versionstamp <= job.opts.sinceVersionstamp) {
        job.skipped++; continue;
      }

      // Date filter — only applies if value has a known timestamp field
      if (job.opts.since !== undefined || job.opts.until !== undefined) {
        const ts = valueTimestamp(decoded.type, entry.value);
        if (ts !== null) {
          if (job.opts.since !== undefined && ts < job.opts.since) { job.skipped++; continue; }
          if (job.opts.until !== undefined && ts > job.opts.until) { job.skipped++; continue; }
        }
        // If no timestamp field, fall through and migrate anyway
      }

      if (decoded.isChunkPart) {
        chunkedQueued.add(JSON.stringify({ t: decoded.type, o: decoded.org, k: decoded.keyParts }));
        continue;
      }
      if (decoded.isChunkMeta) {
        chunkedQueued.add(JSON.stringify({ t: decoded.type, o: decoded.org, k: decoded.keyParts }));
        continue;
      }

      if (job.opts.dryRun) { job.skipped++; continue; }

      try {
        await setStored(decoded.type, decoded.org, decoded.keyParts, entry.value);
        job.written++;
      } catch (err) {
        job.errors.push(`${decoded.type}/${decoded.org}/${decoded.keyParts.join(",")}: ${String(err).slice(0, 200)}`);
        if (job.errors.length > 50) job.errors = job.errors.slice(-50);
      }

      if (job.scanned % 200 === 0) {
        console.log(`📝 [MIGRATE:${sid}] scanned=${job.scanned} written=${job.written} skipped=${job.skipped} errors=${job.errors.length}`);
        job.message = `scanning… ${job.scanned} keys`;
      }
    }

    // Second pass — chunked groups
    job.message = `re-assembling ${chunkedQueued.size} chunked groups`;
    console.log(`📦 [MIGRATE:${sid}] reassembling ${chunkedQueued.size} chunked groups`);
    for (const groupStr of chunkedQueued) {
      if (job.cancelled) break;
      const { t: type, o: org, k: keyParts } = JSON.parse(groupStr) as { t: string; o: string; k: (string | number)[] };
      try {
        await migrateChunkedGroup(kv, type, org, keyParts, job.opts.dryRun);
        if (!job.opts.dryRun) job.writtenChunked++;
      } catch (err) {
        job.errors.push(`chunked ${type}/${org}/${keyParts.join(",")}: ${String(err).slice(0, 200)}`);
        if (job.errors.length > 50) job.errors = job.errors.slice(-50);
      }
    }

    // Surface skipped values from decode (bigint/Map/Set on prod side)
    if (kv.skipped.length > 0) {
      const reasons = new Map<string, number>();
      for (const s of kv.skipped) reasons.set(s.reason, (reasons.get(s.reason) ?? 0) + 1);
      for (const [reason, n] of reasons) {
        job.errors.push(`⚠️ ${n} value(s) un-migrated: prod-side ${reason} cannot be JSON-encoded`);
      }
    }
  } finally {
    kv.close();
  }

  if (job.cancelled) {
    job.status = "cancelled";
    job.message = `cancelled at ${job.scanned} keys`;
    console.log(`🛑 [MIGRATE:${sid}] cancelled scanned=${job.scanned} written=${job.written}`);
  } else {
    job.status = "done";
    job.message = `complete — scanned ${job.scanned}, wrote ${job.written} simple + ${job.writtenChunked} chunked`;
    console.log(`✅ [MIGRATE:${sid}] done scanned=${job.scanned} written=${job.written} chunked=${job.writtenChunked} skipped=${job.skipped} errors=${job.errors.length}`);
  }
}

/** Reassemble a chunked group via list-prefix (one or few HTTP calls vs N+1
 *  individual gets). The group's chunk parts share a common prefix; the
 *  meta `_n` key sits at the same level. We list everything under the
 *  prefix and demux meta vs slices in memory. Tries the three known prod
 *  key shapes (TypedStore __TypePascal__, global type, orgKey). */
async function migrateChunkedGroup(
  kv: ProdKvReader, type: string, org: string, keyParts: (string | number)[], dryRun?: boolean,
): Promise<void> {
  const pascal = type.split("-").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
  const candidates: Deno.KvKey[] = [];
  candidates.push([`__${pascal}__`, org, ...keyParts]);
  if (org === "") candidates.push([type, ...keyParts]);
  candidates.push([org, type, ...keyParts]);

  for (const groupPrefix of candidates) {
    let metaTotal: number | null = null;
    const slices: string[] = [];
    let foundAny = false;

    for await (const e of kv.list({ prefix: groupPrefix })) {
      foundAny = true;
      const last = e.key[e.key.length - 1];
      if (last === "_n" && typeof e.value === "number") {
        metaTotal = e.value;
      } else if (typeof last === "number" && typeof e.value === "string") {
        slices[last] = e.value;
      }
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
    if (!dryRun) {
      await setStoredChunked(type, org, keyParts, payload);
    }
    return;
  }
  throw new Error(`chunked group not found at any known key shape for ${type}/${org}/${keyParts.join(",")}`);
}

// ── Snapshot + Verify ────────────────────────────────────────────────────────

export interface Snapshot {
  capturedAt: number;
  versionstamp: string;
  /** Sample key whose stamp was read. */
  sampleKey: string;
}

/** Capture a "high-water mark" of prod KV for cutover delta migration.
 *  We pick the largest versionstamp from a small sample of recent activity. */
export async function captureSnapshot(): Promise<Snapshot> {
  const kv = openProdReader();
  let maxVs = "00000000000000000000";
  let sampleKey = "";
  let scanned = 0;
  try {
    for await (const entry of kv.list({ prefix: [] })) {
      scanned++;
      if (entry.versionstamp > maxVs) {
        maxVs = entry.versionstamp;
        sampleKey = JSON.stringify(entry.key);
      }
      if (scanned >= 5000) break;  // sample first 5k keys
    }
  } finally {
    kv.close();
  }
  return { capturedAt: Date.now(), versionstamp: maxVs, sampleKey };
}

export interface VerifyReport {
  sampled: number;
  matched: number;
  missing: number;
  mismatched: number;
  examples: Array<{ key: string; status: "match" | "missing" | "mismatch"; note?: string }>;
}

/** Sample N random keys from prod KV; for each, read the same value back from
 *  Firestore and compare. Returns a count summary plus up to 20 examples. */
export async function verifyMigration(sampleSize = 50): Promise<VerifyReport> {
  const kv = openProdReader();
  const samples: Array<{ key: Deno.KvKey; value: unknown }> = [];
  try {
    let i = 0;
    for await (const entry of kv.list({ prefix: [] })) {
      i++;
      // Reservoir sampling
      if (samples.length < sampleSize) {
        samples.push({ key: entry.key, value: entry.value });
      } else {
        const j = Math.floor(Math.random() * i);
        if (j < sampleSize) samples[j] = { key: entry.key, value: entry.value };
      }
      if (i > 10000) break;  // cap walk
    }
  } finally {
    kv.close();
  }

  const examples: VerifyReport["examples"] = [];
  let matched = 0, missing = 0, mismatched = 0;
  for (const s of samples) {
    const decoded = decodeKey(s.key);
    if (!decoded || decoded.isChunkPart || decoded.isChunkMeta) {
      // skip chunk fragments — verification on chunked groups requires reassembly
      continue;
    }
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
  return { sampled: samples.length, matched, missing, mismatched, examples };
}
