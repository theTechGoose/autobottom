/** Types + tiny helpers for the "Genie Retry" bulk re-run.
 *
 *  There is deliberately NO in-memory job here anymore. The job lives in
 *  Firestore on the backend (see src/audit/domain/business/genie-retry/mod.ts):
 *  on Deno Deploy the app is many short-lived isolates with no request
 *  affinity, so a job kept in one isolate's memory was invisible to the next
 *  tick and every run died with "job not found". The frontend is now a thin
 *  renderer over the backend's snapshot. */

/** Audits in flight at once — mirrors the backend constant, shown in the UI
 *  copy. The gate itself is enforced server-side. */
export const MAX_IN_FLIGHT = 5;

/** One finished audit in the result table. Shape matches the backend's
 *  GenieRetryResultRow. */
export interface GenieRetryResultRow {
  findingId: string;
  state: "valid" | "invalid" | "missing" | "stalled";
  score?: number;
  transcriptChars?: number;
  recordId?: string;
  recordingId?: string;
  voName?: string;
  completedAt?: number;
}

/** Everything the progress fragment renders from — one backend round-trip per
 *  tick returns exactly this. Mirrors the backend's GenieRetrySnapshot. */
export interface GenieRetrySnapshot {
  jobId: string;
  since: number;
  until: number;
  total: number;
  queued: number;
  valid: number;
  invalid: number;
  missing: number;
  stalled: number;
  failed: number;
  pendingCount: number;
  inFlightCount: number;
  results: GenieRetryResultRow[];
  startedAt: number;
  done: boolean;
}

/** Audits that reached a verdict — the "ran through the pipeline" count. */
export function processedCount(snap: GenieRetrySnapshot): number {
  return snap.valid + snap.invalid + snap.missing + snap.stalled + snap.failed;
}
