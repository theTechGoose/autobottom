#!/usr/bin/env -S deno run --allow-env --allow-net
/** One-shot prod KV inventory.
 *
 *  Walks prod's paginated /admin/kv-inventory endpoint until done=true and
 *  prints per-prefix counts + grand total. Read-only and fully standalone:
 *  imports nothing from the autobottom codebase, so it's safe to run in a
 *  new terminal alongside a long-running migrate-fill.ts process.
 *
 *  Usage:
 *    deno run --allow-env --allow-net --env-file=.env scripts/inventory.ts
 *
 *  Env (same vars migrate-fill.ts uses):
 *    PROD_EXPORT_BASE_URL   e.g. https://autobottom-XXX.thetechgoose.deno.net
 *    KV_EXPORT_SECRET       bearer token
 */

interface InventoryPage {
  ok: boolean;
  scannedThisCall: number;
  byPrefix: Record<string, number>;
  nextCursor?: string;
  done: boolean;
  error?: string;
}

function ts(): string {
  return new Date().toISOString().replace("T", " ").slice(11, 19);
}

function log(msg: string): void {
  console.log(`[${ts()}] ${msg}`);
}

function readEnv(): { base: string; secret: string } {
  const base = (Deno.env.get("PROD_EXPORT_BASE_URL") ?? "").replace(/\/+$/, "");
  const secret = (Deno.env.get("KV_EXPORT_SECRET") ?? "").trim();
  if (!base) throw new Error("PROD_EXPORT_BASE_URL env var is not set (check .env)");
  if (!secret) throw new Error("KV_EXPORT_SECRET env var is not set (check .env)");
  if (!base.startsWith("https://")) throw new Error(`PROD_EXPORT_BASE_URL must start with https://: ${base}`);
  return { base, secret };
}

async function fetchPageOnce(
  base: string,
  secret: string,
  cursor: string | null,
  budgetMs: number,
  clientTimeoutMs: number,
): Promise<InventoryPage> {
  const body: Record<string, unknown> = { budgetMs };
  if (cursor) body.cursor = cursor;

  const ctrl = new AbortController();
  const hbStart = Date.now();
  const heartbeat = setInterval(() => {
    log(`  …still waiting (${Math.round((Date.now() - hbStart) / 1000)}s)`);
  }, 10_000);
  const killer = setTimeout(() => ctrl.abort(), clientTimeoutMs);
  try {
    const res = await fetch(`${base}/admin/kv-inventory`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`kv-inventory HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = await res.json() as InventoryPage;
    if (!data.ok) throw new Error(`kv-inventory error: ${data.error ?? "unknown"}`);
    return data;
  } finally {
    clearTimeout(killer);
    clearInterval(heartbeat);
  }
}

async function fetchPage(
  base: string,
  secret: string,
  cursor: string | null,
  budgetMs: number,
): Promise<InventoryPage> {
  const CLIENT_TIMEOUT_MS = 90_000;  // server budget is 30s; allow generous slack
  const MAX_ATTEMPTS = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fetchPageOnce(base, secret, cursor, budgetMs, CLIENT_TIMEOUT_MS);
    } catch (err) {
      lastErr = err;
      log(`  ⚠ attempt ${attempt}/${MAX_ATTEMPTS} failed: ${String(err).slice(0, 120)}`);
      if (attempt < MAX_ATTEMPTS) {
        const backoff = 2_000 * attempt;
        log(`  retrying in ${backoff / 1000}s…`);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function main(): Promise<void> {
  const { base, secret } = readEnv();
  log(`inventory walk → ${base}/admin/kv-inventory`);

  const accum: Record<string, number> = {};
  let cursor: string | null = null;
  let totalScanned = 0;
  let pages = 0;
  const t0 = Date.now();

  while (true) {
    const callStart = Date.now();
    const page = await fetchPage(base, secret, cursor, 30_000);
    const callMs = Date.now() - callStart;
    pages++;
    totalScanned += page.scannedThisCall;
    for (const [k, v] of Object.entries(page.byPrefix)) {
      accum[k] = (accum[k] ?? 0) + v;
    }
    log(`page ${pages}: scanned ${page.scannedThisCall.toLocaleString()} in ${(callMs / 1000).toFixed(1)}s (total ${totalScanned.toLocaleString()}) done=${page.done}`);
    if (page.done) break;
    if (!page.nextCursor) {
      throw new Error(`done=false but no nextCursor at page ${pages}`);
    }
    cursor = page.nextCursor;
  }

  const wallS = ((Date.now() - t0) / 1000).toFixed(1);
  log(`finished: ${pages} pages, ${totalScanned.toLocaleString()} keys in ${wallS}s`);

  const sorted = Object.entries(accum).sort((a, b) => b[1] - a[1]);
  const labelWidth = Math.max(...sorted.map(([k]) => k.length), 8);

  console.log("");
  console.log("Per-prefix counts (sorted by count desc):");
  for (const [k, v] of sorted) {
    console.log(`  ${k.padEnd(labelWidth)}  ${v.toLocaleString().padStart(12)}`);
  }
  console.log("");
  console.log(`  ${"TOTAL".padEnd(labelWidth)}  ${totalScanned.toLocaleString().padStart(12)}`);
  console.log("");
  console.log("Compare to migrate-fill logs:");
  console.log("  written-total + matched-total = keys done");
  console.log("  TOTAL − (written + matched)   = keys remaining");
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(`❌ ${String(err)}`);
    Deno.exit(1);
  });
}
