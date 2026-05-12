/** Shared in-memory job state for the Cleanup → Re-trigger flow.
 *
 *  Two phases: (1) scan creates a job in pending state with the matched
 *  fid list and renders a confirmation fragment with a "Re-trigger N
 *  audits" button; (2) clicking that button transitions the job to
 *  running and starts the tick loop that processes 25 fids per batch.
 *
 *  Per-isolate. Lost on isolate restart — operator just re-scans. */

export type SweepPhase = "pending" | "running" | "done";

export interface RetriggerJob {
  /** All matched fids — stable list captured at scan time. */
  allFids: string[];
  /** Fids still to process (consumed by tick). */
  remaining: string[];
  /** Total scanned (drives the denominator). */
  total: number;
  /** Successfully published step-init. */
  requeued: number;
  /** Fids whose publishStep call threw. */
  failed: string[];
  phase: SweepPhase;
  startedAt: number;
  lastTouchedAt: number;
}

const _jobs = new Map<string, RetriggerJob>();
const JOB_TTL_MS = 15 * 60 * 1000;

export function createRetriggerJob(fids: string[]): { jobId: string; job: RetriggerJob } {
  const jobId = crypto.randomUUID().slice(0, 8);
  const now = Date.now();
  const job: RetriggerJob = {
    allFids: fids.slice(),
    remaining: [],
    total: fids.length,
    requeued: 0,
    failed: [],
    phase: "pending",
    startedAt: now,
    lastTouchedAt: now,
  };
  _jobs.set(jobId, job);
  evictStaleJobs();
  return { jobId, job };
}

export function getRetriggerJob(jobId: string): RetriggerJob | null {
  const job = _jobs.get(jobId);
  if (!job) return null;
  job.lastTouchedAt = Date.now();
  return job;
}

export function startRetriggerJob(jobId: string): RetriggerJob | null {
  const job = _jobs.get(jobId);
  if (!job) return null;
  if (job.phase === "pending") {
    job.remaining = job.allFids.slice();
    job.phase = "running";
    job.startedAt = Date.now();
  }
  job.lastTouchedAt = Date.now();
  return job;
}

export function deleteRetriggerJob(jobId: string): void {
  _jobs.delete(jobId);
}

function evictStaleJobs(): void {
  const now = Date.now();
  for (const [id, job] of _jobs.entries()) {
    if (now - job.lastTouchedAt > JOB_TTL_MS) _jobs.delete(id);
  }
}
