/** Close the appeals the judge decided but that stayed "pending" (REQ-011).
 *
 *  Before REQ-010, postJudgedAudit found an audit's decisions through a scan
 *  capped at 1000 rows; past 1000 judge decisions it read none, so the appeal
 *  stayed pending and the overturned answers stayed "No". This re-runs the
 *  close-out for every such appeal filed in the window — WITHOUT the
 *  appeal-result email.
 *
 *  Idempotent — a closed appeal is no longer "pending", so a re-run skips it.
 *
 *  Usage (dry run prints what WOULD close and writes nothing):
 *    deno run -A --no-check --config ./deno.json --env-file=./autobottom.env \
 *      tools/backfill-stuck-appeals.ts --days=7 [--commit]
 */
import { backfillStuckAppeals } from "@judge/domain/business/appeal-close-backfill/mod.ts";
import { defaultOrgId } from "@core/business/auth/mod.ts";

const commit = Deno.args.includes("--commit");
const daysArg = Deno.args.find((a) => a.startsWith("--days="));
const days = Math.max(1, Number(daysArg?.split("=")[1] ?? 7) || 7);

const org = defaultOrgId();
const sinceMs = Date.now() - days * 86_400_000;
console.log(`🔎 stuck appeals filed in the last ${days} day(s), org=${org} — ${commit ? "COMMIT" : "dry run"}`);

const stuck = await backfillStuckAppeals(org, { sinceMs, apply: commit });
for (const s of stuck) {
  console.log(`  ${s.findingId}  appealed ${new Date(s.appealedAt).toISOString()}  judge=${s.judge}`);
}
console.log(`${commit ? "✅ closed" : "would close"} ${stuck.length} appeal(s)${commit ? "" : " — re-run with --commit"}`);
Deno.exit(0);
