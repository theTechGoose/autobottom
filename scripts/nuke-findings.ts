#!/usr/bin/env -S deno run -A --env --unstable-raw-imports
/**
 * nuke-findings.ts — purge a list of finding IDs from EVERY typed-store
 * entry that references them. Companion to find-broken-review-audits.ts.
 *
 * Wipes (per finding ID, in this order):
 *   review-pending          [findingId, questionIndex]
 *   review-active           [reviewer, findingId, questionIndex]
 *   review-decided          [findingId, questionIndex]
 *   review-audit-pending    [findingId]
 *   review-lock             [findingId, questionIndex]
 *   review-undo-idx         [reviewer, ts]  (value.findingId match)
 *   review-done             [findingId]
 *   judge-pending           [findingId, ...]
 *   judge-active            [judge, findingId, ...]
 *   judge-decided           [findingId, ...]
 *   appeal                  [findingId]
 *   appeal-history          [findingId, ...]
 *   audit-done-idx          [paddedTs, findingId]
 *   completed-audit-stat    [`${ts}-${findingId}`]
 *   chargeback-entry        [findingId]
 *   wire-deduction-entry    [findingId]
 *   active-tracking         [findingId]
 *   watchdog-active         [findingId]   (GLOBAL org "")
 *   error-tracking          [`${ts}-${findingId}`]
 *   retry-tracking          [`${ts}-${findingId}`]
 *
 * Usage:
 *   # paste-list mode (most ergonomic — pipe the find-broken output)
 *   deno run -A --env --unstable-raw-imports scripts/nuke-findings.ts \\
 *     --findings=fid1,fid2,fid3
 *
 *   # safety dry-run
 *   deno run -A --env --unstable-raw-imports scripts/nuke-findings.ts \\
 *     --findings=fid1,fid2 --dry-run
 *
 *   # specific org (defaults to defaultOrgId from env)
 *   deno run -A --env --unstable-raw-imports scripts/nuke-findings.ts \\
 *     --findings=fid1 --org=<orgId>
 *
 * IDEMPOTENT — re-running on already-purged IDs reports 0 deletes per type.
 */

import { listStoredWithKeys, deleteStored } from "@core/data/firestore/mod.ts";
import { defaultOrgId } from "@core/business/auth/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

interface Args {
  findings: string[];
  fromStdin: boolean;
  org: string | null;
  dryRun: boolean;
  yes: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { findings: [], fromStdin: false, org: null, dryRun: false, yes: false };
  for (const a of argv) {
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--stdin") out.fromStdin = true;
    else if (a === "--yes" || a === "-y") out.yes = true;
    else if (a === "--help" || a === "-h") { console.log(USAGE); Deno.exit(0); }
    else if (a.startsWith("--findings=")) {
      out.findings = a.slice(11).split(",").map((s) => s.trim()).filter(Boolean);
    } else if (a.startsWith("--org=")) out.org = a.slice(6);
    else throw new Error(`unknown arg: ${a}`);
  }
  return out;
}

async function readStdinFindings(): Promise<string[]> {
  const buf = new Uint8Array(1024 * 1024);
  const parts: string[] = [];
  const decoder = new TextDecoder();
  while (true) {
    const n = await Deno.stdin.read(buf);
    if (n === null) break;
    parts.push(decoder.decode(buf.subarray(0, n)));
  }
  // Accept newline OR comma separators, trim whitespace, dedupe.
  const ids = parts.join("").split(/[,\n\r\s]+/).map((s) => s.trim()).filter(Boolean);
  return [...new Set(ids)];
}

const USAGE = `nuke-findings — purge finding IDs from every typed-store reference

Usage:
  # Direct CSV
  deno run -A --env --unstable-raw-imports scripts/nuke-findings.ts --findings=fid1,fid2,...

  # Pipe from find-broken-review-audits.ts (the easy way):
  deno run -A --env --unstable-raw-imports scripts/find-broken-review-audits.ts --ids-only \\
    | deno run -A --env --unstable-raw-imports scripts/nuke-findings.ts --stdin --dry-run

Options:
  --findings=<csv>  Comma-separated list of finding IDs to nuke.
  --stdin           Read finding IDs from stdin (newline or comma separated).
                    One of --findings or --stdin is required.
  --org=<orgId>     Org (default: defaultOrgId from env).
  --dry-run         Print what would delete; don't write.
  --yes / -y        Skip the "press enter to continue" confirmation prompt
                    (no-op in --dry-run).
`;

const GLOBAL = "" as OrgId;

/** Per-type delete strategy. Each entry knows the type name + how to decide
 *  whether a given (key, value) row matches one of the target findings. */
type Matcher = (key: readonly (string | number)[], value: Record<string, unknown> | unknown) => boolean;
interface TypeSpec { type: string; org: OrgId; match: Matcher; }

function buildSpecs(orgId: OrgId, fids: Set<string>): TypeSpec[] {
  // findingId-in-key matchers (cheap)
  const keyHas = (idx: number): Matcher => (key) => fids.has(String(key[idx] ?? ""));
  const lastKeyMatchesPrefix: Matcher = (key) => {
    // completed-audit-stat / error-tracking / retry-tracking use "${ts}-${fid}"
    const last = String(key[key.length - 1] ?? "");
    const dash = last.indexOf("-");
    if (dash <= 0) return false;
    const fid = last.slice(dash + 1);
    return fids.has(fid);
  };
  // value.findingId matcher (when key is reviewer-keyed)
  const valHas: Matcher = (_key, value) => {
    const fid = (value as Record<string, unknown> | undefined)?.findingId;
    return typeof fid === "string" && fids.has(fid);
  };

  return [
    { type: "review-pending",       org: orgId,  match: keyHas(0) },
    { type: "review-active",        org: orgId,  match: valHas },
    { type: "review-decided",       org: orgId,  match: keyHas(0) },
    { type: "review-audit-pending", org: orgId,  match: keyHas(0) },
    { type: "review-lock",          org: orgId,  match: keyHas(0) },
    { type: "review-undo-idx",      org: orgId,  match: valHas },
    { type: "review-done",          org: orgId,  match: keyHas(0) },
    { type: "judge-pending",        org: orgId,  match: keyHas(0) },
    { type: "judge-active",         org: orgId,  match: valHas },
    { type: "judge-decided",        org: orgId,  match: keyHas(0) },
    { type: "appeal",               org: orgId,  match: keyHas(0) },
    { type: "appeal-history",       org: orgId,  match: keyHas(0) },
    { type: "audit-done-idx",       org: orgId,  match: keyHas(1) },          // [paddedTs, findingId]
    { type: "completed-audit-stat", org: orgId,  match: lastKeyMatchesPrefix }, // [`${ts}-${fid}`]
    { type: "chargeback-entry",     org: orgId,  match: keyHas(0) },
    { type: "wire-deduction-entry", org: orgId,  match: keyHas(0) },
    { type: "active-tracking",      org: orgId,  match: keyHas(0) },
    { type: "watchdog-active",      org: GLOBAL, match: keyHas(0) },          // GLOBAL org
    { type: "error-tracking",       org: orgId,  match: lastKeyMatchesPrefix },
    { type: "retry-tracking",       org: orgId,  match: lastKeyMatchesPrefix },
    // audit-finding / audit-transcript intentionally NOT here: they're
    // already missing for these findings (that's why we're nuking).
  ];
}

interface TypeReport { type: string; scanned: number; deleted: number }

async function purgeType(spec: TypeSpec, dryRun: boolean): Promise<TypeReport> {
  const rows = await listStoredWithKeys<unknown>(spec.type, spec.org);
  let deleted = 0;
  for (const { key, value } of rows) {
    if (!spec.match(key, value)) continue;
    if (!dryRun) await deleteStored(spec.type, spec.org, ...key);
    deleted++;
  }
  return { type: spec.type, scanned: rows.length, deleted };
}

async function main() {
  const args = parseArgs(Deno.args.slice());
  const fromStdin = args.fromStdin ? await readStdinFindings() : [];
  const merged = [...args.findings, ...fromStdin];
  if (merged.length === 0) {
    console.error("nothing to nuke — pass --findings=… or pipe IDs via --stdin");
    Deno.exit(2);
  }
  const orgId = (args.org ?? defaultOrgId()) as OrgId;
  const fids = new Set(merged);
  console.error(`[nuke] org=${orgId} dryRun=${args.dryRun} findings=${fids.size}`);
  console.error(`[nuke] target finding ids:\n  ${[...fids].join("\n  ")}`);
  console.error("");

  // Real-run safety prompt — interactive only. Skipped under --yes / --dry-run
  // / when stdin isn't a tty (e.g. piped input).
  if (!args.dryRun && !args.yes && Deno.stdin.isTerminal?.()) {
    console.error(`[nuke] About to PERMANENTLY delete ${fids.size} finding(s) from 20 typed-stores. Press Enter to continue, Ctrl-C to abort…`);
    const buf = new Uint8Array(64);
    await Deno.stdin.read(buf);
  }

  const specs = buildSpecs(orgId, fids);
  const reports: TypeReport[] = [];
  for (const spec of specs) {
    const r = await purgeType(spec, args.dryRun);
    reports.push(r);
    const tag = args.dryRun ? "(dry)" : "";
    console.error(`[nuke] ${spec.type.padEnd(22)} scanned=${String(r.scanned).padStart(6)} ${tag} deleted=${r.deleted}`);
  }

  const total = reports.reduce((s, r) => s + r.deleted, 0);
  console.error("");
  console.error(`[nuke] TOTAL ${args.dryRun ? "would-delete" : "deleted"}: ${total} entries across ${reports.filter((r) => r.deleted > 0).length} types`);
  console.error(`[nuke] ${args.dryRun ? "(dry-run — no writes)" : "done."}`);
}

if (import.meta.main) {
  await main();
}
