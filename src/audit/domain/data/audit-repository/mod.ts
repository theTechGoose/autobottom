/** Audit data repository — findings, jobs, batches, transcripts, cache, dedup.
 *  Firestore-backed via setStored* helpers; in-mem fallback when env unset. */

import {
  getStored, setStored, setStoredIfAbsent,
  getStoredChunked, setStoredChunked, deleteStoredChunked,
} from "@core/data/firestore/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

const DEDUP_TTL_MS = 5 * 60 * 1000;
const CACHE_TTL_MS = 10 * 60 * 1000;

async function hashString(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

// ── Finding CRUD (chunked) ──────────────────────────────────────────────────
// Per-isolate in-memory cache. audit-finding docs are heavily chunked
// (record + transcript + answeredQuestions), so each getFinding can cost
// 5-10 Firestore reads. Pipeline steps (init, transcribe, prepare, askAll,
// finalize, cleanup) all read the same finding, often within seconds, and
// were previously hitting Firestore for every single one.
//
// TTL is short (30s) so cross-isolate writes stay visible quickly. Within
// the same isolate, saveFinding refreshes the cached value so subsequent
// reads observe their own writes immediately. The cache is bounded by a
// hard size cap to prevent unbounded growth on a long-lived isolate.

const FINDING_CACHE_TTL_MS = 30_000;
const FINDING_CACHE_MAX = 1000;
const _findingCache = new Map<string, { value: Record<string, any> | null; expiresAt: number }>();

function cacheFindingKey(orgId: OrgId, id: string): string {
  return `${orgId}:${id}`;
}

function trimFindingCache(): void {
  if (_findingCache.size <= FINDING_CACHE_MAX) return;
  const now = Date.now();
  // Drop expired entries first.
  for (const [k, v] of _findingCache) {
    if (v.expiresAt <= now) _findingCache.delete(k);
  }
  // If still over cap, drop oldest entries (insertion order = approx FIFO).
  while (_findingCache.size > FINDING_CACHE_MAX) {
    const oldest = _findingCache.keys().next().value;
    if (!oldest) break;
    _findingCache.delete(oldest);
  }
}

export async function getFinding(orgId: OrgId, id: string): Promise<Record<string, any> | null> {
  const key = cacheFindingKey(orgId, id);
  const now = Date.now();
  const cached = _findingCache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;

  const value = await getStoredChunked<Record<string, any>>("audit-finding", orgId, id);
  _findingCache.set(key, { value, expiresAt: now + FINDING_CACHE_TTL_MS });
  trimFindingCache();
  return value;
}

export async function saveFinding(orgId: OrgId, finding: Record<string, any>): Promise<void> {
  await setStoredChunked("audit-finding", orgId, [finding.id], finding);
  // Refresh cache with what we just wrote so subsequent getFinding calls
  // in this isolate see their own write without a Firestore round-trip.
  _findingCache.set(cacheFindingKey(orgId, finding.id), {
    value: finding,
    expiresAt: Date.now() + FINDING_CACHE_TTL_MS,
  });
  trimFindingCache();
}

/** Invalidate the in-memory finding cache for a given findingId (or all,
 *  if no id passed). Used by tests and by deletion paths that need to
 *  guarantee the next read goes to Firestore. */
export function invalidateFindingCache(orgId?: OrgId, id?: string): void {
  if (orgId && id) { _findingCache.delete(cacheFindingKey(orgId, id)); return; }
  _findingCache.clear();
}

/** Everything the pipeline writes onto the finding doc during a run. Recording
 *  fields (s3RecordingKey/s3RecordingKeys/recordingPath) are deliberately NOT
 *  in this list — step-init overwrites them anyway, and keeping them means the
 *  report page's audio player still works while the re-run is in flight. */
const RUN_STATE_FIELDS = [
  "rawTranscript", "diarizedTranscript", "utteranceTimes",
  "populatedQuestions", "unpopulatedQuestions", "answeredQuestions",
  "feedback", "completedAt", "reviewScore",
  "assemblyAiUploadUrl", "assemblyAiTranscriptId", "assemblyAiSubmittedAt",
  "genieAttempts", "genieRetryAt",
];

/** Reset the finding doc itself to its pre-pipeline shape so a re-run rebuilds
 *  it from scratch. Companion to resetFindingDerivedState, which clears the
 *  *outside* stores (review queue, audit-done-idx, chargeback/wire) but
 *  explicitly leaves audit-finding alone.
 *
 *  Without this, re-running an audit that finished as "Invalid Genie" is a
 *  no-op: step-init downloads the recording fine, then step-transcribe's
 *  `if (finding.rawTranscript) → skip` sees the stale sentinel and never calls
 *  AssemblyAI, step-transcribe-cb and step-prepare both bail on the same
 *  string, and finalize re-writes the identical 0% result. `genieAttempts`
 *  matters too — left at MAX_GENIE_RETRIES, a re-run gets zero retries.
 *
 *  Idempotent. Returns false if the finding doesn't exist. */
export async function clearFindingRunState(orgId: OrgId, findingId: string): Promise<boolean> {
  const finding = await getFinding(orgId, findingId);
  if (!finding) return false;
  const cleared: string[] = [];
  for (const field of RUN_STATE_FIELDS) {
    if (finding[field] === undefined) continue;
    delete finding[field];
    cleared.push(field);
  }
  finding.findingStatus = "pending";
  await saveFinding(orgId, finding);
  // saveTranscript merges rather than replaces (it preserves an existing
  // `diarized`), and step-diarize-async skips when the store already holds a
  // diarized transcript — so drop the row or the re-run inherits stale text.
  await deleteStoredChunked("audit-transcript", orgId, findingId).catch(() => {});
  console.log(`🧽 [RESET-RUN-STATE] ${findingId}: cleared ${cleared.length ? cleared.join(",") : "(nothing)"} → findingStatus=pending`);
  return true;
}

// ── Audit Deduplication ─────────────────────────────────────────────────────

export async function claimAuditDedup(orgId: OrgId, rid: string): Promise<boolean> {
  return await setStoredIfAbsent(
    "audit-dedup", orgId, [rid],
    { rid, claimedAt: Date.now() },
    { expireInMs: DEDUP_TTL_MS },
  );
}

// ── Job CRUD ────────────────────────────────────────────────────────────────

export async function getJob(orgId: OrgId, id: string): Promise<Record<string, any> | null> {
  return await getStored<Record<string, any>>("audit-job", orgId, id);
}

export async function saveJob(orgId: OrgId, job: Record<string, any>): Promise<void> {
  await setStored("audit-job", orgId, [job.id], job);
}

// ── Question Cache (10 min TTL) ─────────────────────────────────────────────

export async function getCachedAnswer(orgId: OrgId, auditId: string, questionText: string): Promise<{ answer: string; thinking: string; defense: string } | null> {
  const hash = await hashString(questionText);
  return await getStored<{ answer: string; thinking: string; defense: string }>("question-cache", orgId, auditId, hash);
}

export async function cacheAnswer(orgId: OrgId, auditId: string, questionText: string, answer: { answer: string; thinking: string; defense: string }): Promise<void> {
  const hash = await hashString(questionText);
  await setStored("question-cache", orgId, [auditId, hash], answer, { expireInMs: CACHE_TTL_MS });
}

export async function getCachedQuestions(orgId: OrgId, destinationId: string): Promise<any[] | null> {
  return await getStoredChunked<any[]>("destination-questions", orgId, destinationId);
}

export async function cacheQuestions(orgId: OrgId, destinationId: string, questions: any[]): Promise<void> {
  await setStoredChunked("destination-questions", orgId, [destinationId], questions, { expireInMs: CACHE_TTL_MS });
  // Durable last-known-good copy (NO TTL) — used as a fallback by step-prepare
  // when a live QuickBase fetch fails/times out, so a transient QB outage
  // doesn't fatal the audit (and doesn't thundering-herd every audit for this
  // destination into the same 90s timeout). The TTL'd cache above still drives
  // the fast path + freshness; this is purely a safety net.
  await setStoredChunked("destination-questions-lkg", orgId, [destinationId], questions);
}

/** Last-known-good questions for a destination, ignoring the fresh-cache TTL.
 *  Written on every successful cacheQuestions. Returns null if QB questions for
 *  this destination have never been fetched successfully. */
export async function getLastGoodQuestions(orgId: OrgId, destinationId: string): Promise<any[] | null> {
  return await getStoredChunked<any[]>("destination-questions-lkg", orgId, destinationId);
}

// ── Populated Questions (chunked) ───────────────────────────────────────────

export async function savePopulatedQuestions(orgId: OrgId, findingId: string, questions: any[]): Promise<void> {
  await setStoredChunked("populated-questions", orgId, [findingId], questions);
}

export async function getPopulatedQuestions(orgId: OrgId, findingId: string): Promise<any[] | null> {
  return await getStoredChunked<any[]>("populated-questions", orgId, findingId);
}

// ── Batch Answers (chunked) ─────────────────────────────────────────────────

export async function saveBatchAnswers(orgId: OrgId, findingId: string, batchIndex: number, answers: any[]): Promise<void> {
  await setStoredChunked("batch-answers", orgId, [findingId, String(batchIndex)], answers);
}

export async function getAllBatchAnswers(orgId: OrgId, findingId: string, totalBatches: number): Promise<any[]> {
  const all: any[] = [];
  for (let i = 0; i < totalBatches; i++) {
    const batch = await getStoredChunked<any[]>("batch-answers", orgId, findingId, String(i));
    if (batch && Array.isArray(batch)) all.push(...batch);
  }
  return all;
}

export async function getAllAnswersForFinding(orgId: OrgId, findingId: string): Promise<any[]> {
  const all: any[] = [];
  for (let i = 0; i < 100; i++) {
    const batch = await getStoredChunked<any[]>("batch-answers", orgId, findingId, String(i));
    if (batch === null) break;
    if (Array.isArray(batch)) all.push(...batch);
  }
  return all;
}

// ── Transcripts (chunked) ───────────────────────────────────────────────────

export interface TranscriptData {
  raw: string;
  diarized: string;
  utteranceTimes?: number[];
}

export async function saveTranscript(orgId: OrgId, findingId: string, raw: string, diarized?: string, utteranceTimes?: number[]): Promise<void> {
  const existing = await getStoredChunked<TranscriptData>("audit-transcript", orgId, findingId);
  await setStoredChunked("audit-transcript", orgId, [findingId], {
    raw,
    diarized: diarized ?? existing?.diarized ?? raw,
    utteranceTimes: utteranceTimes ?? existing?.utteranceTimes,
  });
}

export async function getTranscript(orgId: OrgId, findingId: string): Promise<TranscriptData | null> {
  return await getStoredChunked<TranscriptData>("audit-transcript", orgId, findingId);
}
