/** Retroactive cleanup for audits carrying an ungraded "Error" answer.
 *
 *  step-ask-all writes `answer: "Error"` when every Groq fallback model has
 *  exhausted its retries for a question (rate limit, timeout). It is NOT a
 *  verdict — the bot never graded the question — but it renders to reviewers,
 *  agents and managers as "Bot Error — Could Not Grade" and drags the audit's
 *  score down, because score is yes/total.
 *
 *  This module finds those audits and forces each one to a 100% reviewed pass
 *  via adminFlipFinding(..., { includeErrors: true }) — the SAME function the
 *  normal Bulk Flip runs, so the outcome is identical to a human flipping every
 *  answer to Yes: answers → Yes (including the Error ones), score 100,
 *  reviewedBy stamped, queue entries drained, chargeback/wire payroll rows
 *  dropped, and a "reviewed" audit-done-idx row written.
 *
 *  Two modes, driven by two separate buttons in Data Maintenance → Bulk Flip,
 *  so counting is never coupled to changing:
 *    - `scan` — classify only. ZERO writes. Answers "how many are impacted?"
 *    - `flip` — force each impacted audit to 100%. Idempotent: a flipped audit
 *               has no Error answers left, so it stops being a candidate.
 *
 *  SCOPE WARNING (a deliberate operator choice, not an oversight): forcing the
 *  whole audit to 100 also clears any GENUINE "No" failures on the same audit,
 *  and drops that audit's payroll deduction rows. An audit with 1 Error and 3
 *  real fails ends up at 100% with the real fails erased. The scan card shows
 *  the real-fail count per audit before anything is written, so the operator
 *  sees the cost. Fixing only the errored questions would be
 *  adminFlipQuestion per index instead — see this module's git history. */

import type { OrgId } from "@core/data/deno-kv/mod.ts";
import { getFinding } from "@audit/domain/data/audit-repository/mod.ts";

/** One audit in the scan window, with the metadata the operator needs to
 *  recognise it in the result table. Sourced from the audit-done-idx row. */
export interface ErrorFlipCandidate {
  findingId: string;
  completedAt?: number;
  score?: number;
  reviewedBy?: string;
  voName?: string;
  department?: string;
}

export type ErrorFlipMode = "scan" | "flip";

/** Evidence for one impacted audit — what the operator eyeballs before
 *  flipping. `realFailCount` is the load-bearing one: it is how many genuine
 *  "No" verdicts this flip will ALSO erase. */
export interface ErrorFlipSample {
  findingId: string;
  /** Questions the bot could not grade. */
  errorCount: number;
  /** Genuine "No" verdicts on the same audit — erased by a force-to-100. */
  realFailCount: number;
  totalQuestions: number;
  /** Headers of the ungraded questions, capped for display. */
  errorHeaders: string[];
}

export interface ErrorFlipBatchResult {
  scanned: number;
  /** Audits with no Error answer — the overwhelming majority. */
  clean: number;
  /** Audits carrying at least one Error answer. */
  impacted: number;
  /** Total ungraded questions across the impacted audits. */
  errorQuestions: number;
  /** Genuine "No" verdicts sitting on impacted audits — erased by a flip. */
  realFails: number;
  /** Audits actually forced to 100%. Always 0 in `scan` mode. */
  flipped: number;
  /** Findings in the window whose doc is gone or has no answers. */
  missing: number;
  errors: number;
  /** Every impacted findingId in this batch — drives the result table. */
  impactedFids: string[];
  samples: ErrorFlipSample[];
}

/** Cap on the per-batch detail payload. The fid list is cheap (short strings);
 *  the samples carry question headers, so they get a tighter cap. */
const MAX_SAMPLES_PER_BATCH = 10;
const MAX_HEADERS_PER_SAMPLE = 6;
/** Concurrency is a MEMORY budget here, not just a rate limit. Every finding
 *  read pulls the whole audit document, transcript included, so peak memory is
 *  roughly concurrency × finding size. Prod died at "Isolate terminated: memory
 *  limit exceeded" on 2026-08-04 running this at 20 wide with the finding cache
 *  on. Keep these low, and keep the `cache: false` on getFinding below. */
const SCAN_CONCURRENCY = 8;
const FLIP_CONCURRENCY = 6;

function emptyResult(): ErrorFlipBatchResult {
  return {
    scanned: 0,
    clean: 0,
    impacted: 0,
    errorQuestions: 0,
    realFails: 0,
    flipped: 0,
    missing: 0,
    errors: 0,
    impactedFids: [],
    samples: [],
  };
}

/** The sentinel step-ask-all writes for an ungraded question. Matched
 *  case-insensitively — the frontend's isErrorAnswer does the same, so the scan
 *  can never disagree with what the report actually renders. */
function isErrorAnswer(a: unknown): boolean {
  return String(a ?? "").trim().toLowerCase() === "error";
}

function isNoAnswer(a: unknown): boolean {
  return String(a ?? "").trim().toLowerCase() === "no";
}

/** Every audit completed in the window, newest index row per finding. One
 *  indexed query — same shape as listTranscriptRepairFids.
 *
 *  Note this returns EVERY completed audit, not just impacted ones: whether an
 *  audit carries an Error answer is only knowable from its answeredQuestions,
 *  which lives on the finding doc. The per-finding check is what the chunked
 *  batch pass below does. */
export async function listErrorFlipFids(
  orgId: OrgId,
  since: number,
  until: number,
): Promise<ErrorFlipCandidate[]> {
  const { listStoredByCompletedAt } = await import("@core/data/firestore/mod.ts");
  const rows = await listStoredByCompletedAt<{
    findingId?: string;
    completedAt?: number;
    score?: number;
    reviewedBy?: string;
    voName?: string;
    department?: string;
  }>("audit-done-idx", orgId, since, until, { limit: 500_000 });

  // One audit can own several index rows (re-review, flip, appeal). Dedupe by
  // findingId, keeping the newest so `score` / `reviewedBy` reflect its FINAL
  // state — an audit already flipped must not be re-listed as impacted.
  const byFid = new Map<string, ErrorFlipCandidate>();
  for (const r of rows) {
    const findingId = r.findingId;
    if (!findingId) continue;
    const prev = byFid.get(findingId);
    if (prev && (prev.completedAt ?? 0) >= (r.completedAt ?? 0)) continue;
    byFid.set(findingId, {
      findingId,
      completedAt: r.completedAt,
      score: r.score,
      reviewedBy: r.reviewedBy,
      voName: r.voName,
      department: r.department,
    });
  }
  const out = [...byFid.values()];
  // Oldest first — if the operator stops a long run early, the audits that have
  // been showing an error the longest are the ones already fixed.
  out.sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0));
  console.log(`[ERROR-FLIP] 📋 list orgId=${orgId} since=${since} until=${until} → ${out.length} audits (${rows.length} index rows)`);
  return out;
}

/** Classify one audit, and in `flip` mode force it to a 100% reviewed pass.
 *  Returns null when the finding doc is gone or carries no answers. */
async function inspectOne(
  orgId: OrgId,
  findingId: string,
  mode: ErrorFlipMode,
  flippedBy: string,
): Promise<{ sample: ErrorFlipSample | null; wrote: boolean } | null> {
  // cache:false — this walks thousands of findings and each one carries its
  // transcript inline. Populating the finding cache here pins ~1000 whole audit
  // documents in the isolate and OOMs it (see getFinding's comment).
  const finding = await getFinding(orgId, findingId, { cache: false });
  if (!finding) return null;

  const answers = Array.isArray(finding.answeredQuestions) ? finding.answeredQuestions : [];
  if (answers.length === 0) return null;

  const errored = answers.filter((a: any) => isErrorAnswer(a?.answer));
  if (errored.length === 0) return { sample: null, wrote: false };

  const sample: ErrorFlipSample = {
    findingId,
    errorCount: errored.length,
    realFailCount: answers.filter((a: any) => isNoAnswer(a?.answer)).length,
    totalQuestions: answers.length,
    errorHeaders: errored
      .slice(0, MAX_HEADERS_PER_SAMPLE)
      .map((a: any) => String(a?.header ?? "Untitled question")),
  };

  if (mode === "scan") return { sample, wrote: false };

  // includeErrors is what separates this from the normal Bulk Flip: without it
  // adminFlipFinding would set the score to 100 and leave the word "Error"
  // still rendering on the question.
  const { adminFlipFinding } = await import("@review/domain/business/review-queue/mod.ts");
  const r = await adminFlipFinding(orgId, findingId, flippedBy, { includeErrors: true });
  if (!r.success) throw new Error(`adminFlipFinding returned success=false for ${findingId}`);
  console.log(`[ERROR-FLIP] 🔧 flipped fid=${findingId} errors=${sample.errorCount} realFails=${sample.realFailCount} → 100%`);
  return { sample, wrote: true };
}

/** Process a batch of findingIds with bounded fan-out. allSettled so one bad
 *  row can't discard the whole batch's tallies. Mirrors
 *  processTranscriptRepairBatch. */
export async function processErrorFlipBatch(
  orgId: OrgId,
  fids: string[],
  mode: ErrorFlipMode = "scan",
  flippedBy = "admin",
): Promise<ErrorFlipBatchResult> {
  const totals = emptyResult();
  const concurrency = mode === "flip" ? FLIP_CONCURRENCY : SCAN_CONCURRENCY;

  for (let i = 0; i < fids.length; i += concurrency) {
    const slice = fids.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      slice.map((fid) => inspectOne(orgId, fid, mode, flippedBy)),
    );
    for (let j = 0; j < results.length; j++) {
      const res = results[j];
      totals.scanned++;
      if (res.status === "rejected") {
        totals.errors++;
        console.warn(`[ERROR-FLIP] ⚠️ failed fid=${slice[j]}:`, res.reason);
        continue;
      }
      if (res.value === null) {
        totals.missing++;
        continue;
      }
      const { sample, wrote } = res.value;
      if (!sample) {
        totals.clean++;
        continue;
      }
      totals.impacted++;
      totals.errorQuestions += sample.errorCount;
      totals.realFails += sample.realFailCount;
      if (wrote) totals.flipped++;
      totals.impactedFids.push(sample.findingId);
      if (totals.samples.length < MAX_SAMPLES_PER_BATCH) totals.samples.push(sample);
    }
  }

  console.log(
    `[ERROR-FLIP] ⚙️ batch orgId=${orgId} mode=${mode} fids=${fids.length} scanned=${totals.scanned} ` +
      `clean=${totals.clean} impacted=${totals.impacted} errorQuestions=${totals.errorQuestions} ` +
      `realFails=${totals.realFails} flipped=${totals.flipped} missing=${totals.missing} errors=${totals.errors}`,
  );
  return totals;
}
