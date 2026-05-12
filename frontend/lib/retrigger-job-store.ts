/** Shared in-memory job state for the Cleanup → Re-trigger flow.
 *
 *  Four phases:
 *  - "scanning":  iterating user's pasted fid list, per-fid getFinding
 *                 to confirm date + status. Accumulates matches.
 *  - "pending":   scan done. Operator sees count + Re-trigger/Cancel.
 *  - "running":   operator confirmed; ticking publishStep per match.
 *  - "done":      terminal.
 *
 *  Per-isolate. Lost on isolate restart — operator re-pastes. */

export type RetriggerPhase = "scanning" | "pending" | "running" | "done";

export interface RetriggerJob {
  /** All fids the operator pasted (original list). */
  allFids: string[];
  /** Fids still to scan in this phase. Drained by scan-tick. */
  scanRemaining: string[];
  /** Fids accumulated as matching the filter so far. Becomes
   *  the run-remaining when phase transitions to running. */
  matches: string[];
  /** Fids rejected because status === "finished". */
  rejectedFinished: number;
  /** Fids rejected because startedAt outside [since, until]. */
  rejectedOutOfRange: number;
  /** Fids rejected because audit-finding doc was missing. */
  rejectedMissing: number;
  /** Date filter (millis). */
  sinceMs: number;
  untilMs: number;
  /** Run phase: fids still to publishStep. Drained by retrigger-tick. */
  remaining: string[];
  /** Successfully published step-init. */
  requeued: number;
  /** Fids whose publishStep call threw. */
  failed: string[];
  phase: RetriggerPhase;
  startedAt: number;
  lastTouchedAt: number;
}

const _jobs = new Map<string, RetriggerJob>();
const JOB_TTL_MS = 15 * 60 * 1000;

export function createRetriggerJob(
  fids: string[],
  sinceMs: number,
  untilMs: number,
): { jobId: string; job: RetriggerJob } {
  const jobId = crypto.randomUUID().slice(0, 8);
  const now = Date.now();
  const job: RetriggerJob = {
    allFids: fids.slice(),
    scanRemaining: fids.slice(),
    matches: [],
    rejectedFinished: 0,
    rejectedOutOfRange: 0,
    rejectedMissing: 0,
    sinceMs,
    untilMs,
    remaining: [],
    requeued: 0,
    failed: [],
    phase: "scanning",
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
    job.remaining = job.matches.slice();
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
