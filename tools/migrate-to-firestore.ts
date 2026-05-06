/** One-shot migration: prod Deno KV → Firestore.
 *
 *  Read-only against prod KV. Writes to Firestore via the refactor's data
 *  layer. Re-runnable — same source key produces the same Firestore doc ID,
 *  so subsequent runs upsert deltas.
 *
 *  ── Usage ──────────────────────────────────────────────────────────────────
 *
 *    # 1. From the Deno Deploy dashboard (prod project) → KV → "Connect from CLI"
 *    #    copy the URL + access token into .env (NOT committed):
 *    PROD_KV_URL=https://api.deno.com/databases/<db-id>/connect
 *    DENO_KV_ACCESS_TOKEN=<token>
 *
 *    # 2. Firestore env (already used by the refactor):
 *    S3_BUCKET=...
 *    FIREBASE_SA_S3_KEY=...
 *    FIREBASE_PROJECT_ID=...
 *    FIREBASE_COLLECTION=autobottom
 *
 *    # 3. Optional throttle — docs/sec written to Firestore (default 200)
 *    FIRESTORE_WRITE_RATE=200
 *
 *    # 4. Run:
 *    deno run -A --unstable-kv --env tools/migrate-to-firestore.ts
 *
 *  ── What it does ───────────────────────────────────────────────────────────
 *  Walks every key in prod KV (with no filter — picks up both `["__Type__", ...]`
 *  TypedStore-style keys and `[orgId, ...]` orgKey-style keys). For each key:
 *
 *    1. Decode → (type, orgId, ...keyParts)
 *    2. Re-encode for Firestore via the refactor's setStored helper
 *    3. Upsert
 *
 *  Logs progress every 100 docs. Reports totals at the end.
 *
 *  ── What it does NOT do ────────────────────────────────────────────────────
 *  - Never writes to or deletes from prod KV (read-only on that side)
 *  - Doesn't migrate the local Deno KV — only remote prod KV
 *  - Doesn't run inside the deployed app — runs locally so you control the
 *    timing + cost. */

import { setStored, setStoredChunked } from "@core/data/firestore/mod.ts";

const PROD_KV_URL = Deno.env.get("PROD_KV_URL") ?? "";
const WRITE_RATE = Number(Deno.env.get("FIRESTORE_WRITE_RATE") ?? "200");

if (!PROD_KV_URL) {
  console.error("❌ PROD_KV_URL is required. See header for setup.");
  Deno.exit(1);
}
if (!Deno.env.get("DENO_KV_ACCESS_TOKEN")) {
  console.error("❌ DENO_KV_ACCESS_TOKEN is required.");
  Deno.exit(1);
}
if (!Deno.env.get("FIREBASE_PROJECT_ID")) {
  console.error("❌ FIREBASE_PROJECT_ID is required (Firestore credentials missing).");
  Deno.exit(1);
}

console.log(`🔌 [MIGRATE] connecting to prod KV: ${PROD_KV_URL}`);
const prodKv = await Deno.openKv(PROD_KV_URL);
console.log(`🔌 [MIGRATE] connected.`);

// ── Key decoding ──────────────────────────────────────────────────────────

interface DecodedKey {
  type: string;
  org: string;
  keyParts: (string | number)[];
  /** Whether this key represents a chunk piece (we want headers only). */
  isChunkPart: boolean;
  /** Whether the value is a chunk meta marker (totalChunks integer) — these
   *  shouldn't be written to Firestore directly; we reassemble chunks via the
   *  parent prefix and write once via setStoredChunked. */
  isChunkMeta: boolean;
}

/** Decode a Deno KV key into (type, org, keyParts). Handles both shapes:
 *
 *    ["__TypeName__", orgId, ...keyParts]   ← main's TypedStore writes
 *    [orgId, "kebab-name", ...keyParts]     ← refactor's orgKey writes
 *    ["__type-name__", orgId, ...keyParts]  ← refactor's typed-prefix writes
 *
 *  Returns null if we can't decode (malformed key). */
function decodeKey(key: Deno.KvKey): DecodedKey | null {
  if (!Array.isArray(key) || key.length === 0) return null;
  const first = String(key[0] ?? "");

  // TypedStore shape: ["__TypeName__", orgId, ...rest]
  if (first.startsWith("__") && first.endsWith("__")) {
    const typeName = first.slice(2, -2);
    // Convert PascalCase or already-kebab to kebab-case
    const kebab = typeName.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
    const org = String(key[1] ?? "");
    const rest = key.slice(2).map((p) => typeof p === "number" ? p : String(p));

    // Detect chunk parts: trailing _n is the meta count, [..., 0..N] are slices
    const last = rest[rest.length - 1];
    if (last === "_n") return { type: kebab, org, keyParts: rest.slice(0, -1), isChunkPart: false, isChunkMeta: true };
    if (rest.length >= 2 && typeof last === "number") {
      // Could be a chunk slice — caller should aggregate via parent prefix
      return { type: kebab, org, keyParts: rest.slice(0, -1), isChunkPart: true, isChunkMeta: false };
    }
    return { type: kebab, org, keyParts: rest, isChunkPart: false, isChunkMeta: false };
  }

  // orgKey shape: [orgId, "kebab-name", ...rest]
  // Heuristic: first part is orgId (UUID-ish or word), second is type
  if (key.length >= 2 && typeof key[1] === "string") {
    const org = first;
    const type = String(key[1]);
    const rest = key.slice(2).map((p) => typeof p === "number" ? p : String(p));
    const last = rest[rest.length - 1];
    if (last === "_n") return { type, org, keyParts: rest.slice(0, -1), isChunkPart: false, isChunkMeta: true };
    if (rest.length >= 2 && typeof last === "number") {
      return { type, org, keyParts: rest.slice(0, -1), isChunkPart: true, isChunkMeta: false };
    }
    return { type, org, keyParts: rest, isChunkPart: false, isChunkMeta: false };
  }

  return null;
}

// ── Walk + write ──────────────────────────────────────────────────────────

let read = 0;
let writtenSimple = 0;
let writtenChunked = 0;
let skipped = 0;
const chunkedToProcess = new Set<string>(); // "type__org__key1__key2..." identifying chunked groups

const startTs = Date.now();
const sleepBetween = WRITE_RATE > 0 ? Math.max(0, 1000 / WRITE_RATE) : 0;
async function throttle(): Promise<void> {
  if (sleepBetween > 0) await new Promise((r) => setTimeout(r, sleepBetween));
}

console.log(`📖 [MIGRATE] walking prod KV (this may take a few minutes)...`);

for await (const entry of prodKv.list({ prefix: [] })) {
  read++;
  const decoded = decodeKey(entry.key);
  if (!decoded) { skipped++; continue; }

  if (decoded.isChunkMeta || decoded.isChunkPart) {
    // Defer chunked groups — process after the simple keys pass
    chunkedToProcess.add(JSON.stringify({ type: decoded.type, org: decoded.org, keyParts: decoded.keyParts }));
    continue;
  }

  try {
    await setStored(decoded.type, decoded.org, decoded.keyParts, entry.value);
    writtenSimple++;
    if (writtenSimple % 100 === 0) {
      const elapsed = (Date.now() - startTs) / 1000;
      console.log(`  📝 ${writtenSimple} simple docs written (read ${read}, skipped ${skipped}) — ${elapsed.toFixed(0)}s`);
    }
    await throttle();
  } catch (err) {
    console.error(`❌ [MIGRATE] failed to write ${decoded.type}/${decoded.org}/${decoded.keyParts.join(",")}:`, err);
    skipped++;
  }
}

console.log(`📖 [MIGRATE] simple-doc pass complete: ${writtenSimple} written, ${skipped} skipped.`);
console.log(`📦 [MIGRATE] processing ${chunkedToProcess.size} chunked groups...`);

for (const groupKey of chunkedToProcess) {
  const { type, org, keyParts } = JSON.parse(groupKey) as { type: string; org: string; keyParts: (string | number)[] };
  // The legacy chunked layout writes [..., "_n"] (meta) + [..., 0], [..., 1], ..., [..., N-1] (slices).
  // Read the meta marker and slices from prod KV, reassemble JSON, write to
  // Firestore via setStoredChunked which handles size-driven splitting.
  // We need to find this in prod KV — try both key shapes.
  let metaKey: Deno.KvKey;
  if (type === type.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()) {
    // could be either shape — try TypedStore first
    metaKey = [`__${type}__`, org, ...keyParts, "_n"];
  } else {
    metaKey = [org, type, ...keyParts, "_n"];
  }
  let nEntry = await prodKv.get<number>(metaKey);
  // Fallback to the other shape
  if (nEntry.value == null) {
    metaKey = [org, type, ...keyParts, "_n"];
    nEntry = await prodKv.get<number>(metaKey);
  }
  if (nEntry.value == null) {
    skipped++;
    console.warn(`⚠️  [MIGRATE] chunked group missing _n meta: ${type}/${org}/${keyParts.join("/")}`);
    continue;
  }

  const totalChunks = nEntry.value;
  const slicePrefix = metaKey.slice(0, -1);
  const slices: string[] = [];
  let valid = true;
  for (let i = 0; i < totalChunks; i++) {
    const slice = await prodKv.get<string>([...slicePrefix, i]);
    if (typeof slice.value !== "string") { valid = false; break; }
    slices.push(slice.value);
  }
  if (!valid) {
    skipped++;
    console.warn(`⚠️  [MIGRATE] chunked group has missing/invalid slices: ${type}/${org}/${keyParts.join("/")}`);
    continue;
  }

  let payload: unknown;
  try { payload = JSON.parse(slices.join("")); }
  catch (err) {
    skipped++;
    console.warn(`⚠️  [MIGRATE] chunked group has invalid JSON: ${type}/${org}/${keyParts.join("/")}:`, err);
    continue;
  }

  try {
    await setStoredChunked(type, org, keyParts, payload);
    writtenChunked++;
    if (writtenChunked % 50 === 0) {
      console.log(`  📝 ${writtenChunked} chunked groups written`);
    }
    await throttle();
  } catch (err) {
    console.error(`❌ [MIGRATE] failed to write chunked ${type}/${org}/${keyParts.join("/")}:`, err);
    skipped++;
  }
}

const elapsedSec = ((Date.now() - startTs) / 1000).toFixed(1);
console.log(`✅ [MIGRATE] done in ${elapsedSec}s.`);
console.log(`   read    = ${read}`);
console.log(`   simple  = ${writtenSimple}`);
console.log(`   chunked = ${writtenChunked} groups`);
console.log(`   skipped = ${skipped}`);
console.log(`   re-run anytime to capture deltas (writes are idempotent upserts).`);

prodKv.close();
