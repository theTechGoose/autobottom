/** Shared in-memory job state for the chunked "Transcript Repair" flow.
 *
 *  Classifying a window's transcripts is one chunked-doc read per finding; over
 *  a month that's thousands of Firestore reads, which blows the Deno Deploy edge
 *  request timeout in one shot. So /transcript-repair-start lists the audits once
 *  (a single indexed query), creates a job, and /transcript-repair-tick processes
 *  a chunk per tick until empty — each request stays short.
 *
 *  Per-isolate. If Deno Deploy recycles the isolate mid-run the job is lost; in
 *  `scan` mode nothing was written anyway, and in `repair` mode every processed
 *  chunk's writes are durable and the repair is idempotent — the operator just
 *  re-runs. Mirrors lib/chargeback-backfill-job-store.ts. */

export type TranscriptRepairMode = "scan" | "repair";

/** Metadata from the audit-done-idx row, so the terminal card can show WHICH
 *  audits were impacted — and in particular which of them a human already
 *  reviewed off the contaminated text. */
export interface TranscriptRepairMeta {
  completedAt?: number;
  score?: number;
  reviewedBy?: string;
  voName?: string;
}

export interface TranscriptRepairSample {
  findingId: string;
  method: string;
  precision?: number;
  recall?: number;
  storedLen: number;
  repairedLen: number;
  excerpt: string;
}

export interface TranscriptRepairJob {
  mode: TranscriptRepairMode;
  /** Echoed back so the "Repair" button can re-run the same window. */
  since: number;
  until: number;
  /** Finding IDs still to process. Spliced from the front each tick. */
  remaining: string[];
  /** Original count — the progress denominator. */
  total: number;
  meta: Map<string, TranscriptRepairMeta>;
  /** Running tallies across processed chunks. */
  scanned: number;
  clean: number;
  contaminated: number;
  fenced: number;
  filtered: number;
  reverted: number;
  repaired: number;
  missing: number;
  errors: number;
  /** Impacted audits, for the terminal card's table. Capped — a pathological
   *  window must not turn the result fragment into megabytes of HTML. */
  contaminatedFids: string[];
  samples: TranscriptRepairSample[];
  startedAt: number;
  lastTouchedAt: number;
}

export const MAX_TRACKED_FIDS = 500;
export const MAX_TRACKED_SAMPLES = 10;

const _jobs = new Map<string, TranscriptRepairJob>();
const JOB_TTL_MS = 10 * 60 * 1000;

export function createTranscriptRepairJob(opts: {
  mode: TranscriptRepairMode;
  since: number;
  until: number;
  fids: string[];
  meta: Map<string, TranscriptRepairMeta>;
}): { jobId: string; job: TranscriptRepairJob } {
  const jobId = crypto.randomUUID().slice(0, 8);
  const now = Date.now();
  const job: TranscriptRepairJob = {
    mode: opts.mode,
    since: opts.since,
    until: opts.until,
    remaining: opts.fids.slice(),
    total: opts.fids.length,
    meta: opts.meta,
    scanned: 0,
    clean: 0,
    contaminated: 0,
    fenced: 0,
    filtered: 0,
    reverted: 0,
    repaired: 0,
    missing: 0,
    errors: 0,
    contaminatedFids: [],
    samples: [],
    startedAt: now,
    lastTouchedAt: now,
  };
  _jobs.set(jobId, job);
  evictStaleJobs();
  return { jobId, job };
}

export function getTranscriptRepairJob(jobId: string): TranscriptRepairJob | null {
  const job = _jobs.get(jobId);
  if (!job) return null;
  job.lastTouchedAt = Date.now();
  return job;
}

export function deleteTranscriptRepairJob(jobId: string): void {
  _jobs.delete(jobId);
}

function evictStaleJobs(): void {
  const now = Date.now();
  for (const [id, job] of _jobs.entries()) {
    if (now - job.lastTouchedAt > JOB_TTL_MS) _jobs.delete(id);
  }
}
