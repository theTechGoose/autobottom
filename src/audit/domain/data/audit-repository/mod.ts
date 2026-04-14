/** Audit data repository — findings, jobs, batches, transcripts, cache, dedup.
 *  Ported from lib/kv.ts finding/job/batch/cache/transcript sections. */

import { getKv, orgKey } from "@core/data/deno-kv/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

const DEDUP_TTL_MS = 5 * 60 * 1000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CHUNK_LIMIT = 30_000;

// ── Chunked storage helpers ──────────────────────────────────────────────────

async function chunkedGet<T>(db: Deno.Kv, prefix: Deno.KvKey): Promise<T | null> {
  const meta = await db.get<number>([...prefix, "_n"]);
  if (meta.value == null || meta.value === 0) return null;
  const parts: string[] = [];
  for (let i = 0; i < meta.value; i++) {
    const entry = await db.get<string>([...prefix, i]);
    if (typeof entry.value !== "string") return null;
    parts.push(entry.value);
  }
  if (parts.length === 0) return null;
  try { return JSON.parse(parts.join("")) as T; }
  catch { return null; }
}

async function chunkedSet(db: Deno.Kv, prefix: Deno.KvKey, value: unknown, opts?: { expireIn?: number }): Promise<void> {
  const raw = JSON.stringify(value);
  if (raw.length <= CHUNK_LIMIT) {
    await db.set([...prefix, "_n"], 0, opts);
    await db.set([...prefix, 0], raw, opts);
    await db.set([...prefix, "_n"], 1, opts);
    return;
  }
  const n = Math.ceil(raw.length / CHUNK_LIMIT);
  await db.set([...prefix, "_n"], 0, opts ?? {});
  for (let i = 0; i < n; i++) {
    await db.set([...prefix, i], raw.slice(i * CHUNK_LIMIT, (i + 1) * CHUNK_LIMIT), opts ?? {});
  }
  await db.set([...prefix, "_n"], n, opts ?? {});
}

async function hashString(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

// ── Finding CRUD (chunked) ──────────────────────────────────────────────────

export async function getFinding(orgId: OrgId, id: string): Promise<Record<string, any> | null> {
  const db = await getKv();
  return chunkedGet<Record<string, any>>(db, ["__audit-finding__", orgId, id]);
}

export async function saveFinding(orgId: OrgId, finding: Record<string, any>): Promise<void> {
  const db = await getKv();
  await chunkedSet(db, ["__audit-finding__", orgId, finding.id], finding);
}

// ── Audit Deduplication ─────────────────────────────────────────────────────

export async function claimAuditDedup(orgId: OrgId, rid: string): Promise<boolean> {
  const db = await getKv();
  const key = orgKey(orgId, "audit-dedup", rid);
  const existing = await db.get(key);
  if (existing.value !== null) return false;
  const res = await db.atomic()
    .check(existing)
    .set(key, { rid, claimedAt: Date.now() }, { expireIn: DEDUP_TTL_MS })
    .commit();
  return res.ok;
}

// ── Job CRUD ────────────────────────────────────────────────────────────────

export async function getJob(orgId: OrgId, id: string): Promise<Record<string, any> | null> {
  const db = await getKv();
  return (await db.get(["__audit-job__", orgId, id])).value as Record<string, any> | null;
}

export async function saveJob(orgId: OrgId, job: Record<string, any>): Promise<void> {
  const db = await getKv();
  await db.set(["__audit-job__", orgId, job.id], job);
}

// ── Question Cache (10 min TTL) ─────────────────────────────────────────────

export async function getCachedAnswer(orgId: OrgId, auditId: string, questionText: string): Promise<{ answer: string; thinking: string; defense: string } | null> {
  const db = await getKv();
  const hash = await hashString(questionText);
  return (await db.get(["__question-cache__", orgId, auditId, hash])).value as any;
}

export async function cacheAnswer(orgId: OrgId, auditId: string, questionText: string, answer: { answer: string; thinking: string; defense: string }): Promise<void> {
  const db = await getKv();
  const hash = await hashString(questionText);
  await db.set(["__question-cache__", orgId, auditId, hash], answer, { expireIn: CACHE_TTL_MS });
}

export async function getCachedQuestions(orgId: OrgId, destinationId: string): Promise<any[] | null> {
  const db = await getKv();
  return chunkedGet<any[]>(db, ["__destination-questions__", orgId, destinationId]);
}

export async function cacheQuestions(orgId: OrgId, destinationId: string, questions: any[]): Promise<void> {
  const db = await getKv();
  await chunkedSet(db, ["__destination-questions__", orgId, destinationId], questions, { expireIn: CACHE_TTL_MS });
}

// ── Batch Counter ───────────────────────────────────────────────────────────

export async function setBatchCounter(orgId: OrgId, findingId: string, count: number): Promise<void> {
  const db = await getKv();
  await db.set(["__batch-counter__", orgId, findingId], count);
}

export async function decrementBatchCounter(orgId: OrgId, findingId: string): Promise<number> {
  const db = await getKv();
  const key = ["__batch-counter__", orgId, findingId] as Deno.KvKey;
  while (true) {
    const entry = await db.get<number>(key);
    const current = entry.value ?? 0;
    const next = current - 1;
    const res = await db.atomic().check(entry).set(key, next).commit();
    if (res.ok) return next;
  }
}

// ── Populated Questions (chunked) ───────────────────────────────────────────

export async function savePopulatedQuestions(orgId: OrgId, findingId: string, questions: any[]): Promise<void> {
  const db = await getKv();
  await chunkedSet(db, ["__populated-questions__", orgId, findingId], questions);
}

export async function getPopulatedQuestions(orgId: OrgId, findingId: string): Promise<any[] | null> {
  const db = await getKv();
  return chunkedGet<any[]>(db, ["__populated-questions__", orgId, findingId]);
}

// ── Batch Answers (chunked) ─────────────────────────────────────────────────

export async function saveBatchAnswers(orgId: OrgId, findingId: string, batchIndex: number, answers: any[]): Promise<void> {
  const db = await getKv();
  await chunkedSet(db, ["__batch-answers__", orgId, findingId, String(batchIndex)], answers);
}

export async function getAllBatchAnswers(orgId: OrgId, findingId: string, totalBatches: number): Promise<any[]> {
  const db = await getKv();
  const all: any[] = [];
  for (let i = 0; i < totalBatches; i++) {
    const batch = await chunkedGet<any[]>(db, ["__batch-answers__", orgId, findingId, String(i)]);
    if (batch && Array.isArray(batch)) all.push(...batch);
  }
  return all;
}

export async function getAllAnswersForFinding(orgId: OrgId, findingId: string): Promise<any[]> {
  const db = await getKv();
  const all: any[] = [];
  for (let i = 0; i < 100; i++) {
    const batch = await chunkedGet<any[]>(db, ["__batch-answers__", orgId, findingId, String(i)]);
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
  const db = await getKv();
  const prefix = ["__audit-transcript__", orgId, findingId] as Deno.KvKey;
  const existing = await chunkedGet<TranscriptData>(db, prefix);
  await chunkedSet(db, prefix, {
    raw,
    diarized: diarized ?? existing?.diarized ?? raw,
    utteranceTimes: utteranceTimes ?? existing?.utteranceTimes,
  });
}

export async function getTranscript(orgId: OrgId, findingId: string): Promise<TranscriptData | null> {
  const db = await getKv();
  return chunkedGet<TranscriptData>(db, ["__audit-transcript__", orgId, findingId]);
}
