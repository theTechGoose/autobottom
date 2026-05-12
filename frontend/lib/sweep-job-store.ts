/** Shared in-memory job state for the chunked Cleanup sweep flow.
 *
 *  The Cleanup → Run Sweep action scans every completed-audit-stat row
 *  and per-fid checks whether the finding doc is actually in a finished
 *  state. With thousands of stat rows + a Firestore read per fid, a single
 *  HTTP request times out at the edge. Chunked sweep solves that:
 *  /sweep-start fetches the full fid list (one fast scan), creates a job,
 *  then /sweep-tick processes a 25-fid chunk per tick until empty.
 *
 *  Per-isolate. If Deno Deploy recycles the isolate mid-sweep, the job is
 *  lost — but every successful chunk's drains are durable in Firestore.
 *  User just re-clicks Run Sweep; the next list-fids call won't include
 *  the already-cleaned ones.
 *
 *  Mirrors lib/flip-job-store.ts intentionally; if you change one keep
 *  them in sync. */

export interface SweepJob {
  /** Finding IDs still to scan. Mutated in place by each tick (splice from front). */
  remaining: string[];
  /** Original count. Drives the progress denominator. */
  total: number;
  /** Number of fids drained (orphan, not-finished, or missing). */
  swept: number;
  /** Number of fids left alone (status === "finished" + answeredQuestions populated). */
  healthy: number;
  /** Number of fids whose finding doc was missing entirely. */
  missing: number;
  /** Drained fids so the operator can see exactly which audits got reset. */
  drained: string[];
  /** When the job started — for elapsed-time display. */
  startedAt: number;
  /** Last-touched timestamp — drives auto-eviction. */
  lastTouchedAt: number;
}

const _jobs = new Map<string, SweepJob>();
const JOB_TTL_MS = 10 * 60 * 1000;

export function createSweepJob(fids: string[]): { jobId: string; job: SweepJob } {
  const jobId = crypto.randomUUID().slice(0, 8);
  const now = Date.now();
  const job: SweepJob = {
    remaining: fids.slice(),
    total: fids.length,
    swept: 0,
    healthy: 0,
    missing: 0,
    drained: [],
    startedAt: now,
    lastTouchedAt: now,
  };
  _jobs.set(jobId, job);
  evictStaleJobs();
  return { jobId, job };
}

export function getSweepJob(jobId: string): SweepJob | null {
  const job = _jobs.get(jobId);
  if (!job) return null;
  job.lastTouchedAt = Date.now();
  return job;
}

export function deleteSweepJob(jobId: string): void {
  _jobs.delete(jobId);
}

function evictStaleJobs(): void {
  const now = Date.now();
  for (const [id, job] of _jobs.entries()) {
    if (now - job.lastTouchedAt > JOB_TTL_MS) _jobs.delete(id);
  }
}
