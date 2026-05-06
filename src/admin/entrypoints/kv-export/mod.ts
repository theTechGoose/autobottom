/** KV export endpoints — used by scripts/migrate-fill.ts to read prod KV
 *  during the legacy KV → Firestore migration. Ported from the pre-refactor
 *  monolithic main.ts (commits 786021d, 6825201, 759963c, 15bed08).
 *
 *  All routes require Bearer token auth via KV_EXPORT_SECRET env var.
 *  Read-only against KV; safe to leave enabled.
 *
 *  Handlers are exported as standalone Request→Response functions and
 *  dispatched directly from main.ts (danet's @Req decorator returns
 *  undefined when reached via router.fetch in unified mode — same
 *  workaround as /admin/api/me, /audit/step/*, etc.). The Controller
 *  class below registers route names with danet for completeness but
 *  the methods are stubs. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Post } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { Description } from "#danet/swagger-decorators";
import { getKv } from "@core/data/deno-kv/mod.ts";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function requireKvExportSecret(req: Request): Response | null {
  const secret = Deno.env.get("KV_EXPORT_SECRET");
  if (!secret) return json({ error: "KV_EXPORT_SECRET not configured" }, 500);
  const header = req.headers.get("Authorization") ?? "";
  if (!constantTimeEq(header, `Bearer ${secret}`)) return json({ error: "unauthorized" }, 401);
  return null;
}

function encodeKvValue(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  const t = typeof v;
  if (t === "string" || t === "number" || t === "boolean") return v;
  if (t === "bigint") return { __kvType: "skipped", reason: "bigint" };
  if (v instanceof Uint8Array) {
    let bin = "";
    for (let i = 0; i < v.length; i++) bin += String.fromCharCode(v[i]);
    return { __kvType: "u8a", data: btoa(bin) };
  }
  if (v instanceof Date) return { __kvType: "date", iso: v.toISOString() };
  if (v instanceof Map || v instanceof Set) return { __kvType: "skipped", reason: v.constructor.name };
  if (Array.isArray(v)) return v.map(encodeKvValue);
  if (t === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = encodeKvValue(val);
    return out;
  }
  return v;
}

const TIMESTAMPED_FIELDS_BY_TYPE: Record<string, string[]> = {
  "audit-finding":        ["startedAt", "ts", "createdAt"],
  "audit-done-idx":       ["startedAt", "ts"],
  "completed-audit-stat": ["ts", "completedAt"],
  "appeal":               ["createdAt", "ts"],
  "appeal-history":       ["ts", "createdAt"],
  "manager-queue":        ["createdAt"],
  "manager-remediation":  ["createdAt"],
  "review-done":          ["reviewedAt"],
};

function typeNameFromKey(key: Deno.KvKey): string | null {
  const a = key[0];
  if (typeof a === "string" && a.length > 4 && a.startsWith("__") && a.endsWith("__")) {
    return a.slice(2, -2);
  }
  const b = key[1];
  return typeof b === "string" ? b : null;
}

function isChunkPart(key: Deno.KvKey): boolean {
  if (key.length === 0) return false;
  const last = key[key.length - 1];
  if (typeof last === "number" || typeof last === "bigint") return true;
  if (last === "_n") return true;
  return false;
}

function valueTimestamp(typeName: string, value: unknown): number | null {
  const fields = TIMESTAMPED_FIELDS_BY_TYPE[typeName];
  if (!fields || typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  for (const f of fields) {
    const v = obj[f];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const ms = Date.parse(v);
      if (!Number.isNaN(ms)) return ms;
    }
  }
  return null;
}

export async function handleKvExport(req: Request): Promise<Response> {
  const authErr = requireKvExportSecret(req);
  if (authErr) return authErr;

  let body: { prefix?: unknown; cursor?: string; limit?: number; keysOnly?: unknown; since?: number; until?: number } = {};
  try { body = await req.json(); } catch { /* empty body OK */ }

  const prefix = Array.isArray(body.prefix) ? (body.prefix as Deno.KvKey) : [];
  const cursor = typeof body.cursor === "string" ? body.cursor : undefined;
  const rawLimit = typeof body.limit === "number" ? body.limit : 500;
  const limit = Math.max(1, Math.min(2000, Math.floor(rawLimit)));
  const keysOnly = body.keysOnly === true;
  const since = typeof body.since === "number" && Number.isFinite(body.since) ? body.since : -Infinity;
  const until = typeof body.until === "number" && Number.isFinite(body.until) ? body.until : Infinity;
  const dateFilterActive = since !== -Infinity || until !== Infinity;

  const db = await getKv();
  const iter = db.list({ prefix }, { cursor, limit, batchSize: limit });

  const entries: Array<{ key: Deno.KvKey; value?: unknown; versionstamp: string }> = [];
  let iteratedCount = 0;
  let droppedCount = 0;

  for await (const e of iter) {
    iteratedCount++;
    if (dateFilterActive && !keysOnly && !isChunkPart(e.key)) {
      const typeName = typeNameFromKey(e.key);
      if (typeName && TIMESTAMPED_FIELDS_BY_TYPE[typeName]) {
        const ts = valueTimestamp(typeName, e.value);
        if (ts !== null && (ts < since || ts > until)) { droppedCount++; continue; }
      }
    }
    if (keysOnly) entries.push({ key: e.key, versionstamp: e.versionstamp });
    else entries.push({ key: e.key, value: encodeKvValue(e.value), versionstamp: e.versionstamp });
  }

  const done = iteratedCount < limit;
  console.log(`🔍 [kv-export] prefix=${JSON.stringify(prefix)} iterated=${iteratedCount} returned=${entries.length} dropped=${droppedCount} keysOnly=${keysOnly} dateFilter=${dateFilterActive} done=${done}`);
  return json({ ok: true, entries, nextCursor: iter.cursor, done });
}

export async function handleKvInventory(req: Request): Promise<Response> {
  const authErr = requireKvExportSecret(req);
  if (authErr) return authErr;

  let body: { cursor?: string; budgetMs?: number } = {};
  try { body = await req.json(); } catch { /* empty body OK */ }

  const cursor = typeof body.cursor === "string" ? body.cursor : undefined;
  const rawBudget = typeof body.budgetMs === "number" ? body.budgetMs : 30000;
  const budgetMs = Math.max(1000, Math.min(55000, Math.floor(rawBudget)));

  const db = await getKv();
  const iter = db.list({ prefix: [] }, { cursor });

  const byPrefix: Record<string, number> = {};
  let scannedThisCall = 0;
  let timedOut = false;
  const started = Date.now();

  for await (const e of iter) {
    scannedThisCall++;
    const a = e.key[0];
    const b = e.key[1];
    const fmt = (x: unknown) =>
      typeof x === "string" || typeof x === "number" || typeof x === "bigint" ? String(x) : "<non-primitive>";
    const label = b === undefined ? fmt(a) : `${fmt(a)}/${fmt(b)}`;
    byPrefix[label] = (byPrefix[label] ?? 0) + 1;

    if (scannedThisCall % 1000 === 0 && Date.now() - started > budgetMs) {
      timedOut = true;
      break;
    }
  }

  const done = !timedOut;
  console.log(`🔍 [kv-inventory] scannedThisCall=${scannedThisCall} done=${done} groups=${Object.keys(byPrefix).length}`);
  return json({ ok: true, scannedThisCall, byPrefix, nextCursor: iter.cursor, done });
}

export async function handleKvBatchList(req: Request): Promise<Response> {
  const authErr = requireKvExportSecret(req);
  if (authErr) return authErr;

  let body: { prefixes?: unknown; perPrefixLimit?: number } = {};
  try { body = await req.json(); } catch { /* empty body OK */ }

  if (!Array.isArray(body.prefixes)) return json({ error: "prefixes (array) required" }, 400);
  if (body.prefixes.length === 0) return json({ error: "prefixes must be non-empty" }, 400);
  if (body.prefixes.length > 100) return json({ error: "too many prefixes (max 100)" }, 400);
  for (const p of body.prefixes) {
    if (!Array.isArray(p)) return json({ error: "each prefix must be an array" }, 400);
  }
  const prefixes = body.prefixes as Deno.KvKey[];
  const rawPerPrefix = typeof body.perPrefixLimit === "number" ? body.perPrefixLimit : 100;
  const perPrefixLimit = Math.max(1, Math.min(200, Math.floor(rawPerPrefix)));

  const PAYLOAD_BUDGET_BYTES = 100 * 1024 * 1024;
  const db = await getKv();

  type Entry = { key: Deno.KvKey; value: unknown; versionstamp: string };
  type Group = { prefix: Deno.KvKey; entries: Entry[]; truncated: boolean };

  const groups: Group[] = [];
  let payloadBytes = 0;
  let partial = false;

  for (const prefix of prefixes) {
    const group: Group = { prefix, entries: [], truncated: false };
    groups.push(group);
    if (partial) continue;

    const iter = db.list({ prefix }, { batchSize: perPrefixLimit });
    let count = 0;
    let budgetHit = false;
    for await (const e of iter) {
      const entry: Entry = { key: e.key, value: encodeKvValue(e.value), versionstamp: e.versionstamp };
      const entryBytes = JSON.stringify(entry).length;
      if (payloadBytes + entryBytes > PAYLOAD_BUDGET_BYTES) { budgetHit = true; break; }
      group.entries.push(entry);
      payloadBytes += entryBytes;
      count++;
      if (count >= perPrefixLimit) { group.truncated = true; break; }
    }
    if (budgetHit) partial = true;
  }

  const totalEntries = groups.reduce((s, g) => s + g.entries.length, 0);
  console.log(`🔍 [kv-batch-list] prefixes=${prefixes.length} totalEntries=${totalEntries} bytes=${payloadBytes} partial=${partial}`);
  const response: Record<string, unknown> = { ok: true, groups };
  if (partial) response.partial = true;
  return json(response);
}

const STUB_NOTE = "kv-export endpoints are dispatched directly from main.ts; this controller is a no-op stub registration";

@SwaggerDescription("KV export — paginated read of legacy Deno KV for migration (handled in main.ts dispatch)")
@Controller("admin")
export class KvExportController {
  @Post("kv-export") @Description("see handleKvExport in main.ts dispatch")
  kvExport() { return { ok: false, note: STUB_NOTE }; }

  @Post("kv-inventory") @Description("see handleKvInventory in main.ts dispatch")
  kvInventory() { return { ok: false, note: STUB_NOTE }; }

  @Post("kv-batch-list") @Description("see handleKvBatchList in main.ts dispatch")
  kvBatchList() { return { ok: false, note: STUB_NOTE }; }
}
