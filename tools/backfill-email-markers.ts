/** Backfill the email sent/opened markers onto audit-done-idx rows and
 *  remediation-queue rows, from the audit-email-mark docs that already exist.
 *
 *  Why this is needed: the "Email Opened" column reads the marker off the row
 *  the table already loads, so it costs no per-row reads. Rows written before
 *  that stamping shipped carry no marker, so the column renders blank for all
 *  history until this runs.
 *
 *  Costs nothing but Firestore: every open we ever recorded is already stored
 *  in `audit-email-mark`. NO QuickBase calls.
 *
 *  Idempotent — the stampers are first-write-wins, so re-running can't clobber
 *  a newer marker or double-count anything.
 *
 *  Usage (dry run prints what WOULD change and writes nothing):
 *    DEFAULT_ORG_ID=… FIREBASE_SA_S3_KEY=… FIREBASE_PROJECT_ID=… \
 *    deno run -A --no-check --config ./deno.json --env-file=./autobottom.env \
 *      tools/backfill-email-markers.ts --days=30 [--commit]
 */
import { queryAuditDoneIndex, stampEmailOnDoneIdx } from "@audit/domain/data/stats-repository/mod.ts";
import { getManagerQueue, stampEmailOnQueueItem } from "@manager/domain/data/manager-repository/mod.ts";
import { getStored } from "@core/data/firestore/mod.ts";
import { defaultOrgId } from "@core/business/auth/mod.ts";

interface Mark { sentAt?: number; openedAt?: number }

const args = new Set(Deno.args);
const commit = args.has("--commit");
const daysArg = Deno.args.find((a) => a.startsWith("--days="));
const days = Math.max(1, Number(daysArg?.split("=")[1] ?? 30) || 30);
/** `--only=queue` / `--only=index`. The remediation queue is a few hundred rows
 *  and is the surface managers actually work from, while the index pass is tens
 *  of thousands of rows and takes over an hour — running them separately means
 *  the queue doesn't wait on it. Both passes are idempotent and independent. */
const onlyArg = Deno.args.find((a) => a.startsWith("--only="))?.split("=")[1];
const doIndex = onlyArg !== "queue";
const doQueue = onlyArg !== "index";

const org = defaultOrgId();
const now = Date.now();
const since = now - days * 86_400_000;

console.log(`${commit ? "COMMIT" : "DRY RUN"} — org=${org} window=${days}d`);
if (!commit) console.log("(no writes; pass --commit to apply)\n");

/** Bounded concurrency so a wide window can't fan out thousands of concurrent
 *  reads — that pattern has saturated the Firestore lane and 503'd prod. */
const CONC = 15;
async function eachMark<T extends { findingId: string }>(
  rows: T[],
  apply: (row: T, mark: Mark) => Promise<boolean>,
): Promise<{ scanned: number; withMark: number; stamped: number }> {
  let scanned = 0, withMark = 0, stamped = 0;
  for (let i = 0; i < rows.length; i += CONC) {
    const chunk = rows.slice(i, i + CONC);
    const marks = await Promise.all(
      chunk.map((r) => getStored<Mark>("audit-email-mark", org, r.findingId).catch(() => null)),
    );
    for (let j = 0; j < chunk.length; j++) {
      scanned++;
      const m = marks[j];
      if (!m || (!m.sentAt && !m.openedAt)) continue;
      withMark++;
      if (commit && await apply(chunk[j], m)) stamped++;
    }
    if (i % 300 === 0 && i > 0) console.log(`  …${i}/${rows.length}`);
  }
  return { scanned, withMark, stamped };
}

let wouldStamp = 0;

// ── manager-queue (powers the Remediation Queue column) ─────────────────────
// Runs FIRST: a few hundred rows, and it's the surface managers work from.
if (doQueue) {
  const queueRows = (await getManagerQueue(org)).filter((i) => i.status !== "remediated");
  const q = await eachMark(queueRows, (r, m) =>
    stampEmailOnQueueItem(org, r.findingId, { emailSentAt: m.sentAt, emailOpenedAt: m.openedAt }));
  console.log(`manager-queue:  scanned ${q.scanned}, have a mark ${q.withMark}, stamped ${q.stamped}`);
  wouldStamp += q.withMark;
}

// ── audit-done-idx (powers the Audit History column) ────────────────────────
if (doIndex) {
  const idxRows = await queryAuditDoneIndex(org, since, now);
  // Pass the row's own completedAt as the key hint. Without it the stamper
  // falls back to the key pointer, which only exists on rows written by
  // writeSoleAuditDoneIndex — that skipped ~7k of 8.7k rows on the first run.
  const idx = await eachMark(idxRows, (r, m) =>
    stampEmailOnDoneIdx(org, r.findingId, { emailSentAt: m.sentAt, emailOpenedAt: m.openedAt }, { at: r.completedAt }));
  console.log(`audit-done-idx: scanned ${idx.scanned}, have a mark ${idx.withMark}, stamped ${idx.stamped}`);
  wouldStamp += idx.withMark;
}

if (!commit) {
  console.log(`\nDry run only. ${wouldStamp} rows would be stamped. Re-run with --commit to apply.`);
}
