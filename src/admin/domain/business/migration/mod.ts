/** KV → Firestore migration business logic.
 *
 *  Runs inside the deployed refactor process. Reads remote prod KV via
 *  PROD_KV_URL + KV_ACCESS_TOKEN. Writes Firestore via the same setStored API
 *  the rest of the app uses. Never writes to prod KV.
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

// ── Prod KV connection ───────────────────────────────────────────────────────

export function prodKvUrl(): string {
  return Deno.env.get("PROD_KV_URL") ?? "";
}

export function ensureProdKvConfigured(): { ok: true } | { ok: false; error: string } {
  const url = prodKvUrl();
  if (!url) return { ok: false, error: "PROD_KV_URL env var is not set" };
  if (!Deno.env.get("KV_ACCESS_TOKEN")) {
    return { ok: false, error: "KV_ACCESS_TOKEN env var is not set" };
  }
  if (!url.startsWith("https://api.deno.com/databases/")) {
    return { ok: false, error: `PROD_KV_URL doesn't look like a Deno Deploy KV URL: ${url}` };
  }
  return { ok: true };
}

/** Direct HTTP probe to the KV Connect URL. Bypasses Deno.openKv entirely
 *  so we can see the raw server response — proves whether the token even
 *  reaches the server, what status code comes back, and what the body says.
 *  Per KV Connect protocol: POST to the base URL with a version-negotiation
 *  body. 200 = token valid for this DB. 401/403 = token wrong scope.
 *  404 = URL wrong. */
async function probeProdKv(url: string, token: string): Promise<void> {
  const masked = url.replace(/databases\/([0-9a-f-]+)/i, (_, id) => `databases/${id.slice(0, 8)}…`);
  console.log(`[MIGRATE-PROBE] POST ${masked} with Authorization: Bearer <${token.length}-char token>`);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ supportedVersions: [1, 2, 3] }),
    });
    const bodyText = await res.text();
    const bodyPreview = bodyText.length > 300 ? bodyText.slice(0, 300) + "…" : bodyText;
    console.log(`[MIGRATE-PROBE] status=${res.status} ${res.statusText} body=${JSON.stringify(bodyPreview)}`);
    if (res.status >= 400) {
      console.log(`[MIGRATE-PROBE] ❌ Token+URL combo rejected by KV server. ${res.status === 401 || res.status === 403 ? "Token lacks scope for this database." : res.status === 404 ? "URL is wrong (database not found)." : "Unexpected error."}`);
    } else {
      console.log(`[MIGRATE-PROBE] ✅ Token+URL combo works at HTTP layer. If Deno.openKv still fails, it's a runtime plumbing issue.`);
    }
  } catch (e) {
    console.log(`[MIGRATE-PROBE] ❌ fetch() threw: ${e}`);
  }
}

async function openProdKv(): Promise<Deno.Kv> {
  const url = prodKvUrl();
  if (!url) throw new Error("PROD_KV_URL not configured");
  const tok = Deno.env.get("KV_ACCESS_TOKEN");
  if (!tok) throw new Error("KV_ACCESS_TOKEN env var is not set");

  // Probe first — definitive HTTP-layer diagnostic. Tells us whether the
  // token+URL combo even works against the KV server, independent of any
  // client-library plumbing.
  await probeProdKv(url, tok);

  // Try npm:@deno/kv first — accepts an explicit accessToken, bypassing
  // the DENO_KV_ACCESS_TOKEN env var that Deno Deploy auto-injects with
  // its own internal token (wrong scope for prod KV).
  try {
    const mod = await import("npm:@deno/kv@^0.8.4");
    // deno-lint-ignore no-explicit-any
    const openKvExplicit = (mod as any).openKv as (url: string, opts: { accessToken: string }) => Promise<Deno.Kv>;
    console.log(`[MIGRATE-AUTH] opening prod KV via npm:@deno/kv with explicit accessToken (len=${tok.length})`);
    return await openKvExplicit(url, { accessToken: tok });
  } catch (e) {
    console.log(`[MIGRATE-AUTH] ⚠️ npm:@deno/kv path failed (${(e as Error).message}); falling back to Deno.openKv + env-var bridge`);
    Deno.env.set("DENO_KV_ACCESS_TOKEN", tok);
    return await Deno.openKv(url);
  }
}

// ── Inventory ────────────────────────────────────────────────────────────────

export interface InventoryRow {
  org: string;
  type: string;
  count: number;
  chunkedCount: number;
}

/** Walks every key in prod KV, groups by (org, type), returns counts.
 *  Chunked groups are counted once per group (via _n meta marker). */
export async function inventoryProdKv(): Promise<InventoryRow[]> {
  const kv = await openProdKv();
  const counts = new Map<string, { count: number; chunkedCount: number }>();
  try {
    for await (const entry of kv.list({ prefix: [] })) {
      const decoded = decodeKey(entry.key);
      if (!decoded) continue;
      if (decoded.isChunkPart) continue;
      const k = `${decoded.org}\u0001${decoded.type}`;
      const cur = counts.get(k) ?? { count: 0, chunkedCount: 0 };
      if (decoded.isChunkMeta) cur.chunkedCount++;
      else cur.count++;
      counts.set(k, cur);
    }
  } finally {
    kv.close();
  }
  const rows: InventoryRow[] = [];
  for (const [k, v] of counts) {
    const [org, type] = k.split("\u0001", 2);
    rows.push({ org, type, count: v.count, chunkedCount: v.chunkedCount });
  }
  rows.sort((a, b) => (b.count + b.chunkedCount) - (a.count + a.chunkedCount));
  return rows;
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

  const kv = await openProdKv();
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

async function migrateChunkedGroup(
  kv: Deno.Kv, type: string, org: string, keyParts: (string | number)[], dryRun?: boolean,
): Promise<void> {
  // Try both metadata key shapes — figure out which one the entry actually used.
  const candidates: Deno.KvKey[] = [];
  // Typed-store: ["__TypePascal__", org, ...key, "_n"]
  const pascal = type.split("-").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
  candidates.push([`__${pascal}__`, org, ...keyParts, "_n"]);
  // Global typed: ["type-name", ...key, "_n"]
  if (org === "") candidates.push([type, ...keyParts, "_n"]);
  // orgKey: [org, type, ...key, "_n"]
  candidates.push([org, type, ...keyParts, "_n"]);

  let metaKey: Deno.KvKey | null = null;
  let totalChunks = 0;
  for (const c of candidates) {
    const r = await kv.get<number>(c);
    if (typeof r.value === "number") { metaKey = c; totalChunks = r.value; break; }
  }
  if (!metaKey || totalChunks <= 0) {
    throw new Error(`no _n meta found for chunked group`);
  }
  const slicePrefix = metaKey.slice(0, -1);
  const slices: string[] = [];
  for (let i = 0; i < totalChunks; i++) {
    const r = await kv.get<string>([...slicePrefix, i]);
    if (typeof r.value !== "string") throw new Error(`chunk ${i}/${totalChunks} missing`);
    slices.push(r.value);
  }
  const payload = JSON.parse(slices.join(""));
  if (!dryRun) {
    await setStoredChunked(type, org, keyParts, payload);
  }
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
  const kv = await openProdKv();
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
  const kv = await openProdKv();
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
