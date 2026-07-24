/** Bulk re-run for audits that finished as "Invalid Genie".
 *
 *  When the recording database we search is temporarily wrong, step-init can't
 *  find the audio, exhausts its retries, and finalizes the audit at 0% with the
 *  sentinel transcript "Invalid Genie". Once the database is healthy again those
 *  recordings ARE there — but nothing re-drives the audits, and re-running them
 *  one at a time from /admin/audits is impractical at volume.
 *
 *  Three operations, deliberately separate so the caller owns the pacing:
 *    - listInvalidGenieFindings  — one indexed query, zero writes
 *    - requeueGenieRetryBatch    — reset + re-publish step-init for a batch
 *    - checkGenieRetryOutcomes   — read each finding back and classify it
 *
 *  The caller (Data Maintenance → Genie Retry) keeps a fixed number of audits
 *  in flight by only requeueing as many as have finished, so we never dump the
 *  whole window onto Genie/AssemblyAI at once.
 *
 *  Requeue is reset-then-republish, matching /admin/reset-finding:
 *  resetFindingDerivedState clears the OUTSIDE stores (review queue,
 *  audit-done-idx, chargeback/wire), clearFindingRunState clears the finding
 *  doc's own run state. Skipping the second one makes the whole re-run a no-op —
 *  step-transcribe short-circuits on the stale sentinel and finalize re-writes
 *  an identical 0%. */

import type { OrgId } from "@core/data/deno-kv/mod.ts";
import { getFinding, clearFindingRunState } from "@audit/domain/data/audit-repository/mod.ts";
import { publishStep } from "@core/data/qstash/mod.ts";

/** How many audits the batch helpers fan out at once. The caller's in-flight
 *  gate is the real throttle; this just keeps one batch's Firestore work from
 *  going out serially. */
const BATCH_CONCURRENCY = 5;

/** One invalid-genie audit in the window, with the metadata the operator needs
 *  to recognise it in the result table. */
export interface GenieRetryCandidate {
  findingId: string;
  completedAt?: number;
  recordId?: string;
  recordingId?: string;
  voName?: string;
  department?: string;
}

/** Where one audit stands after being requeued.
 *    running — pipeline hasn't finalized it yet
 *    valid   — finished with a real transcript: the recording was found
 *    invalid — finished still carrying the sentinel: genuinely no recording
 *    missing — finding doc is gone (deleted/purged mid-run) */
export type GenieRetryState = "running" | "valid" | "invalid" | "missing";

export interface GenieRetryOutcome {
  findingId: string;
  state: GenieRetryState;
  /** Present once finished — the re-run's score, so the operator can see that a
   *  recovered audit actually produced a grade. */
  score?: number;
  /** Present for `valid` — proof there is now real text, not the sentinel. */
  transcriptChars?: number;
}

/** The sentinel step-init / step-transcribe write when no audio can be had.
 *  Both spellings exist in production data. */
function isInvalidTranscript(raw: unknown): boolean {
  if (typeof raw !== "string" || raw.trim() === "") return true;
  return raw.includes("Invalid Genie") || raw.includes("Genie Invalid");
}

/** Run `fn` over `items` with a fixed-size worker pool, preserving input order. */
async function mapPooled<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Every audit in [since, until] that finalized as invalid-genie.
 *
 *  Reads audit-done-idx by completedAt — the same indexed query the audit
 *  history's "Invalid Genie" filter uses — so this stays one bounded query
 *  instead of hydrating every finding in the window. */
export async function listInvalidGenieFindings(
  orgId: OrgId,
  since: number,
  until: number,
): Promise<GenieRetryCandidate[]> {
  const { listStoredByCompletedAt } = await import("@core/data/firestore/mod.ts");
  const rows = await listStoredByCompletedAt<{
    findingId?: string;
    completedAt?: number;
    reason?: string;
    recordId?: string;
    recordingId?: string;
    voName?: string;
    department?: string;
  }>("audit-done-idx", orgId, since, until, { limit: 500_000 });

  // One audit can own several index rows (re-review, flip, appeal). Keep the
  // newest row per finding so `reason` reflects its FINAL state — an audit that
  // was invalid-genie and has since been re-audited must not be picked up again.
  const byFid = new Map<string, { completedAt: number; row: typeof rows[number] }>();
  for (const row of rows) {
    const findingId = row.findingId;
    if (!findingId) continue;
    const completedAt = row.completedAt ?? 0;
    const prev = byFid.get(findingId);
    if (prev && prev.completedAt >= completedAt) continue;
    byFid.set(findingId, { completedAt, row });
  }

  const out: GenieRetryCandidate[] = [];
  for (const [findingId, { row }] of byFid) {
    if (row.reason !== "invalid_genie") continue;
    out.push({
      findingId,
      completedAt: row.completedAt,
      recordId: row.recordId,
      recordingId: row.recordingId,
      voName: row.voName,
      department: row.department,
    });
  }
  // Oldest first — if the operator stops a long run early, the audits that have
  // been wrong the longest are the ones already fixed.
  out.sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0));
  console.log(`[GENIE-RETRY] 📋 list orgId=${orgId} since=${since} until=${until} → ${out.length} invalid-genie of ${byFid.size} audits (${rows.length} index rows)`);
  return out;
}

/** Reset a batch of findings and re-publish step-init for each. */
export async function requeueGenieRetryBatch(
  orgId: OrgId,
  fids: string[],
): Promise<{ requeued: string[]; failed: string[] }> {
  if (fids.length === 0) return { requeued: [], failed: [] };
  const { resetFindingDerivedState } = await import("@review/domain/business/review-queue/mod.ts");

  const results = await mapPooled(fids, BATCH_CONCURRENCY, async (fid) => {
    try {
      await resetFindingDerivedState(orgId, fid);
      const existed = await clearFindingRunState(orgId, fid);
      if (!existed) {
        console.warn(`[GENIE-RETRY] ⚠️ ${fid}: finding doc missing — not requeued`);
        return { fid, ok: false };
      }
      await publishStep("init", { findingId: fid, orgId });
      return { fid, ok: true };
    } catch (err) {
      console.warn(`[GENIE-RETRY] ❌ ${fid}: requeue failed:`, err);
      return { fid, ok: false };
    }
  });

  const requeued = results.filter((r) => r.ok).map((r) => r.fid);
  const failed = results.filter((r) => !r.ok).map((r) => r.fid);
  console.log(`[GENIE-RETRY] 🚀 requeue batch=${fids.length} ok=${requeued.length} failed=${failed.length}`);
  return { requeued, failed };
}

/** Read each in-flight finding back and classify it.
 *
 *  "Finished" is findingStatus === "finished" — the state step-finalize leaves
 *  behind. Anything else is still moving through the pipeline. Note that
 *  clearFindingRunState resets the status to "pending" at requeue time, so a
 *  finding read back as "finished" always reflects the NEW run, never the old
 *  one. */
export async function checkGenieRetryOutcomes(
  orgId: OrgId,
  fids: string[],
): Promise<GenieRetryOutcome[]> {
  if (fids.length === 0) return [];
  return await mapPooled(fids, BATCH_CONCURRENCY, async (findingId): Promise<GenieRetryOutcome> => {
    let finding: Record<string, unknown> | null = null;
    try {
      finding = await getFinding(orgId, findingId);
    } catch (err) {
      // A transient read failure must not be mistaken for a verdict — leave it
      // running and let the next poll decide.
      console.warn(`[GENIE-RETRY] ⚠️ ${findingId}: status read failed:`, err);
      return { findingId, state: "running" };
    }
    if (!finding) return { findingId, state: "missing" };
    if (finding.findingStatus !== "finished") return { findingId, state: "running" };

    const raw = finding.rawTranscript;
    const answered = Array.isArray(finding.answeredQuestions) ? finding.answeredQuestions : [];
    const yeses = answered.filter((q: { answer?: string }) =>
      String(q?.answer ?? "").trim().toLowerCase().startsWith("y")
    ).length;
    const score = answered.length > 0 ? Math.round((yeses / answered.length) * 100) : undefined;

    if (isInvalidTranscript(raw)) return { findingId, state: "invalid", score };
    return { findingId, state: "valid", score, transcriptChars: (raw as string).length };
  });
}
