/** Give multi-recording audits their per-recording line times (REQ-016), so the
 *  scrub view can play the clicked line's own recording at its time.
 *
 *  Audits transcribed before REQ-015 kept only the joined text. This re-reads
 *  each audit's own AssemblyAI transcripts and stores the times — only where the
 *  rebuilt text matches the stored transcript exactly.
 *
 *  Idempotent — an audit that already has times is skipped.
 *
 *  Usage (dry run prints what WOULD change and writes nothing):
 *    deno run -A --no-check --config ./deno.json --env-file=./autobottom.env \
 *      tools/backfill-recording-lines.ts --id=<findingId>[,<findingId>…] [--commit]
 *    deno run -A --no-check --config ./deno.json --env-file=./autobottom.env \
 *      tools/backfill-recording-lines.ts --days=7 [--commit]
 *  --days reads every audit completed in the window (one finding read each).
 */
import { backfillRecordingLines } from "@audit/domain/business/recording-lines-backfill/mod.ts";
import { queryAuditDoneIndex } from "@audit/domain/data/stats-repository/mod.ts";
import { defaultOrgId } from "@core/business/auth/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

const commit = Deno.args.includes("--commit");
const idArg = Deno.args.find((a) => a.startsWith("--id="));
const daysArg = Deno.args.find((a) => a.startsWith("--days="));
if (!idArg && !daysArg) {
  console.error("pass --id=<findingId>[,…] or --days=N");
  Deno.exit(2);
}

const org = defaultOrgId() as OrgId;
let ids: string[];
if (idArg) {
  ids = idArg.slice("--id=".length).split(",").map((s) => s.trim()).filter(Boolean);
} else {
  const days = Math.max(1, Number(daysArg!.split("=")[1]) || 7);
  const rows = await queryAuditDoneIndex(org, Date.now() - days * 86_400_000, Date.now());
  ids = [...new Set(rows.map((r) => r.findingId))];
  console.log(`🔎 ${ids.length} audit(s) completed in the last ${days} day(s)`);
}
console.log(`org=${org} — ${commit ? "COMMIT" : "dry run"}`);

const results = await backfillRecordingLines(org, ids, { apply: commit });
const counts = new Map<string, number>();
for (const r of results) {
  counts.set(r.outcome, (counts.get(r.outcome) ?? 0) + 1);
  if (r.outcome !== "not-multi" && r.outcome !== "has-times") {
    console.log(`  ${r.findingId}  ${r.outcome}${r.reason ? ` — ${r.reason}` : ""}`);
  }
}
console.log([...counts].map(([k, n]) => `${k}=${n}`).join(" ") + (commit ? "" : " — re-run with --commit"));
Deno.exit(0);
