#!/usr/bin/env -S deno run -A --env --unstable-raw-imports
/**
 * migrate-fill.ts — local CLI to crawl prod KV and write to Firestore.
 *
 * Streams page-by-page from prod's /admin/kv-export endpoint into Firestore
 * via setStored / setStoredChunked. Idempotent — `getStored` compare before
 * each write, so re-runs are safe and a clean re-run is the proof of
 * completion (zero writes, all matches).
 *
 * Usage:
 *   deno run -A --env --unstable-raw-imports scripts/migrate-fill.ts [options]
 *
 * Options:
 *   --types=<a,b,c>       Comma-separated type filter (default: all)
 *   --since=<YYYY-MM-DD>  Only entries with completedAt >= this date
 *                         (only honored by date-filterable types)
 *   --dry-run             Read prod, log decisions, but don't write
 *   --force               Skip getStored compare; always setStored
 *   --concurrency=N       Parallel writes per page (default: 20)
 *   --org=<orgId>         Limit to a single org's data (default: all orgs)
 *
 * Required env (loaded from .env):
 *   PROD_EXPORT_BASE_URL
 *   KV_EXPORT_SECRET
 *   FIRESTORE_PROJECT_ID + FIRESTORE_CLIENT_EMAIL + FIRESTORE_PRIVATE_KEY
 *     (whatever the existing setup uses — same as the deployed app)
 */

import {
  setStored,
  setStoredChunked,
  getStored,
  getStoredChunked,
  listStoredWithKeys,
} from "@core/data/firestore/mod.ts";
import { decodeKey } from "@admin/domain/business/migration/mod.ts";

// ── CLI argument parsing ────────────────────────────────────────────────────

interface CliArgs {
  types: string[] | null;          // null = all
  since: number | null;            // ms-since-epoch
  dryRun: boolean;
  force: boolean;
  concurrency: number;
  org: string | null;              // single-org filter for matching
  orgs: string[] | null;           // explicit org list for prefix enumeration
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    types: null,
    since: null,
    dryRun: false,
    force: false,
    concurrency: 20,
    org: null,
    orgs: null,
  };
  for (const a of argv) {
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--force") args.force = true;
    else if (a.startsWith("--types=")) {
      args.types = a.slice(8).split(",").map((s) => s.trim()).filter(Boolean);
    } else if (a.startsWith("--since=")) {
      const v = a.slice(8);
      const ms = /^\d{4}-\d{2}-\d{2}$/.test(v) ? Date.parse(`${v}T00:00:00Z`) : Date.parse(v);
      if (Number.isNaN(ms)) throw new Error(`bad --since: ${v}`);
      args.since = ms;
    } else if (a.startsWith("--concurrency=")) {
      args.concurrency = Math.max(1, parseInt(a.slice(14), 10) || 20);
    } else if (a.startsWith("--org=")) {
      args.org = a.slice(6);
    } else if (a.startsWith("--orgs=")) {
      args.orgs = a.slice(7).split(",").map((s) => s.trim()).filter(Boolean);
    } else if (a === "--help" || a === "-h") {
      console.log(USAGE);
      Deno.exit(0);
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return args;
}

const USAGE = `migrate-fill — stream prod KV → Firestore

Usage:
  deno run -A --env --unstable-raw-imports scripts/migrate-fill.ts [options]

Options:
  --types=<a,b,c>       Comma-separated type filter (default: all known types)
  --since=<YYYY-MM-DD>  Only entries with completedAt >= this date
  --org=<orgId>         Limit to a single org
  --dry-run             Don't write to Firestore
  --force               Skip getStored compare; always write
  --concurrency=N       Parallel writes per page (default: 20)`;

// ── Logging ─────────────────────────────────────────────────────────────────

function ts(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function log(msg: string): void {
  console.log(`[${ts()}] ${msg}`);
}

// ── HTTP wrapper around prod's /admin/kv-export ─────────────────────────────

interface ExportPageResponse {
  ok: boolean;
  entries: Array<{ key: Deno.KvKey; value: unknown; versionstamp: string }>;
  nextCursor?: string;
  done: boolean;
  error?: string;
}

async function fetchPage(
  base: string,
  secret: string,
  prefix: Deno.KvKey,
  cursor: string | null,
  opts: { since?: number; limit?: number } = {},
): Promise<{ entries: Array<{ key: Deno.KvKey; value: unknown }>; nextCursor: string | null; done: boolean }> {
  const body: Record<string, unknown> = { prefix, limit: opts.limit ?? 300 };
  if (cursor) body.cursor = cursor;
  if (opts.since !== undefined) body.since = opts.since;
  const res = await fetch(`${base}/admin/kv-export`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`kv-export HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json() as ExportPageResponse;
  if (!data.ok) throw new Error(`kv-export error: ${data.error ?? "unknown"}`);
  return {
    entries: data.entries.map((e) => ({ key: e.key, value: decodeValue(e.value) })),
    nextCursor: data.nextCursor ?? null,
    done: data.done,
  };
}

/** Reverse the JSON-tagging that prod's /admin/kv-export applies to non-JSON
 *  values (Uint8Array, Date). Mirrors the existing decodeValue in mod.ts. */
function decodeValue(v: unknown): unknown {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(decodeValue);
  const obj = v as Record<string, unknown>;
  const tag = obj["__kvType"];
  if (typeof tag === "string") {
    if (tag === "u8a" && typeof obj["data"] === "string") {
      const bin = atob(obj["data"]);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    if (tag === "date" && typeof obj["iso"] === "string") return new Date(obj["iso"]);
    if (tag === "skipped") return null;
    return v;
  }
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(obj)) out[k] = decodeValue(val);
  return out;
}

// ── Stable JSON equality ────────────────────────────────────────────────────

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

function stableEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  return stableStringify(a) === stableStringify(b);
}

// ── Concurrency limiter ─────────────────────────────────────────────────────

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = new Array(Math.min(concurrency, items.length)).fill(0).map(async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

// ── Bucket prefix construction ──────────────────────────────────────────────

/** Build the prod KV prefix to walk for a (type, org) bucket.
 *  - If org is empty, the keys are stored as [type, ...keyParts] (truly global).
 *  - Otherwise keys are TypedStore-wrapped: [`__type__`, org, ...keyParts]. */
function buildPrefix(type: string, org: string): Deno.KvKey {
  if (!org) return [type] as Deno.KvKey;
  return [`__${type}__`, org] as Deno.KvKey;
}

// ── Per-bucket migration ────────────────────────────────────────────────────

interface BucketStats {
  scanned: number;
  written: number;
  matched: number;
  errors: number;
  startedAt: number;
}

interface ChunkedGroup {
  meta?: number;                            // total parts (from `_n` key)
  parts: Map<number, unknown>;              // partIdx → part value
  baseKey: (string | number)[];             // key without chunk suffix
}

// Per-type debug-logging gates: only log the first chunk part / meta seen
// for each type so we can verify decoding without flooding the terminal.
const loggedChunkPartShape = new Set<string>();
const loggedChunkMetaShape = new Set<string>();

interface SharedStats {
  stats: BucketStats;
  pendingChunked: Map<string, ChunkedGroup & { type: string; org: string }>;
  perBucket: Map<string, { scanned: number; written: number; matched: number; errors: number }>;
}

/** Walk a single prod KV prefix and write matching entries to Firestore.
 *  Shares stats + chunked-group buffer across multiple concurrent walks
 *  (different prefixes may yield parts of the same chunked group only if
 *  the prefix scoping is wrong, which we handle by keying buffer entries
 *  by full type/org/baseKey).
 *
 *  Returns when the prefix walk is exhausted (page.done or no nextCursor). */
async function walkPrefix(
  base: string,
  secret: string,
  prefix: Deno.KvKey,
  prefixLabel: string,
  shared: SharedStats,
  args: CliArgs,
): Promise<void> {
  const { stats, pendingChunked, perBucket } = shared;
  const allowTypes = args.types ? new Set(args.types) : null;
  const allowOrg = args.org;

  log(`▶ [${prefixLabel}] starting walk (prefix=${JSON.stringify(prefix)})`);

  let cursor: string | null = null;
  let pageNum = 0;
  while (true) {
    pageNum++;
    let page: { entries: Array<{ key: Deno.KvKey; value: unknown }>; nextCursor: string | null; done: boolean };
    try {
      page = await fetchPage(base, secret, prefix, cursor, { since: args.since ?? undefined });
    } catch (err) {
      stats.errors++;
      log(`  ❌ [${prefixLabel}] page ${pageNum} fetch failed: ${String(err).slice(0, 120)}`);
      break;
    }
    stats.scanned += page.entries.length;

    // Decode + filter + partition
    const simpleEntries: Array<{ type: string; org: string; keyParts: (string | number)[]; value: unknown }> = [];
    let pageDecoded = 0, pageFilteredOut = 0;
    for (const e of page.entries) {
      const decoded = decodeKey(e.key);
      if (!decoded) continue;
      pageDecoded++;
      if (allowTypes && !allowTypes.has(decoded.type)) { pageFilteredOut++; continue; }
      if (allowOrg && decoded.org !== allowOrg) { pageFilteredOut++; continue; }

      const bk = `${decoded.type}|${decoded.org}`;
      let pb = perBucket.get(bk);
      if (!pb) { pb = { scanned: 0, written: 0, matched: 0, errors: 0 }; perBucket.set(bk, pb); }
      pb.scanned++;

      if (decoded.isChunkPart) {
        const groupKey = `${bk}|${decoded.keyParts.join("/")}`;
        let g = pendingChunked.get(groupKey);
        if (!g) { g = { type: decoded.type, org: decoded.org, parts: new Map(), baseKey: decoded.keyParts }; pendingChunked.set(groupKey, g); }
        const partIdx = e.key[e.key.length - 1];
        // Debug: log the first chunk part shape per type so we can verify our detection.
        if (!loggedChunkPartShape.has(decoded.type)) {
          loggedChunkPartShape.add(decoded.type);
          const valuePreview = typeof e.value === "string" ? `string(${e.value.length} chars)` : typeof e.value === "object" ? `object: ${JSON.stringify(e.value).slice(0, 120)}` : `${typeof e.value}: ${String(e.value).slice(0, 80)}`;
          log(`  [debug] first chunk PART for type=${decoded.type}: key=${JSON.stringify(e.key)} (partIdx=${String(partIdx)}, type=${typeof partIdx}) value=${valuePreview}`);
        }
        if (typeof partIdx === "number") g.parts.set(partIdx, e.value);
        continue;
      }
      if (decoded.isChunkMeta) {
        const groupKey = `${bk}|${decoded.keyParts.join("/")}`;
        let g = pendingChunked.get(groupKey);
        if (!g) { g = { type: decoded.type, org: decoded.org, parts: new Map(), baseKey: decoded.keyParts }; pendingChunked.set(groupKey, g); }
        // Permissive meta extraction. Tries multiple known shapes.
        // Logs the first meta seen per type so we can debug if detection fails.
        const v = e.value;
        let n: number | undefined;
        if (typeof v === "number") n = v;
        else if (v && typeof v === "object") {
          const r = v as Record<string, unknown>;
          if (typeof r.n === "number") n = r.n;
          else if (typeof r.totalChunks === "number") n = r.totalChunks;
          else if (typeof r.count === "number") n = r.count;
          else if (typeof r.chunks === "number") n = r.chunks;
          else if (typeof r.parts === "number") n = r.parts;
          else if (typeof r.length === "number") n = r.length;
        }
        if (!loggedChunkMetaShape.has(decoded.type)) {
          loggedChunkMetaShape.add(decoded.type);
          log(`  [debug] first chunk META for type=${decoded.type}: key=${JSON.stringify(e.key)} value=${JSON.stringify(e.value).slice(0, 200)} → resolved n=${n}`);
        }
        if (typeof n === "number") g.meta = n;
        continue;
      }
      simpleEntries.push({ type: decoded.type, org: decoded.org, keyParts: decoded.keyParts, value: e.value });
    }

    log(`  [${prefixLabel}] page ${pageNum}: +${page.entries.length} keys, ${pageDecoded} decoded, ${pageFilteredOut} filtered out, ${simpleEntries.length} simple writes queued, ${pendingChunked.size} chunked groups buffered`);

    // Write simple entries in parallel
    if (simpleEntries.length > 0) {
      await runWithConcurrency(simpleEntries, args.concurrency, async (e) => {
        const keyStr = `${e.type}/${e.org}/${e.keyParts.join("/")}`;
        const pb = perBucket.get(`${e.type}|${e.org}`)!;
        try {
          let fsVal: unknown = null;
          if (!args.force) {
            fsVal = await getStored(e.type, e.org, ...e.keyParts);
            if (stableEq(fsVal, e.value)) {
              stats.matched++; pb.matched++;
              log(`  = match ${keyStr}`);
              return;
            }
          }
          const reason = fsVal == null ? "missing" : "different";
          if (!args.dryRun) {
            await setStored(e.type, e.org, e.keyParts, e.value as Record<string, unknown> | null);
          }
          stats.written++; pb.written++;
          log(`  ${args.dryRun ? "(dry) would write" : "✓ wrote"} ${keyStr} (was ${reason})`);
        } catch (err) {
          stats.errors++; pb.errors++;
          log(`  ❌ write ${keyStr}: ${String(err).slice(0, 100)}`);
        }
      });
    }

    // Process completed chunked groups (meta arrived + all parts present)
    const completedKeys: string[] = [];
    for (const [groupKey, g] of pendingChunked) {
      if (g.meta == null || g.parts.size < g.meta) continue;
      completedKeys.push(groupKey);
    }
    if (completedKeys.length > 0) {
      const completedEntries = completedKeys.map((k) => ({ groupKey: k, group: pendingChunked.get(k)! }));
      for (const k of completedKeys) pendingChunked.delete(k);

      await runWithConcurrency(completedEntries, args.concurrency, async ({ group }) => {
        const keyStr = `${group.type}/${group.org}/${group.baseKey.join("/")}`;
        const pb = perBucket.get(`${group.type}|${group.org}`)!;
        try {
          const sortedParts: string[] = [];
          for (let i = 0; i < group.meta!; i++) {
            const p = group.parts.get(i);
            if (p === undefined) throw new Error(`missing chunk part ${i}/${group.meta}`);
            sortedParts.push(p as string);
          }
          const prodValue = JSON.parse(sortedParts.join(""));
          let fsVal: unknown = null;
          if (!args.force) {
            fsVal = await getStoredChunked(group.type, group.org, ...group.baseKey);
            if (stableEq(fsVal, prodValue)) {
              stats.matched++; pb.matched++;
              log(`  = match (chunked, ${group.meta} parts) ${keyStr}`);
              return;
            }
          }
          const reason = fsVal == null ? "missing" : "different";
          if (!args.dryRun) {
            await setStoredChunked(group.type, group.org, group.baseKey, prodValue);
          }
          stats.written++; pb.written++;
          log(`  ${args.dryRun ? "(dry) would write" : "✓ wrote"} chunked (${group.meta} parts) ${keyStr} (was ${reason})`);
        } catch (err) {
          stats.errors++; pb.errors++;
          log(`  ❌ chunked ${keyStr}: ${String(err).slice(0, 100)}`);
        }
      });
    }

    // Spot-check: pick the first simple write + first chunked write from this
    // page's actual writes, read them back via the same getStored/getStoredChunked
    // the deployed refactor branch uses, and confirm round-trip. If this passes,
    // the FORMAT is correct (same encode/decode both sides). Logs visibly so
    // the operator can see write→read→match working live.
    if (!args.dryRun && simpleEntries.length > 0) {
      const sample = simpleEntries[0];
      const keyStr = `${sample.type}/${sample.org}/${sample.keyParts.join("/")}`;
      try {
        const readBack = await getStored(sample.type, sample.org, ...sample.keyParts);
        if (stableEq(readBack, sample.value)) {
          log(`  🔍 SPOT-CHECK pass — read-back matches write for ${keyStr}`);
        } else {
          log(`  ⚠️  SPOT-CHECK MISMATCH — wrote ${keyStr} but read-back differs (format issue?)`);
          stats.errors++;
        }
      } catch (err) {
        log(`  ⚠️  SPOT-CHECK error for ${keyStr}: ${String(err).slice(0, 100)}`);
      }
    }
    if (!args.dryRun && completedKeys.length > 0) {
      const sampleGroupKey = completedKeys[0];
      // Re-look up the group from the (now-cleared) map by examining what we
      // just deleted. Re-query Firestore via the same path the refactor reads.
      const parts = sampleGroupKey.split("|");
      // groupKey format: `${type}|${org}|${baseKey.join("/")}`
      const t = parts[0], o = parts[1];
      const baseKeyStr = parts.slice(2).join("|");
      const keyStr = `${t}/${o}/${baseKeyStr}`;
      try {
        const baseKeyArr = baseKeyStr.split("/");
        const readBack = await getStoredChunked(t, o, ...baseKeyArr);
        if (readBack !== null) {
          log(`  🔍 SPOT-CHECK pass — chunked read-back exists for ${keyStr}`);
        } else {
          log(`  ⚠️  SPOT-CHECK chunked MISSING — wrote ${keyStr} but read-back is null (format issue?)`);
          stats.errors++;
        }
      } catch (err) {
        log(`  ⚠️  SPOT-CHECK chunked error for ${keyStr}: ${String(err).slice(0, 100)}`);
      }
    }

    log(`  [${prefixLabel}] page ${pageNum} done: scanned-total=${stats.scanned} written-total=${stats.written} matched-total=${stats.matched} errors-total=${stats.errors} pending-chunked=${pendingChunked.size}`);

    if (page.done || !page.nextCursor) break;
    cursor = page.nextCursor;
  }
  log(`✓ [${prefixLabel}] walk complete (${pageNum} pages)`);
}

/** Discover orgs from multiple sources, in order:
 *  1. Walk [__org__] keysOnly (TypedStore-wrapped — most common)
 *  2. Walk [org] keysOnly (truly global storage)
 *  3. listStored("org", "") from Firestore (whatever's already migrated)
 *
 *  Returns the union — used to seed per-(org, type) prefix walks for
 *  org-first storage shapes like user, app-event, etc. */
async function listOrgs(base: string, secret: string): Promise<string[]> {
  const orgs = new Set<string>();

  // Source 1: prod KV [__org__] walk
  await walkKeysOnlyForOrgs(base, secret, ["__org__"], orgs);
  if (orgs.size > 0) {
    log(`  found ${orgs.size} orgs via [__org__] walk`);
    return [...orgs];
  }

  // Source 2: prod KV [org] walk
  await walkKeysOnlyForOrgs(base, secret, ["org"], orgs);
  if (orgs.size > 0) {
    log(`  found ${orgs.size} orgs via [org] walk`);
    return [...orgs];
  }

  // Source 3: Firestore listStoredWithKeys for any already-migrated orgs
  try {
    const rows = await listStoredWithKeys<unknown>("org", "", { limit: 100 });
    for (const r of rows) {
      // The doc key array's last element is the orgId
      const orgId = String(r.key[r.key.length - 1] ?? "");
      if (orgId) orgs.add(orgId);
    }
    if (orgs.size > 0) {
      log(`  found ${orgs.size} orgs via Firestore listStored("org", "")`);
      return [...orgs];
    }
  } catch (err) {
    log(`  Firestore org enumeration failed: ${String(err).slice(0, 80)}`);
  }

  return [...orgs];
}

async function walkKeysOnlyForOrgs(base: string, secret: string, prefix: Deno.KvKey, orgs: Set<string>): Promise<void> {
  let cursor: string | null = null;
  while (true) {
    const res = await fetch(`${base}/admin/kv-export`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prefix, cursor, limit: 1000, keysOnly: true }),
    });
    if (!res.ok) return;
    const data = await res.json() as ExportPageResponse;
    if (!data.ok) return;
    for (const e of data.entries) {
      if (Array.isArray(e.key) && e.key.length >= 2) {
        const orgId = String(e.key[1]);
        if (orgId) orgs.add(orgId);
      }
    }
    if (data.done || !data.nextCursor) break;
    cursor = data.nextCursor;
  }
}

/** Drive multiple prefix walks in parallel and aggregate stats. */
async function streamMigrate(
  base: string,
  secret: string,
  args: CliArgs,
): Promise<BucketStats> {
  const shared: SharedStats = {
    stats: { scanned: 0, written: 0, matched: 0, errors: 0, startedAt: Date.now() },
    pendingChunked: new Map(),
    perBucket: new Map(),
  };

  // Build prefix list. With --types: walk [__type__], [type], and [orgId, type]
  // for each org to cover all three storage shapes. Without --types: one big
  // walk of all of prod KV with empty prefix.
  const prefixes: Array<{ label: string; prefix: Deno.KvKey }> = [];
  if (args.types && args.types.length > 0) {
    let orgs: string[] = [];
    if (args.orgs) {
      orgs = args.orgs;
      log(`▶ using ${orgs.length} explicit --orgs: ${orgs.join(", ")}`);
    } else {
      log("▶ enumerating orgs to seed per-(org, type) walks…");
      try {
        orgs = await listOrgs(base, secret);
        if (orgs.length === 0) {
          log(`  ⚠ no orgs found via any source — pass --orgs=<a,b,c> to specify explicitly`);
        } else {
          log(`  resolved ${orgs.length} orgs: ${orgs.join(", ")}`);
        }
      } catch (err) {
        log(`  ⚠ org enumeration failed: ${String(err).slice(0, 100)}`);
      }
    }

    for (const t of args.types) {
      prefixes.push({ label: `__${t}__`, prefix: [`__${t}__`] as Deno.KvKey });
      prefixes.push({ label: `${t} (global)`, prefix: [t] as Deno.KvKey });
      for (const org of orgs) {
        prefixes.push({ label: `${org.slice(0, 8)}…/${t}`, prefix: [org, t] as Deno.KvKey });
      }
    }
    log(`▶ ${prefixes.length} prefix${prefixes.length === 1 ? "" : "es"} queued (parallel walks of ${PARALLEL_WALKS})`);
  } else {
    prefixes.push({ label: "all-of-prod", prefix: [] as Deno.KvKey });
    log("▶ no --types filter — walking all of prod KV with empty prefix");
  }

  // Run walks in parallel batches
  await runWithConcurrency(prefixes, PARALLEL_WALKS, ({ label, prefix }) => walkPrefix(base, secret, prefix, label, shared, args));

  if (shared.pendingChunked.size > 0) {
    log(`⚠ ${shared.pendingChunked.size} chunked group(s) incomplete at end of walk (missing meta or parts)`);
    for (const [, g] of shared.pendingChunked) {
      log(`  incomplete: ${g.type}/${g.org}/${g.baseKey.join("/")} (have ${g.parts.size} parts, meta=${g.meta ?? "none"})`);
    }
    shared.stats.errors += shared.pendingChunked.size;
  }

  // Per-bucket summary
  log(``);
  log(`▶ per-bucket summary (${shared.perBucket.size} buckets touched):`);
  const sortedBuckets = [...shared.perBucket.entries()].sort((a, b) => b[1].written - a[1].written);
  for (const [bk, pb] of sortedBuckets) {
    log(`  ${bk.replace("|", "/")}: scanned=${pb.scanned} written=${pb.written} matched=${pb.matched} errors=${pb.errors}`);
  }

  return shared.stats;
}

const PARALLEL_WALKS = 4;

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s - m * 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m - h * 60}m`;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(Deno.args);

  const base = (Deno.env.get("PROD_EXPORT_BASE_URL") ?? "").replace(/\/+$/, "");
  const secret = (Deno.env.get("KV_EXPORT_SECRET") ?? "").trim();
  if (!base) throw new Error("PROD_EXPORT_BASE_URL env var is not set (check .env)");
  if (!secret) throw new Error("KV_EXPORT_SECRET env var is not set (check .env)");
  if (!base.startsWith("https://")) throw new Error(`PROD_EXPORT_BASE_URL must start with https://: ${base}`);

  const startedAt = Date.now();
  log("starting migrate-fill");
  log(`  prod:        ${base}`);
  log(`  types:       ${args.types ? args.types.join(",") : "(all)"}`);
  log(`  since:       ${args.since ? new Date(args.since).toISOString() : "(none)"}`);
  log(`  org:         ${args.org ?? "(all)"}`);
  log(`  dry-run:     ${args.dryRun}`);
  log(`  force:       ${args.force}`);
  log(`  concurrency: ${args.concurrency}`);

  const totals = await streamMigrate(base, secret, args);
  const totalMs = Date.now() - startedAt;
  log("");
  log(args.dryRun ? "✅ DRY-RUN COMPLETE (no writes performed)" : "✅ MIGRATION COMPLETE");
  log(`  total scanned:  ${totals.scanned.toLocaleString()}`);
  log(`  total written:  ${totals.written.toLocaleString()}`);
  log(`  total matched:  ${totals.matched.toLocaleString()}`);
  log(`  total errors:   ${totals.errors.toLocaleString()}`);
  log(`  total runtime:  ${formatDuration(totalMs)}`);

  Deno.exit(totals.errors > 0 ? 1 : 0);
}

if (import.meta.main) {
  try {
    await main();
  } catch (err) {
    console.error(`[${ts()}] ❌ FATAL: ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof Error && err.stack) console.error(err.stack);
    Deno.exit(1);
  }
}
