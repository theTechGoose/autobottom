/** Types + helper for the "Force to 100%" tool (Bulk Flip tab).
 *
 *  Mirrors the backend ForceHundredSnapshot. Like Genie Retry, the run lives in
 *  Firestore on the backend, so the frontend keeps no state — it renders the
 *  snapshot each tick. */

/** One audit the run touched, for the result table. */
export interface ForceHundredResultRow {
  findingId: string;
  ok: boolean;
  recordId?: string;
  recordingId?: string;
  voName?: string;
  completedAt?: number;
}

export interface ForceHundredSnapshot {
  jobId: string;
  since: number;
  until: number;
  total: number;
  flipped: number;
  failed: number;
  pendingCount: number;
  results: ForceHundredResultRow[];
  startedAt: number;
  done: boolean;
}

/** Audits the run has finished with — flipped or failed. */
export function processedCount(snap: ForceHundredSnapshot): number {
  return snap.flipped + snap.failed;
}
