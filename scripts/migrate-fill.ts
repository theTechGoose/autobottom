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

async function migrateBucket(
  base: string,
  secret: string,
  type: string,
  org: string,
  args: CliArgs,
): Promise<BucketStats> {
  const stats: BucketStats = { scanned: 0, written: 0, matched: 0, errors: 0, startedAt: Date.now() };
  const prefix = buildPrefix(type, org);
  const bucketLabel = org ? `${type}/${org.slice(0, 8)}…` : type;

  log(`▶ ${bucketLabel} — starting walk (prefix=${JSON.stringify(prefix)})`);

  // Chunked groups can span page boundaries. Buffer them across pages within
  // this bucket walk; flush each as soon as it has its meta + all parts.
  const pendingChunked = new Map<string, ChunkedGroup>();

  let cursor: string | null = null;
  let pageNum = 0;
  while (true) {
    pageNum++;
    let page: { entries: Array<{ key: Deno.KvKey; value: unknown }>; nextCursor: string | null; done: boolean };
    try {
      page = await fetchPage(base, secret, prefix, cursor, { since: args.since ?? undefined });
    } catch (err) {
      stats.errors++;
      log(`  ❌ page ${pageNum} fetch failed: ${String(err).slice(0, 120)}`);
      // Stop this bucket; re-run will resume since writes done before the error are persistent.
      break;
    }

    stats.scanned += page.entries.length;

    // Partition: simple entries get written directly; chunk parts/metas accumulate
    const simpleEntries: Array<{ keyParts: (string | number)[]; value: unknown }> = [];
    for (const e of page.entries) {
      const decoded = decodeKey(e.key);
      if (!decoded) continue;
      if (decoded.isChunkPart) {
        const groupKey = decoded.keyParts.join("/");
        let g = pendingChunked.get(groupKey);
        if (!g) { g = { parts: new Map(), baseKey: decoded.keyParts }; pendingChunked.set(groupKey, g); }
        const partIdx = e.key[e.key.length - 1];
        if (typeof partIdx === "number") g.parts.set(partIdx, e.value);
        continue;
      }
      if (decoded.isChunkMeta) {
        const groupKey = decoded.keyParts.join("/");
        let g = pendingChunked.get(groupKey);
        if (!g) { g = { parts: new Map(), baseKey: decoded.keyParts }; pendingChunked.set(groupKey, g); }
        const n = (e.value as { n?: number })?.n;
        if (typeof n === "number") g.meta = n;
        continue;
      }
      simpleEntries.push({ keyParts: decoded.keyParts, value: e.value });
    }

    // Write simple entries in parallel
    if (simpleEntries.length > 0) {
      await runWithConcurrency(simpleEntries, args.concurrency, async (e) => {
        const keyStr = `${type}/${org}/${e.keyParts.join("/")}`;
        try {
          let fsVal: unknown = null;
          if (!args.force) {
            fsVal = await getStored(type, org, ...e.keyParts);
            if (stableEq(fsVal, e.value)) {
              stats.matched++;
              log(`  = match ${keyStr}`);
              return;
            }
          }
          const reason = fsVal == null ? "missing" : "different";
          if (!args.dryRun) {
            await setStored(type, org, e.keyParts, e.value as Record<string, unknown> | null);
          }
          stats.written++;
          log(`  ${args.dryRun ? "(dry) would write" : "✓ wrote"} ${keyStr} (was ${reason})`);
        } catch (err) {
          stats.errors++;
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
      // Remove from pending immediately so they aren't reprocessed
      for (const k of completedKeys) pendingChunked.delete(k);

      await runWithConcurrency(completedEntries, args.concurrency, async ({ groupKey, group }) => {
        const keyStr = `${type}/${org}/${groupKey}`;
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
            fsVal = await getStoredChunked(type, org, ...group.baseKey);
            if (stableEq(fsVal, prodValue)) {
              stats.matched++;
              log(`  = match (chunked, ${group.meta} parts) ${keyStr}`);
              return;
            }
          }
          const reason = fsVal == null ? "missing" : "different";
          if (!args.dryRun) {
            await setStoredChunked(type, org, group.baseKey, prodValue);
          }
          stats.written++;
          log(`  ${args.dryRun ? "(dry) would write" : "✓ wrote"} chunked (${group.meta} parts) ${keyStr} (was ${reason})`);
        } catch (err) {
          stats.errors++;
          log(`  ❌ chunked ${keyStr}: ${String(err).slice(0, 100)}`);
        }
      });
    }

    log(`  page ${pageNum}: scanned=${page.entries.length} written-so-far=${stats.written} matched-so-far=${stats.matched} errors=${stats.errors} pending-chunked=${pendingChunked.size}`);

    if (page.done || !page.nextCursor) break;
    cursor = page.nextCursor;
  }

  if (pendingChunked.size > 0) {
    log(`  ⚠ ${pendingChunked.size} chunked group(s) incomplete (missing meta or parts) — not written`);
    stats.errors += pendingChunked.size;
  }

  const elapsedMs = Date.now() - stats.startedAt;
  log(`✓ ${bucketLabel} COMPLETE: scanned=${stats.scanned} written=${stats.written} matched=${stats.matched} errors=${stats.errors} in ${formatDuration(elapsedMs)}`);
  return stats;
}

// ── Bucket discovery ────────────────────────────────────────────────────────

/** Walk prod KV in keysOnly mode to enumerate every (type, org) bucket
 *  that exists. Returns buckets sorted by total prod-key count ascending
 *  (small ones first so the operator sees fast progress at the start).
 *
 *  When --types is given: walks ONLY those type prefixes (much faster —
 *  for --types=user this scans ~30 keys, not 530K). When --types is
 *  absent: walks all of prod KV with empty prefix. */
async function discoverBuckets(
  base: string,
  secret: string,
  args: CliArgs,
): Promise<Array<{ type: string; org: string; approxKeys: number }>> {
  const counts = new Map<string, { type: string; org: string; n: number }>();

  // Each prefix to walk. With --types, we walk just those type prefixes.
  // We try BOTH `__type__` (TypedStore-wrapped) and `type` (truly-global)
  // forms because we can't know upfront which is in use.
  const prefixesToWalk: Array<{ label: string; prefix: Deno.KvKey }> = args.types
    ? args.types.flatMap((t) => [
        { label: t, prefix: [`__${t}__`] as Deno.KvKey },
        { label: `${t} (global)`, prefix: [t] as Deno.KvKey },
      ])
    : [{ label: "(all)", prefix: [] as Deno.KvKey }];

  log(`▶ discovering buckets via prod kv-export keysOnly walk (${prefixesToWalk.length} prefix${prefixesToWalk.length === 1 ? "" : "es"})…`);

  for (const { label, prefix } of prefixesToWalk) {
    log(`  walking prefix=${JSON.stringify(prefix)} for ${label}…`);
    let cursor: string | null = null;
    let pageNum = 0;
    let prefixKeys = 0;
    while (true) {
      pageNum++;
      const res = await fetch(`${base}/admin/kv-export`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ prefix, cursor, limit: 1000, keysOnly: true }),
      });
      if (!res.ok) throw new Error(`kv-export discovery HTTP ${res.status} for prefix ${JSON.stringify(prefix)}`);
      const data = await res.json() as ExportPageResponse;
      if (!data.ok) throw new Error(`kv-export discovery error: ${data.error}`);
      prefixKeys += data.entries.length;
      for (const e of data.entries) {
        const decoded = decodeKey(e.key);
        if (!decoded) continue;
        const bk = `${decoded.type}|${decoded.org}`;
        const existing = counts.get(bk);
        if (existing) existing.n++;
        else counts.set(bk, { type: decoded.type, org: decoded.org, n: 1 });
      }
      log(`    ${label}: page ${pageNum} +${data.entries.length} keys (total ${prefixKeys}, buckets ${counts.size})`);
      if (data.done || !data.nextCursor) break;
      cursor = data.nextCursor;
    }
    log(`  ${label}: ${prefixKeys} keys scanned in ${pageNum} page${pageNum === 1 ? "" : "s"}`);
  }
  log(`  discovery complete: ${counts.size} bucket${counts.size === 1 ? "" : "s"} found`);

  let buckets = [...counts.values()].map((b) => ({ type: b.type, org: b.org, approxKeys: b.n }));
  // --types filter applied at prefix level above; redundant filter here is a safety net
  if (args.types) {
    const allow = new Set(args.types);
    buckets = buckets.filter((b) => allow.has(b.type));
  }
  if (args.org) {
    buckets = buckets.filter((b) => b.org === args.org);
    log(`  --org filter: ${buckets.length} buckets selected`);
  }
  // Small buckets first so the operator sees activity quickly
  buckets.sort((a, b) => a.approxKeys - b.approxKeys);
  return buckets;
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

  const buckets = await discoverBuckets(base, secret, args);
  if (buckets.length === 0) {
    log("⚠ no buckets matched filters — nothing to do");
    Deno.exit(0);
  }
  log(`▶ migrating ${buckets.length} bucket(s) (${buckets.reduce((s, b) => s + b.approxKeys, 0).toLocaleString()} approx keys total)`);

  const totals: BucketStats = { scanned: 0, written: 0, matched: 0, errors: 0, startedAt };
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i];
    log(`── [${i + 1}/${buckets.length}] ${b.type}${b.org ? "/" + b.org.slice(0, 8) + "…" : ""} (~${b.approxKeys} keys)`);
    const s = await migrateBucket(base, secret, b.type, b.org, args);
    totals.scanned += s.scanned;
    totals.written += s.written;
    totals.matched += s.matched;
    totals.errors += s.errors;
  }

  const totalMs = Date.now() - startedAt;
  log("");
  log(args.dryRun ? "✅ DRY-RUN COMPLETE (no writes performed)" : "✅ MIGRATION COMPLETE");
  log(`  buckets:        ${buckets.length}`);
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
