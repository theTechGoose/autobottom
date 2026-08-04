/** Shared in-memory job state for the chunked "Error-Answer Cleanup" flow.
 *
 *  Whether an audit carries an ungraded "Error" answer is only knowable from
 *  its answeredQuestions, which lives on the finding doc — so this is one
 *  chunked-doc read per finding. Over a month that is thousands of Firestore
 *  reads, which blows the Deno Deploy edge request timeout in one shot. So
 *  /error-flip-start lists the window's audits once (a single indexed query),
 *  creates a job, and /error-flip-tick processes a chunk per tick until empty —
 *  each request stays short.
 *
 *  Per-isolate. If Deno Deploy recycles the isolate mid-run the job is lost; in
 *  `scan` mode nothing was written anyway, and in `flip` mode every processed
 *  chunk's writes are durable and the flip is idempotent (a flipped audit has
 *  no Error answers left) — the operator just re-runs. Mirrors
 *  lib/transcript-repair-job-store.ts. */

export type ErrorFlipMode = "scan" | "flip";

/** Metadata from the audit-done-idx row, so the terminal card can show WHICH
 *  audits are impacted — in particular the ones a human already reviewed, whose
 *  verdict this flip is about to overwrite. */
export interface ErrorFlipMeta {
  completedAt?: number;
  score?: number;
  reviewedBy?: string;
  voName?: string;
  department?: string;
}

export interface ErrorFlipSample {
  findingId: string;
  errorCount: number;
  realFailCount: number;
  totalQuestions: number;
  errorHeaders: string[];
}

export interface ErrorFlipJob {
  mode: ErrorFlipMode;
  /** Echoed back so the "Flip" button can re-run the same window. */
  since: number;
  until: number;
  /** Email stamped as the reviewer on every flipped audit. */
  flippedBy: string;
  /** Finding IDs still to process. Spliced from the front each tick. */
  remaining: string[];
  /** Original count — the progress denominator. */
  total: number;
  meta: Map<string, ErrorFlipMeta>;
  /** Running tallies across processed chunks. */
  scanned: number;
  clean: number;
  impacted: number;
  errorQuestions: number;
  /** Genuine "No" verdicts on impacted audits — erased by a force-to-100. */
  realFails: number;
  flipped: number;
  missing: number;
  errors: number;
  /** Impacted audits, for the terminal card's table. Capped — a pathological
   *  window must not turn the result fragment into megabytes of HTML. */
  impactedFids: string[];
  samples: ErrorFlipSample[];
  startedAt: number;
  lastTouchedAt: number;
}

export const MAX_TRACKED_FIDS = 500;
export const MAX_TRACKED_SAMPLES = 10;

const _jobs = new Map<string, ErrorFlipJob>();
const JOB_TTL_MS = 10 * 60 * 1000;

export function createErrorFlipJob(opts: {
  mode: ErrorFlipMode;
  since: number;
  until: number;
  flippedBy: string;
  fids: string[];
  meta: Map<string, ErrorFlipMeta>;
}): { jobId: string; job: ErrorFlipJob } {
  const jobId = crypto.randomUUID().slice(0, 8);
  const now = Date.now();
  const job: ErrorFlipJob = {
    mode: opts.mode,
    since: opts.since,
    until: opts.until,
    flippedBy: opts.flippedBy,
    remaining: opts.fids.slice(),
    total: opts.fids.length,
    meta: opts.meta,
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
    startedAt: now,
    lastTouchedAt: now,
  };
  _jobs.set(jobId, job);
  evictStaleJobs();
  return { jobId, job };
}

export function getErrorFlipJob(jobId: string): ErrorFlipJob | null {
  const job = _jobs.get(jobId);
  if (!job) return null;
  job.lastTouchedAt = Date.now();
  return job;
}

export function deleteErrorFlipJob(jobId: string): void {
  _jobs.delete(jobId);
}

function evictStaleJobs(): void {
  const now = Date.now();
  for (const [id, job] of _jobs.entries()) {
    if (now - job.lastTouchedAt > JOB_TTL_MS) _jobs.delete(id);
  }
}
