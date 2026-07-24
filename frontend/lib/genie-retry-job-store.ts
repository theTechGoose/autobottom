/** Shared in-memory job state for the "Genie Retry" bulk re-run.
 *
 *  Unlike the other chunked maintenance jobs, this one isn't just splitting a
 *  long read across requests — it's a CONCURRENCY GATE. Each re-run puts a real
 *  audit back through the whole pipeline (download → transcribe → grade), which
 *  takes a minute or two, so the tick loop keeps at most MAX_IN_FLIGHT audits
 *  moving at once: poll the in-flight ones, retire the finished, top the slots
 *  back up from the pending queue. Genie and AssemblyAI never see the whole
 *  window at once.
 *
 *  Per-isolate. If Deno Deploy recycles the isolate mid-run the job is lost, but
 *  nothing is corrupted: audits already requeued keep running to completion on
 *  their own, and re-running the tool just picks up whatever is still invalid.
 *  Mirrors lib/transcript-repair-job-store.ts. */

/** Audits in flight at once. Each one is a full pipeline run. */
export const MAX_IN_FLIGHT = 5;

/** How long a single audit may sit in flight before we stop waiting on it and
 *  free its slot. Normal runs finish in 1-2 min; the pipeline's own genie retry
 *  ladder can legitimately stretch one to ~30 min, so this is deliberately
 *  generous. A stalled audit is reported, not silently dropped. */
export const STALL_TIMEOUT_MS = 35 * 60 * 1000;

/** Index-row metadata, so the result table can name the audits. */
export interface GenieRetryMeta {
  completedAt?: number;
  recordId?: string;
  recordingId?: string;
  voName?: string;
  department?: string;
}

/** An audit that finished its re-run, kept for the result table. */
export interface GenieRetryResult {
  findingId: string;
  state: "valid" | "invalid" | "missing" | "stalled";
  score?: number;
  transcriptChars?: number;
}

export interface GenieRetryJob {
  since: number;
  until: number;
  /** Not yet requeued. Spliced from the front as slots free up. */
  pending: string[];
  /** Requeued and still running, with the ms timestamp we started waiting. */
  inFlight: Map<string, number>;
  /** Original candidate count — the progress denominator. */
  total: number;
  meta: Map<string, GenieRetryMeta>;
  /** Counters shown next to the bar. `queued` counts every audit successfully
   *  handed to the pipeline; the other three are terminal verdicts. */
  queued: number;
  valid: number;
  invalid: number;
  missing: number;
  stalled: number;
  /** Requeue calls that threw — never handed to the pipeline at all. */
  failed: number;
  results: GenieRetryResult[];
  startedAt: number;
  lastTouchedAt: number;
}

/** Result rows kept for the terminal table. A huge window must not turn the
 *  progress fragment into megabytes of HTML on every tick. */
export const MAX_TRACKED_RESULTS = 500;

const _jobs = new Map<string, GenieRetryJob>();
const JOB_TTL_MS = 90 * 60 * 1000;

export function createGenieRetryJob(opts: {
  since: number;
  until: number;
  fids: string[];
  meta: Map<string, GenieRetryMeta>;
}): { jobId: string; job: GenieRetryJob } {
  const jobId = crypto.randomUUID().slice(0, 8);
  const now = Date.now();
  const job: GenieRetryJob = {
    since: opts.since,
    until: opts.until,
    pending: opts.fids.slice(),
    inFlight: new Map(),
    total: opts.fids.length,
    meta: opts.meta,
    queued: 0,
    valid: 0,
    invalid: 0,
    missing: 0,
    stalled: 0,
    failed: 0,
    results: [],
    startedAt: now,
    lastTouchedAt: now,
  };
  _jobs.set(jobId, job);
  evictStaleJobs();
  return { jobId, job };
}

export function getGenieRetryJob(jobId: string): GenieRetryJob | null {
  const job = _jobs.get(jobId);
  if (!job) return null;
  job.lastTouchedAt = Date.now();
  return job;
}

export function deleteGenieRetryJob(jobId: string): void {
  _jobs.delete(jobId);
}

/** Audits that reached a verdict — the "ran through the pipeline" count. */
export function processedCount(job: GenieRetryJob): number {
  return job.valid + job.invalid + job.missing + job.stalled + job.failed;
}

export function isDone(job: GenieRetryJob): boolean {
  return job.pending.length === 0 && job.inFlight.size === 0;
}

function evictStaleJobs(): void {
  const now = Date.now();
  for (const [id, job] of _jobs.entries()) {
    if (now - job.lastTouchedAt > JOB_TTL_MS) _jobs.delete(id);
  }
}
