#!/usr/bin/env -S deno run -A --env --unstable-raw-imports
/**
 * find-broken-review-audits.ts — list every review-queue audit whose
 * audit-finding doc is missing in Firestore. Output is a CSV-style table
 * (and a JSON dump) so you can pull the record IDs, nuke them from the
 * queue, and re-fire bulk audits.
 *
 * Why: post-refactor migration brought over `review-pending` /
 * `review-active` / `review-decided` (the queue state) but never moved
 * `audit-finding` for many findings. The review panel still renders from
 * the denormalized buffer rows, but `/audit/recording` and the chunked
 * transcript both 404 because they require the actual finding doc.
 *
 * Usage:
 *   deno run -A --env --unstable-raw-imports scripts/find-broken-review-audits.ts
 *   deno run -A --env --unstable-raw-imports scripts/find-broken-review-audits.ts --org=<orgId>
 *   deno run -A --env --unstable-raw-imports scripts/find-broken-review-audits.ts --json > broken.json
 *
 * Required env (same as migrate-fill — uses your local Firestore creds):
 *   FIRESTORE_PROJECT_ID + FIRESTORE_CLIENT_EMAIL + FIRESTORE_PRIVATE_KEY
 */

import { listStoredWithKeys } from "@core/data/firestore/mod.ts";
import { getFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { defaultOrgId } from "@core/business/auth/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

interface Args {
  org: string | null;
  json: boolean;
  idsOnly: boolean;
  concurrency: number;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { org: null, json: false, idsOnly: false, concurrency: 20 };
  for (const a of argv) {
    if (a === "--json") out.json = true;
    else if (a === "--ids-only") out.idsOnly = true;
    else if (a === "--help" || a === "-h") {
      console.log(USAGE);
      Deno.exit(0);
    } else if (a.startsWith("--org=")) out.org = a.slice(6);
    else if (a.startsWith("--concurrency=")) {
      out.concurrency = Math.max(1, parseInt(a.slice(14), 10) || 20);
    } else throw new Error(`unknown arg: ${a}`);
  }
  return out;
}

const USAGE = `find-broken-review-audits — list review-queue audits whose finding doc is missing

Usage:
  deno run -A --env --unstable-raw-imports scripts/find-broken-review-audits.ts [options]

Options:
  --org=<orgId>         Single org (default: defaultOrgId() from env)
  --json                JSON output instead of table (good for piping)
  --ids-only            Print ONLY the comma-separated finding IDs to stdout
                        (progress logs go to stderr). Pipe-friendly.
  --concurrency=N       Parallel finding lookups (default: 20)
`;

interface QueueRow {
  source: "review-pending" | "review-active" | "review-decided";
  findingId: string;
  recordId: string | null;
  questionIndex: number | null;
}

interface BrokenAudit {
  findingId: string;
  recordId: string | null;
  questionCount: number;
  sources: string[]; // distinct queue tables this finding appears in
}

async function listQueueRows(orgId: OrgId): Promise<QueueRow[]> {
  const out: QueueRow[] = [];
  const sources: Array<QueueRow["source"]> = ["review-pending", "review-active", "review-decided"];
  for (const src of sources) {
    const rows = await listStoredWithKeys<Record<string, unknown>>(src, orgId);
    for (const { value } of rows) {
      const findingId = String(value?.findingId ?? "");
      if (!findingId) continue;
      const recordId = value?.recordId ? String(value.recordId) : null;
      const qi = value?.questionIndex;
      out.push({
        source: src,
        findingId,
        recordId,
        questionIndex: typeof qi === "number" ? qi : null,
      });
    }
  }
  return out;
}

async function findMissing(
  orgId: OrgId,
  rows: QueueRow[],
  concurrency: number,
): Promise<BrokenAudit[]> {
  // Group by findingId — one Firestore lookup per unique finding regardless
  // of how many questions it has in the queue.
  const byFid = new Map<string, QueueRow[]>();
  for (const r of rows) {
    if (!byFid.has(r.findingId)) byFid.set(r.findingId, []);
    byFid.get(r.findingId)!.push(r);
  }

  const findingIds = [...byFid.keys()];
  console.error(`[scan] ${rows.length} queue rows across ${findingIds.length} unique findings — checking each finding doc...`);

  const broken: BrokenAudit[] = [];
  let done = 0;

  // Simple semaphore — keep `concurrency` lookups in flight at a time.
  const queue = [...findingIds];
  const workers: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push((async () => {
      while (queue.length > 0) {
        const fid = queue.shift();
        if (!fid) break;
        try {
          const finding = await getFinding(orgId, fid);
          if (!finding) {
            const grouped = byFid.get(fid)!;
            const recordId = grouped.find((g) => g.recordId)?.recordId ?? null;
            const sources = [...new Set(grouped.map((g) => g.source))];
            broken.push({
              findingId: fid,
              recordId,
              questionCount: grouped.length,
              sources,
            });
          }
        } catch (e) {
          console.error(`[scan] ${fid}: lookup threw — ${e instanceof Error ? e.message : String(e)}`);
        }
        done++;
        if (done % 25 === 0) console.error(`[scan] progress: ${done}/${findingIds.length}`);
      }
    })());
  }
  await Promise.all(workers);
  console.error(`[scan] done — ${broken.length} broken / ${findingIds.length} unique findings`);
  return broken;
}

async function main() {
  const args = parseArgs(Deno.args.slice());
  const orgId = (args.org ?? defaultOrgId()) as OrgId;
  console.error(`[scan] org=${orgId}`);

  const rows = await listQueueRows(orgId);
  if (rows.length === 0) {
    console.error("[scan] empty queue — nothing to check");
    return;
  }

  const broken = await findMissing(orgId, rows, args.concurrency);
  // Sort: rows with a recordId first, then by recordId asc; nulls last.
  broken.sort((a, b) => {
    if (!a.recordId && b.recordId) return 1;
    if (a.recordId && !b.recordId) return -1;
    return (a.recordId ?? "").localeCompare(b.recordId ?? "");
  });

  if (args.idsOnly) {
    // Pipe-friendly: only the CSV of finding IDs to stdout. Logs are stderr.
    console.log(broken.map((b) => b.findingId).join(","));
    console.error(`[scan] emitted ${broken.length} finding IDs`);
    return;
  }

  if (args.json) {
    console.log(JSON.stringify(broken, null, 2));
    return;
  }

  // Table output
  const recordIds = broken.map((b) => b.recordId).filter((r) => r) as string[];
  const uniqueRecordIds = [...new Set(recordIds)];

  console.log("");
  console.log(`=== ${broken.length} BROKEN REVIEW-QUEUE AUDITS (finding doc missing) ===`);
  console.log("");
  console.log("RECORD ID    | FINDING ID                  | QUESTIONS | IN");
  console.log("-------------|-----------------------------|-----------|---------------------------");
  for (const b of broken) {
    const rec = (b.recordId ?? "<no-recordId>").padEnd(12);
    const fid = b.findingId.padEnd(28);
    const qs = String(b.questionCount).padStart(9);
    console.log(`${rec} | ${fid} | ${qs} | ${b.sources.join(",")}`);
  }
  console.log("");
  console.log(`=== UNIQUE RECORD IDS TO RE-AUDIT (${uniqueRecordIds.length}) ===`);
  console.log(uniqueRecordIds.join(","));
  console.log("");
  console.log(`=== FINDING IDS TO NUKE FROM QUEUE (${broken.length}) ===`);
  console.log(broken.map((b) => b.findingId).join(","));
}

if (import.meta.main) {
  await main();
}
