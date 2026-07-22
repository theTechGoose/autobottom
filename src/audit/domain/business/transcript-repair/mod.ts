/** Retroactive repair for transcripts that hold model output instead of speech.
 *
 *  Two shapes have reached production storage:
 *    - a REFUSAL ("Please share the audio file…", report 76UGB0H1yVYu54OHQgGVe)
 *    - COMMENTARY — a markdown critique of a previous attempt with the real
 *      transcript buried in a code fence (report 4oL3fw_Coxvzpx7El_qip)
 *
 *  Both were stored as `audit-transcript.diarized` and rendered to reviewers,
 *  judges, and managers as if they were the audit record. The pipeline fix stops
 *  new ones; this module cleans up the ones already on disk.
 *
 *  Two modes, driven by two separate buttons in Data Maintenance → Transcript
 *  Repair, so counting is never coupled to changing:
 *    - `scan`   — classify only. ZERO writes. Answers "how many are impacted?"
 *    - `repair` — write the extracted transcript back (or raw when nothing is
 *                 salvageable). Idempotent: a repaired row classifies `clean`.
 *
 *  Deliberately touches the TRANSCRIPT doc only, never the finding doc:
 *  saveFinding is a full-document overwrite, and racing it is exactly what lost
 *  BofFRUvr… (see the note in step-diarize-async). Legacy findings that carry
 *  `diarizedTranscript` inline are handled by the read-side `safeDiarized`
 *  guard instead. */

import type { OrgId } from "@core/data/deno-kv/mod.ts";
import { getTranscript, saveTranscript } from "@audit/domain/data/audit-repository/mod.ts";
import {
  type DiarizeMethod,
  extractDiarizedTranscript,
} from "@core/business/diarization-validation/mod.ts";

/** One audit in the scan window, with the metadata the operator needs to judge
 *  whether an already-reviewed audit was graded off a contaminated transcript. */
export interface TranscriptRepairCandidate {
  findingId: string;
  completedAt?: number;
  score?: number;
  reviewedBy?: string;
  voName?: string;
}

export type TranscriptRepairMode = "scan" | "repair";

/** Evidence for one contaminated transcript. `excerpt` is the head of the
 *  offending stored string — it is what the operator eyeballs before repairing,
 *  and the capture path for the regression fixture in
 *  `@core/business/diarization-validation/test.ts`. */
export interface TranscriptRepairSample {
  findingId: string;
  method: DiarizeMethod;
  precision?: number;
  recall?: number;
  storedLen: number;
  repairedLen: number;
  excerpt: string;
}

export interface TranscriptRepairBatchResult {
  scanned: number;
  /** Transcripts that are already fine — the overwhelming majority. */
  clean: number;
  /** Transcripts holding model output. `= fenced + filtered + reverted`. */
  contaminated: number;
  /** Contaminated rows whose transcript was lifted out of a code fence. */
  fenced: number;
  /** Contaminated rows repaired by dropping every non-turn line. */
  filtered: number;
  /** Contaminated rows with nothing salvageable — fall back to the raw transcript. */
  reverted: number;
  /** Rows actually written. Always 0 in `scan` mode. */
  repaired: number;
  /** Findings in the window with no stored transcript doc. */
  missing: number;
  errors: number;
  samples: TranscriptRepairSample[];
}

/** Cap on how many offending excerpts we ship back per batch. The excerpts are
 *  multi-KB; without a cap a bad window would return megabytes of HTML. */
const MAX_SAMPLES_PER_BATCH = 10;
const EXCERPT_CHARS = 1200;
const CONCURRENCY = 20;

function emptyResult(): TranscriptRepairBatchResult {
  return {
    scanned: 0,
    clean: 0,
    contaminated: 0,
    fenced: 0,
    filtered: 0,
    reverted: 0,
    repaired: 0,
    missing: 0,
    errors: 0,
    samples: [],
  };
}

/** Every audit completed in the window, newest metadata included. One indexed
 *  query — same shape as listChargebackBackfillFids. */
export async function listTranscriptRepairFids(
  orgId: OrgId,
  since: number,
  until: number,
): Promise<TranscriptRepairCandidate[]> {
  const { listStoredByCompletedAt } = await import("@core/data/firestore/mod.ts");
  const rows = await listStoredByCompletedAt<{
    findingId?: string;
    completedAt?: number;
    score?: number;
    reviewedBy?: string;
    voName?: string;
  }>("audit-done-idx", orgId, since, until, { limit: 500_000 });

  // One audit can own several index rows (re-review, flip, appeal). Dedupe by
  // findingId, keeping the newest row so `reviewedBy` reflects the final state.
  const byFid = new Map<string, TranscriptRepairCandidate>();
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
    });
  }
  const out = [...byFid.values()];
  console.log(`[TRANSCRIPT-REPAIR] 📋 list orgId=${orgId} since=${since} until=${until} → ${out.length} audits (${rows.length} index rows)`);
  return out;
}

/** Classify one stored transcript, and in `repair` mode write the clean text
 *  back. Returns null when the finding has no transcript doc. */
async function repairOne(
  orgId: OrgId,
  findingId: string,
  mode: TranscriptRepairMode,
): Promise<{ method: DiarizeMethod; sample: TranscriptRepairSample | null; wrote: boolean } | null> {
  const stored = await getTranscript(orgId, findingId);
  if (!stored) return null;

  const raw = stored.raw ?? "";
  const diarized = stored.diarized ?? "";
  // Nothing to judge: no diarization was ever stored, or it IS the raw text
  // (the existing fallback). Both are already correct.
  if (!diarized || diarized === raw) return { method: "clean", sample: null, wrote: false };

  const { text, method, fidelity } = extractDiarizedTranscript(diarized, raw);
  if (method === "clean") return { method, sample: null, wrote: false };

  const sample: TranscriptRepairSample = {
    findingId,
    method,
    precision: fidelity?.precision,
    recall: fidelity?.recall,
    storedLen: diarized.length,
    repairedLen: text.length,
    excerpt: diarized.slice(0, EXCERPT_CHARS),
  };

  if (mode === "scan") return { method, sample, wrote: false };

  // saveTranscript is read-modify-write on the transcript doc; utteranceTimes
  // are preserved by its own merge.
  await saveTranscript(orgId, findingId, raw, text);
  console.log(`[TRANSCRIPT-REPAIR] 🔧 repaired fid=${findingId} method=${method} ${diarized.length}→${text.length} chars`);
  return { method, sample, wrote: true };
}

/** Process a batch of findingIds with bounded fan-out. Mirrors
 *  processChargebackBackfillBatch: allSettled so one bad row can't discard the
 *  whole batch's tallies. */
export async function processTranscriptRepairBatch(
  orgId: OrgId,
  fids: string[],
  mode: TranscriptRepairMode = "scan",
): Promise<TranscriptRepairBatchResult> {
  const totals = emptyResult();

  for (let i = 0; i < fids.length; i += CONCURRENCY) {
    const slice = fids.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(slice.map((fid) => repairOne(orgId, fid, mode)));
    for (let j = 0; j < results.length; j++) {
      const res = results[j];
      totals.scanned++;
      if (res.status === "rejected") {
        totals.errors++;
        console.warn(`[TRANSCRIPT-REPAIR] ⚠️ failed fid=${slice[j]}:`, res.reason);
        continue;
      }
      if (res.value === null) {
        totals.missing++;
        continue;
      }
      const { method, sample, wrote } = res.value;
      if (method === "clean") {
        totals.clean++;
        continue;
      }
      totals.contaminated++;
      if (method === "fenced") totals.fenced++;
      else if (method === "filtered") totals.filtered++;
      else totals.reverted++;
      if (wrote) totals.repaired++;
      if (sample && totals.samples.length < MAX_SAMPLES_PER_BATCH) totals.samples.push(sample);
    }
  }

  console.log(
    `[TRANSCRIPT-REPAIR] ⚙️ batch orgId=${orgId} mode=${mode} fids=${fids.length} scanned=${totals.scanned} ` +
      `clean=${totals.clean} contaminated=${totals.contaminated} (fenced=${totals.fenced} filtered=${totals.filtered} reverted=${totals.reverted}) ` +
      `repaired=${totals.repaired} missing=${totals.missing} errors=${totals.errors}`,
  );
  return totals;
}
