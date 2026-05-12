/** Shared in-memory job state for the chunked bulk-flip flow.
 *
 *  The Bulk Flip "Flip All" action processes hundreds/thousands of audits
 *  via sequential 50-at-a-time batches. State lives here so /flip-start
 *  (kickoff) and /flip-tick (per-batch worker) can both read/write it
 *  without round-tripping to Firestore for every tick.
 *
 *  Per-isolate. If Deno Deploy recycles the isolate mid-job, the job is
 *  lost and the user has to re-click Flip All — acceptable: rare, and
 *  every successful tick is durably reflected in the flipped audits'
 *  audit-finding + audit-done-idx records. No data is at risk, only the
 *  resume-where-we-left-off convenience.
 *
 *  Jobs auto-evict after 5 minutes of idleness so a stale isolate doesn't
 *  leak memory if a user closes the modal mid-run. */

export interface FlipJob {
  /** IDs still to flip. Mutated in place by each tick (splice from front). */
  remaining: string[];
  /** Original count. Drives the progress denominator. */
  total: number;
  /** Successful flips so far. */
  flipped: number;
  /** Failed finding IDs. Surface to the user at the end. */
  failed: string[];
  /** When the job started — for elapsed-time display. */
  startedAt: number;
  /** Last-touched timestamp — drives auto-eviction. */
  lastTouchedAt: number;
}

const _jobs = new Map<string, FlipJob>();
const JOB_TTL_MS = 5 * 60 * 1000;

export function createFlipJob(ids: string[]): { jobId: string; job: FlipJob } {
  const jobId = crypto.randomUUID().slice(0, 8);
  const now = Date.now();
  const job: FlipJob = {
    remaining: ids.slice(),
    total: ids.length,
    flipped: 0,
    failed: [],
    startedAt: now,
    lastTouchedAt: now,
  };
  _jobs.set(jobId, job);
  evictStaleJobs();
  return { jobId, job };
}

export function getFlipJob(jobId: string): FlipJob | null {
  const job = _jobs.get(jobId);
  if (!job) return null;
  job.lastTouchedAt = Date.now();
  return job;
}

export function deleteFlipJob(jobId: string): void {
  _jobs.delete(jobId);
}

function evictStaleJobs(): void {
  const now = Date.now();
  for (const [id, job] of _jobs.entries()) {
    if (now - job.lastTouchedAt > JOB_TTL_MS) _jobs.delete(id);
  }
}

/** Test-only: clear the registry so tests don't see entries from prior tests. */
export function _resetFlipJobsForTests(): void {
  _jobs.clear();
}
