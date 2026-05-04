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
} from "@core/data/firestore/mod.ts";
import { decodeKey } from "@admin/domain/business/migration/mod.ts";

// ── CLI argument parsing ────────────────────────────────────────────────────

interface CliArgs {
  types: string[] | null;          // null = all
  since: number | null;            // ms-since-epoch
  dryRun: boolean;
  force: boolean;
  concurrency: number;
  org: string | null;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    types: null,
    since: null,
    dryRun: false,
    force: false,
    concurrency: 20,
    org: null,
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

/** Single-pass migration. Walks all of prod KV with one paginated cursor,
 *  decoding each entry to (type, org, keyParts, isChunkPart, isChunkMeta).
 *  Filters by --types / --org / --since inline, writes matching entries
 *  to Firestore as it goes. Chunked groups buffered in pendingChunked map
 *  (keyed by type/org/baseKey) across page boundaries; flushed when meta
 *  + all parts arrive. Avoids the chicken-and-egg discovery problem of
 *  not knowing which orgs exist before walking — same walk discovers and
 *  writes simultaneously. */
async function streamMigrate(
  base: string,
  secret: string,
  args: CliArgs,
): Promise<BucketStats> {
  const stats: BucketStats = { scanned: 0, written: 0, matched: 0, errors: 0, startedAt: Date.now() };
  const allowTypes = args.types ? new Set(args.types) : null;
  const allowOrg = args.org;

  // Chunked groups span page boundaries. Buffered globally; map key includes
  // type+org so different buckets don't collide.
  const pendingChunked = new Map<string, ChunkedGroup & { type: string; org: string }>();
  // Per (type|org) running counters for visibility
  const perBucket = new Map<string, { scanned: number; written: number; matched: number; errors: number }>();

  log(`▶ streaming walk of prod KV (single pass, decode + write inline)`);
  if (allowTypes) log(`  filter: types=${[...allowTypes].join(",")}`);
  if (allowOrg) log(`  filter: org=${allowOrg}`);

  let cursor: string | null = null;
  let pageNum = 0;
  while (true) {
    pageNum++;
    let page: { entries: Array<{ key: Deno.KvKey; value: unknown }>; nextCursor: string | null; done: boolean };
    try {
      page = await fetchPage(base, secret, [] as Deno.KvKey, cursor, { since: args.since ?? undefined });
    } catch (err) {
      stats.errors++;
      log(`  ❌ page ${pageNum} fetch failed: ${String(err).slice(0, 120)}`);
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
        if (typeof partIdx === "number") g.parts.set(partIdx, e.value);
        continue;
      }
      if (decoded.isChunkMeta) {
        const groupKey = `${bk}|${decoded.keyParts.join("/")}`;
        let g = pendingChunked.get(groupKey);
        if (!g) { g = { type: decoded.type, org: decoded.org, parts: new Map(), baseKey: decoded.keyParts }; pendingChunked.set(groupKey, g); }
        const n = (e.value as { n?: number })?.n;
        if (typeof n === "number") g.meta = n;
        continue;
      }
      simpleEntries.push({ type: decoded.type, org: decoded.org, keyParts: decoded.keyParts, value: e.value });
    }

    log(`  page ${pageNum}: +${page.entries.length} keys, ${pageDecoded} decoded, ${pageFilteredOut} filtered out, ${simpleEntries.length} simple writes queued, ${pendingChunked.size} chunked groups buffered`);

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

    log(`  page ${pageNum} done: scanned-total=${stats.scanned} written-total=${stats.written} matched-total=${stats.matched} errors-total=${stats.errors} pending-chunked=${pendingChunked.size}`);

    if (page.done || !page.nextCursor) break;
    cursor = page.nextCursor;
  }

  if (pendingChunked.size > 0) {
    log(`⚠ ${pendingChunked.size} chunked group(s) incomplete at end of walk (missing meta or parts)`);
    for (const [, g] of pendingChunked) {
      log(`  incomplete: ${g.type}/${g.org}/${g.baseKey.join("/")} (have ${g.parts.size} parts, meta=${g.meta ?? "none"})`);
    }
    stats.errors += pendingChunked.size;
  }

  // Per-bucket summary
  log(``);
  log(`▶ per-bucket summary (${perBucket.size} buckets touched):`);
  const sortedBuckets = [...perBucket.entries()].sort((a, b) => b[1].written - a[1].written);
  for (const [bk, pb] of sortedBuckets) {
    log(`  ${bk.replace("|", "/")}: scanned=${pb.scanned} written=${pb.written} matched=${pb.matched} errors=${pb.errors}`);
  }

  return stats;
}

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
