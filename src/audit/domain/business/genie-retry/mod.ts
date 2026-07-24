/** Bulk re-run for audits that finished as "Invalid Genie".
 *
 *  When the recording database we search is temporarily wrong, step-init can't
 *  find the audio, exhausts its retries, and finalizes the audit at 0% with the
 *  sentinel transcript "Invalid Genie". Once the database is healthy again those
 *  recordings ARE there — but nothing re-drives the audits, and re-running them
 *  one at a time from /admin/audits is impractical at volume.
 *
 *  Building blocks (each pure-ish, no shared state):
 *    - listInvalidGenieFindings  — one indexed query, zero writes
 *    - requeueGenieRetryBatch    — reset + re-publish step-init for a batch
 *    - checkGenieRetryOutcomes   — read each finding back and classify it
 *
 *  The JOB layer on top of them (startGenieRetryJob / advanceGenieRetryJob)
 *  keeps a fixed number of audits in flight by only requeueing as many as have
 *  finished, so Genie/AssemblyAI never see the whole window at once.
 *
 *  CRITICAL: the job lives in Firestore, not in a server's memory. On Deno
 *  Deploy the app runs as many short-lived isolates with no request affinity —
 *  the request that starts a run and the one that ticks it 4s later almost
 *  never hit the same isolate, and every deploy swaps them all. An in-memory
 *  job map is invisible to the next tick ("job not found"). Persisting the job
 *  and advancing it one load-modify-save at a time makes isolate identity
 *  irrelevant; HTMX serialises the ticks so there is no concurrent writer.
 *
 *  Requeue is reset-then-republish, matching /admin/reset-finding:
 *  resetFindingDerivedState clears the OUTSIDE stores (review queue,
 *  audit-done-idx, chargeback/wire), clearFindingRunState clears the finding
 *  doc's own run state. Skipping the second one makes the whole re-run a no-op —
 *  step-transcribe short-circuits on the stale sentinel and finalize re-writes
 *  an identical 0%. */

import type { OrgId } from "@core/data/deno-kv/mod.ts";
import { getFinding, clearFindingRunState } from "@audit/domain/data/audit-repository/mod.ts";
import { publishStep } from "@core/data/qstash/mod.ts";
import { deleteStored, getStored, setStored } from "@core/data/firestore/mod.ts";

/** How many audits the batch helpers fan out at once. The caller's in-flight
 *  gate is the real throttle; this just keeps one batch's Firestore work from
 *  going out serially. */
const BATCH_CONCURRENCY = 5;

/** One invalid-genie audit in the window, with the metadata the operator needs
 *  to recognise it in the result table. */
export interface GenieRetryCandidate {
  findingId: string;
  completedAt?: number;
  recordId?: string;
  recordingId?: string;
  voName?: string;
  department?: string;
}

/** Where one audit stands after being requeued.
 *    running — pipeline hasn't finalized it yet
 *    valid   — finished with a real transcript: the recording was found
 *    invalid — finished still carrying the sentinel: genuinely no recording
 *    missing — finding doc is gone (deleted/purged mid-run) */
export type GenieRetryState = "running" | "valid" | "invalid" | "missing";

export interface GenieRetryOutcome {
  findingId: string;
  state: GenieRetryState;
  /** Present once finished — the re-run's score, so the operator can see that a
   *  recovered audit actually produced a grade. */
  score?: number;
  /** Present for `valid` — proof there is now real text, not the sentinel. */
  transcriptChars?: number;
}

/** The sentinel step-init / step-transcribe write when no audio can be had.
 *  Both spellings exist in production data. */
function isInvalidTranscript(raw: unknown): boolean {
  if (typeof raw !== "string" || raw.trim() === "") return true;
  return raw.includes("Invalid Genie") || raw.includes("Genie Invalid");
}

/** Run `fn` over `items` with a fixed-size worker pool, preserving input order. */
async function mapPooled<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Every audit in [since, until] that finalized as invalid-genie.
 *
 *  Reads audit-done-idx by completedAt — the same indexed query the audit
 *  history's "Invalid Genie" filter uses — so this stays one bounded query
 *  instead of hydrating every finding in the window. */
export async function listInvalidGenieFindings(
  orgId: OrgId,
  since: number,
  until: number,
): Promise<GenieRetryCandidate[]> {
  const { listStoredByCompletedAt } = await import("@core/data/firestore/mod.ts");
  const rows = await listStoredByCompletedAt<{
    findingId?: string;
    completedAt?: number;
    reason?: string;
    recordId?: string;
    recordingId?: string;
    voName?: string;
    department?: string;
  }>("audit-done-idx", orgId, since, until, { limit: 500_000 });

  // One audit can own several index rows (re-review, flip, appeal). Keep the
  // newest row per finding so `reason` reflects its FINAL state — an audit that
  // was invalid-genie and has since been re-audited must not be picked up again.
  const byFid = new Map<string, { completedAt: number; row: typeof rows[number] }>();
  for (const row of rows) {
    const findingId = row.findingId;
    if (!findingId) continue;
    const completedAt = row.completedAt ?? 0;
    const prev = byFid.get(findingId);
    if (prev && prev.completedAt >= completedAt) continue;
    byFid.set(findingId, { completedAt, row });
  }

  const out: GenieRetryCandidate[] = [];
  for (const [findingId, { row }] of byFid) {
    if (row.reason !== "invalid_genie") continue;
    out.push({
      findingId,
      completedAt: row.completedAt,
      recordId: row.recordId,
      recordingId: row.recordingId,
      voName: row.voName,
      department: row.department,
    });
  }
  // Oldest first — if the operator stops a long run early, the audits that have
  // been wrong the longest are the ones already fixed.
  out.sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0));
  console.log(`[GENIE-RETRY] 📋 list orgId=${orgId} since=${since} until=${until} → ${out.length} invalid-genie of ${byFid.size} audits (${rows.length} index rows)`);
  return out;
}

/** Reset a batch of findings and re-publish step-init for each. */
export async function requeueGenieRetryBatch(
  orgId: OrgId,
  fids: string[],
): Promise<{ requeued: string[]; failed: string[] }> {
  if (fids.length === 0) return { requeued: [], failed: [] };
  const { resetFindingDerivedState } = await import("@review/domain/business/review-queue/mod.ts");

  const results = await mapPooled(fids, BATCH_CONCURRENCY, async (fid) => {
    try {
      await resetFindingDerivedState(orgId, fid);
      const existed = await clearFindingRunState(orgId, fid);
      if (!existed) {
        console.warn(`[GENIE-RETRY] ⚠️ ${fid}: finding doc missing — not requeued`);
        return { fid, ok: false };
      }
      await publishStep("init", { findingId: fid, orgId });
      return { fid, ok: true };
    } catch (err) {
      console.warn(`[GENIE-RETRY] ❌ ${fid}: requeue failed:`, err);
      return { fid, ok: false };
    }
  });

  const requeued = results.filter((r) => r.ok).map((r) => r.fid);
  const failed = results.filter((r) => !r.ok).map((r) => r.fid);
  console.log(`[GENIE-RETRY] 🚀 requeue batch=${fids.length} ok=${requeued.length} failed=${failed.length}`);
  return { requeued, failed };
}

/** Read each in-flight finding back and classify it.
 *
 *  "Finished" is findingStatus === "finished" — the state step-finalize leaves
 *  behind. Anything else is still moving through the pipeline. Note that
 *  clearFindingRunState resets the status to "pending" at requeue time, so a
 *  finding read back as "finished" always reflects the NEW run, never the old
 *  one. */
export async function checkGenieRetryOutcomes(
  orgId: OrgId,
  fids: string[],
): Promise<GenieRetryOutcome[]> {
  if (fids.length === 0) return [];
  return await mapPooled(fids, BATCH_CONCURRENCY, async (findingId): Promise<GenieRetryOutcome> => {
    let finding: Record<string, unknown> | null = null;
    try {
      finding = await getFinding(orgId, findingId);
    } catch (err) {
      // A transient read failure must not be mistaken for a verdict — leave it
      // running and let the next poll decide.
      console.warn(`[GENIE-RETRY] ⚠️ ${findingId}: status read failed:`, err);
      return { findingId, state: "running" };
    }
    if (!finding) return { findingId, state: "missing" };
    if (finding.findingStatus !== "finished") return { findingId, state: "running" };

    const raw = finding.rawTranscript;
    const answered = Array.isArray(finding.answeredQuestions) ? finding.answeredQuestions : [];
    const yeses = answered.filter((q: { answer?: string }) =>
      String(q?.answer ?? "").trim().toLowerCase().startsWith("y")
    ).length;
    const score = answered.length > 0 ? Math.round((yeses / answered.length) * 100) : undefined;

    if (isInvalidTranscript(raw)) return { findingId, state: "invalid", score };
    return { findingId, state: "valid", score, transcriptChars: (raw as string).length };
  });
}

// ── Persisted job layer ─────────────────────────────────────────────────────

/** Audits in flight at once. Each is a full pipeline run (download →
 *  transcribe → grade), so this bounds the load we put on Genie/AssemblyAI. */
export const MAX_IN_FLIGHT = 5;

/** How long one audit may sit in flight before we stop waiting and free its
 *  slot. Normal runs finish in 1-2 min; the pipeline's own genie-retry ladder
 *  can legitimately stretch one to ~30 min, so this is deliberately generous.
 *  A stalled audit is reported, never silently dropped. */
export const STALL_TIMEOUT_MS = 35 * 60 * 1000;

/** Result rows kept for the terminal table. A huge window must not bloat the
 *  stored job doc; the counters stay accurate past the cap. */
export const MAX_TRACKED_RESULTS = 500;

/** Orphaned jobs (operator closed the modal, isolate died) self-clean. */
const JOB_TTL_MS = 2 * 60 * 60 * 1000;

const JOB_STORE = "genie-retry-job";

/** One finished audit, with the display metadata baked in so the frontend can
 *  render the result table straight from the snapshot. */
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

/** The persisted job. Maps are stored as plain objects so it JSON-serialises. */
interface StoredGenieRetryJob {
  jobId: string;
  since: number;
  until: number;
  /** Not yet requeued. */
  pending: string[];
  /** Requeued and still running: findingId → requeued-at ms. */
  inFlight: Record<string, number>;
  /** Candidate metadata, for the result rows. */
  meta: Record<string, GenieRetryCandidate>;
  total: number;
  queued: number;
  valid: number;
  invalid: number;
  missing: number;
  stalled: number;
  failed: number;
  results: GenieRetryResultRow[];
  startedAt: number;
  updatedAt: number;
}

/** Everything the progress fragment needs — no server memory required to
 *  render it, so any isolate can answer any tick. */
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

function inFlightCount(job: StoredGenieRetryJob): number {
  return Object.keys(job.inFlight).length;
}

function snapshot(job: StoredGenieRetryJob): GenieRetrySnapshot {
  return {
    jobId: job.jobId,
    since: job.since,
    until: job.until,
    total: job.total,
    queued: job.queued,
    valid: job.valid,
    invalid: job.invalid,
    missing: job.missing,
    stalled: job.stalled,
    failed: job.failed,
    pendingCount: job.pending.length,
    inFlightCount: inFlightCount(job),
    results: job.results,
    startedAt: job.startedAt,
    done: job.pending.length === 0 && inFlightCount(job) === 0,
  };
}

/** Record a terminal verdict: drop from in-flight, bump its counter, and keep a
 *  capped result row with the display metadata attached. */
function retire(
  job: StoredGenieRetryJob,
  findingId: string,
  state: GenieRetryResultRow["state"],
  score?: number,
  transcriptChars?: number,
): void {
  delete job.inFlight[findingId];
  if (state === "valid") job.valid++;
  else if (state === "invalid") job.invalid++;
  else if (state === "missing") job.missing++;
  else job.stalled++;
  if (job.results.length < MAX_TRACKED_RESULTS) {
    const m = job.meta[findingId] ?? {};
    job.results.push({
      findingId,
      state,
      score,
      transcriptChars,
      recordId: m.recordId,
      recordingId: m.recordingId,
      voName: m.voName,
      completedAt: m.completedAt,
    });
  }
}

async function saveJob(orgId: OrgId, job: StoredGenieRetryJob): Promise<void> {
  job.updatedAt = Date.now();
  await setStored(JOB_STORE, orgId, [job.jobId], job, { expireInMs: JOB_TTL_MS });
}

/** Create a job for every invalid-genie audit in the window and persist it.
 *  Nothing is requeued yet — the first advance() does that, so the bar renders
 *  immediately. */
export async function startGenieRetryJob(
  orgId: OrgId,
  since: number,
  until: number,
): Promise<GenieRetrySnapshot> {
  const candidates = await listInvalidGenieFindings(orgId, since, until);
  const meta: Record<string, GenieRetryCandidate> = {};
  for (const c of candidates) meta[c.findingId] = c;
  const now = Date.now();
  const job: StoredGenieRetryJob = {
    jobId: crypto.randomUUID().slice(0, 8),
    since,
    until,
    pending: candidates.map((c) => c.findingId),
    inFlight: {},
    meta,
    total: candidates.length,
    queued: 0,
    valid: 0,
    invalid: 0,
    missing: 0,
    stalled: 0,
    failed: 0,
    results: [],
    startedAt: now,
    updatedAt: now,
  };
  await saveJob(orgId, job);
  console.log(`🚀 [GENIE-RETRY] job start orgId=${orgId} jobId=${job.jobId} total=${job.total} since=${since} until=${until}`);
  return snapshot(job);
}

/** Advance a persisted job by one tick: poll the in-flight audits, retire the
 *  ones that reached a verdict (or that stalled past the timeout), then top the
 *  in-flight set back up to MAX_IN_FLIGHT from the pending queue.
 *
 *  Returns null if the job is gone (TTL expired) so the caller can tell the
 *  operator to re-run — now a genuinely rare case, not the every-tick failure
 *  the in-memory version hit. */
export async function advanceGenieRetryJob(
  orgId: OrgId,
  jobId: string,
): Promise<GenieRetrySnapshot | null> {
  const job = await getStored<StoredGenieRetryJob>(JOB_STORE, orgId, jobId);
  if (!job) return null;

  // 1. Poll in-flight → retire finished, then reclaim stalled slots.
  const watching = Object.keys(job.inFlight);
  if (watching.length > 0) {
    const outcomes = await checkGenieRetryOutcomes(orgId, watching);
    for (const o of outcomes) {
      if (o.state === "running") continue;
      retire(job, o.findingId, o.state, o.score, o.transcriptChars);
    }
    const now = Date.now();
    for (const [fid, startedAt] of Object.entries(job.inFlight)) {
      if (now - startedAt < STALL_TIMEOUT_MS) continue;
      console.warn(`[GENIE-RETRY] ⚠️ jobId=${jobId} fid=${fid} stalled after ${Math.round((now - startedAt) / 60000)}m — freeing slot`);
      retire(job, fid, "stalled");
    }
  }

  // 2. Top the in-flight set back up.
  const slots = MAX_IN_FLIGHT - inFlightCount(job);
  if (slots > 0 && job.pending.length > 0) {
    const batch = job.pending.splice(0, slots);
    const { requeued, failed } = await requeueGenieRetryBatch(orgId, batch);
    const now = Date.now();
    for (const fid of requeued) {
      job.inFlight[fid] = now;
      job.queued++;
    }
    // A finding that couldn't be requeued never enters in-flight, so it can't
    // be polled — count it terminally here or the job never reaches done.
    job.failed += failed.length;
  }

  await saveJob(orgId, job);
  const snap = snapshot(job);
  console.log(`📊 [GENIE-RETRY] tick jobId=${jobId} queued=${job.queued} inFlight=${snap.inFlightCount} pending=${snap.pendingCount} valid=${job.valid} invalid=${job.invalid} stalled=${job.stalled} failed=${job.failed} done=${snap.done}`);
  if (snap.done) {
    console.log(`✅ [GENIE-RETRY] job done jobId=${jobId} total=${job.total} valid=${job.valid} invalid=${job.invalid} elapsed=${Math.round((Date.now() - job.startedAt) / 1000)}s`);
    // Leave the doc for the TTL to reap: the terminal fragment stops ticking,
    // so nothing re-reads it, and a manual refresh still shows the result.
    await deleteStored(JOB_STORE, orgId, jobId).catch(() => {});
  }
  return snap;
}
