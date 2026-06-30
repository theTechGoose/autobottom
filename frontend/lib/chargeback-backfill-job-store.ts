/** Shared in-memory job state for the chunked "Backfill Chargeback Entries"
 *  (payroll sheet repair) flow.
 *
 *  Repairing the chargeback/wire sheet re-reads a getFinding per entry; over a
 *  pay-period window that's hundreds of Firestore reads, which blows the Deno
 *  Deploy edge request timeout in one shot. So /chargeback-backfill-start lists
 *  the fids once (cheap index reads), creates a job, and /chargeback-backfill-tick
 *  processes a 25-fid chunk per tick until empty — each request stays short.
 *
 *  Per-isolate. If Deno Deploy recycles the isolate mid-run the job is lost, but
 *  every processed chunk's writes are durable; the operator just re-runs and the
 *  next list won't re-touch already-correct entries. Mirrors lib/sweep-job-store.ts. */

export interface CbBackfillJob {
  /** Finding IDs still to process. Spliced from the front each tick. */
  remaining: string[];
  /** Original count — the progress denominator. */
  total: number;
  /** Running tallies across processed chunks. */
  scanned: number;
  cbUpdated: number;
  cbDeleted: number;
  wireUpdated: number;
  wireDeleted: number;
  startedAt: number;
  lastTouchedAt: number;
}

const _jobs = new Map<string, CbBackfillJob>();
const JOB_TTL_MS = 10 * 60 * 1000;

export function createCbBackfillJob(fids: string[]): { jobId: string; job: CbBackfillJob } {
  const jobId = crypto.randomUUID().slice(0, 8);
  const now = Date.now();
  const job: CbBackfillJob = {
    remaining: fids.slice(),
    total: fids.length,
    scanned: 0,
    cbUpdated: 0,
    cbDeleted: 0,
    wireUpdated: 0,
    wireDeleted: 0,
    startedAt: now,
    lastTouchedAt: now,
  };
  _jobs.set(jobId, job);
  evictStaleJobs();
  return { jobId, job };
}

export function getCbBackfillJob(jobId: string): CbBackfillJob | null {
  const job = _jobs.get(jobId);
  if (!job) return null;
  job.lastTouchedAt = Date.now();
  return job;
}

export function deleteCbBackfillJob(jobId: string): void {
  _jobs.delete(jobId);
}

function evictStaleJobs(): void {
  const now = Date.now();
  for (const [id, job] of _jobs.entries()) {
    if (now - job.lastTouchedAt > JOB_TTL_MS) _jobs.delete(id);
  }
}
