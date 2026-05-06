/** Audit data repository — findings, jobs, batches, transcripts, cache, dedup.
 *  Firestore-backed via setStored* helpers; in-mem fallback when env unset. */

import {
  getStored, setStored, setStoredIfAbsent,
  getStoredChunked, setStoredChunked,
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

export async function getFinding(orgId: OrgId, id: string): Promise<Record<string, any> | null> {
  return await getStoredChunked<Record<string, any>>("audit-finding", orgId, id);
}

export async function saveFinding(orgId: OrgId, finding: Record<string, any>): Promise<void> {
  await setStoredChunked("audit-finding", orgId, [finding.id], finding);
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
}

// ── Batch Counter ───────────────────────────────────────────────────────────

export async function setBatchCounter(orgId: OrgId, findingId: string, count: number): Promise<void> {
  await setStored("batch-counter", orgId, [findingId], count);
}

/** Decrement the batch counter and return the new value.
 *  Note: simple read-modify-write — under high concurrency on Firestore,
 *  could race. Acceptable for our load (handful of QStash callbacks per
 *  finding); finalize is idempotent via the review-done sentinel. */
export async function decrementBatchCounter(orgId: OrgId, findingId: string): Promise<number> {
  const current = (await getStored<number>("batch-counter", orgId, findingId)) ?? 0;
  const next = current - 1;
  await setStored("batch-counter", orgId, [findingId], next);
  return next;
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
