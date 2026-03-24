/** Deno KV state management for audit findings, jobs, and counters. All keys are org-scoped. */

import { orgKey } from "./org.ts";
import type { OrgId } from "./org.ts";
import { pollTranscriptOnce, processTranscriptResult } from "../providers/assemblyai.ts";
import { TypedStore, initStores } from "./storage/typed-kv.ts";
import {
  AuditFinding, AuditJob, QuestionCache, DestinationQuestions,
  BatchCounter, PopulatedQuestions, BatchAnswers, AuditTranscript,
} from "./storage/dtos/audit.ts";
import {
  ActiveTracking, WatchdogActive, CompletedAuditStat as CompletedAuditStatDto,
  ErrorTracking, RetryTracking, ChargebackEntry as ChargebackEntryDto, WireDeductionEntry as WireDeductionEntryDto,
} from "./storage/dtos/stats.ts";
import {
  PipelineConfig as PipelineConfigDto, WebhookConfigDto, BadWordConfig as BadWordConfigDto,
  ReviewerConfig as ReviewerConfigDto, OfficeBypassConfig as OfficeBypassConfigDto,
  ManagerScopeConfig as ManagerScopeConfigDto,
  AuditDimensionsConfig as AuditDimensionsConfigDto,
} from "./storage/dtos/config.ts";
import {
  EmailReportConfig as EmailReportConfigDto, EmailTemplate as EmailTemplateDto,
} from "./storage/dtos/email.ts";
import {
  GamificationSettingsDto, SoundPackMeta as SoundPackMetaDto,
  CustomStoreItem, EarnedBadgeDto, BadgeStatsDto, GameStateDto,
} from "./storage/dtos/gamification.ts";
import {
  AppEvent as AppEventDto, BroadcastEvent as BroadcastEventDto,
  PrefabSubscriptions, MessageDto, UnreadCount,
} from "./storage/dtos/events.ts";

// ── Store instances (lazy) ──────────────────────────────────────────────────

let _db: Deno.Kv | undefined;
let _stores: ReturnType<typeof initStores> | undefined;

async function db(): Promise<Deno.Kv> {
  if (!_db) _db = await Deno.openKv(Deno.env.get("KV_URL") ?? undefined);
  return _db;
}

async function stores() {
  if (!_stores) _stores = initStores(await db());
  return _stores;
}

async function store<T>(dto: new () => T): Promise<TypedStore<T>> {
  return (await stores())(dto);
}

// ── Finding CRUD (chunked) ──────────────────────────────────────────────────

export async function getFinding(orgId: OrgId, id: string) {
  const s = await store(AuditFinding);
  return s.getChunked([orgId, id]) as Promise<Record<string, any> | null>;
}

export async function saveFinding(orgId: OrgId, finding: Record<string, any>) {
  const s = await store(AuditFinding);
  await s.setChunked([orgId, finding.id], finding as any);
}

// ── Job CRUD ────────────────────────────────────────────────────────────────

export async function getJob(orgId: OrgId, id: string) {
  const s = await store(AuditJob);
  return s.get([orgId, id]) as Promise<Record<string, any> | null>;
}

export async function saveJob(orgId: OrgId, job: Record<string, any>) {
  const s = await store(AuditJob);
  await s.set([orgId, job.id], job as any);
}

// ── Question Cache (10 min TTL) ─────────────────────────────────────────────

async function hashString(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

export async function getCachedAnswer(orgId: OrgId, auditId: string, questionText: string) {
  const s = await store(QuestionCache);
  const hash = await hashString(questionText);
  return s.get([orgId, auditId, hash]) as Promise<{ answer: string; thinking: string; defense: string } | null>;
}

export async function cacheAnswer(
  orgId: OrgId,
  auditId: string,
  questionText: string,
  answer: { answer: string; thinking: string; defense: string },
) {
  const s = await store(QuestionCache);
  const hash = await hashString(questionText);
  await s.set([orgId, auditId, hash], answer as any, { expireIn: 600_000 });
}

// ── Question Destination Cache (10 min TTL, chunked) ────────────────────────

export async function getCachedQuestions(orgId: OrgId, destinationId: string) {
  const s = await store(DestinationQuestions);
  return s.getChunked([orgId, destinationId]) as Promise<any[] | null>;
}

export async function cacheQuestions(orgId: OrgId, destinationId: string, questions: any[]) {
  const s = await store(DestinationQuestions);
  await s.setChunked([orgId, destinationId], questions as any, { expireIn: 600_000 });
}

// ── Batch Counter (atomic CAS) ──────────────────────────────────────────────

export async function setBatchCounter(orgId: OrgId, findingId: string, count: number) {
  const s = await store(BatchCounter);
  await s.set([orgId, findingId], count as any);
}

export async function decrementBatchCounter(orgId: OrgId, findingId: string): Promise<number> {
  const s = await store(BatchCounter);
  const key = s.toKey([orgId, findingId]);
  while (true) {
    const entry = await s.rawDb.get<number>(key);
    const current = entry.value ?? 0;
    const next = current - 1;
    const res = await s.rawDb.atomic()
      .check(entry)
      .set(key, next)
      .commit();
    if (res.ok) return next;
  }
}

// ── Populated Questions (chunked) ───────────────────────────────────────────

export async function savePopulatedQuestions(orgId: OrgId, findingId: string, questions: any[]) {
  const s = await store(PopulatedQuestions);
  await s.setChunked([orgId, findingId], questions as any);
}

export async function getPopulatedQuestions(orgId: OrgId, findingId: string): Promise<any[] | null> {
  const s = await store(PopulatedQuestions);
  return s.getChunked([orgId, findingId]) as Promise<any[] | null>;
}

// ── Batch Answers (chunked) ─────────────────────────────────────────────────

export async function saveBatchAnswers(orgId: OrgId, findingId: string, batchIndex: number, answers: any[]) {
  const s = await store(BatchAnswers);
  await s.setChunked([orgId, findingId, String(batchIndex)], answers as any);
}

export async function getAllBatchAnswers(orgId: OrgId, findingId: string, totalBatches: number) {
  const s = await store(BatchAnswers);
  const all: any[] = [];
  for (let i = 0; i < totalBatches; i++) {
    const batch = await s.getChunked([orgId, findingId, String(i)]) as any[] | null;
    if (batch && Array.isArray(batch)) all.push(...batch);
  }
  return all;
}

export async function getAllAnswersForFinding(orgId: OrgId, findingId: string) {
  const s = await store(BatchAnswers);
  const all: any[] = [];
  for (let i = 0; i < 100; i++) {
    const batch = await s.getChunked([orgId, findingId, String(i)]) as any[] | null;
    if (batch === null) break;
    if (Array.isArray(batch)) all.push(...batch);
  }
  return all;
}

// ── Pipeline Stats ──────────────────────────────────────────────────────────

export interface CompletedAuditStat {
  findingId: string;
  ts: number;
  recordId?: string;
  isPackage?: boolean;
  startedAt?: number;
  durationMs?: number;
  score?: number;
  owner?: string;
  department?: string;
  voName?: string;
  reason?: string; // "perfect_score" | "invalid_genie" | undefined
  shift?: string;
}

const DAY_MS = 86_400_000;

export async function getRecentCompleted(orgId: OrgId, limit = 25): Promise<CompletedAuditStat[]> {
  const s = await store(CompletedAuditStatDto);
  const results = await s.listRaw([orgId], { reverse: true, limit });
  return results.map((r) => r.value) as unknown as CompletedAuditStat[];
}

export async function getAllCompleted(orgId: OrgId, since?: number): Promise<CompletedAuditStat[]> {
  const s = await store(CompletedAuditStatDto);
  const results = await s.listRaw([orgId], { reverse: true });
  const items: CompletedAuditStat[] = [];
  for (const r of results) {
    const v = r.value as unknown as CompletedAuditStat;
    if (since && v.ts < since) break;
    items.push(v);
  }
  console.log(`[KV] getAllCompleted: ${items.length} entries for org ${orgId}${since ? ` since ${new Date(since).toISOString()}` : " (all-time)"}`);
  return items;
}

// ── Chargeback / Omission Report ─────────────────────────────────────────────

export interface ChargebackEntry {
  findingId: string;
  ts: number;
  voName: string;
  destination: string;
  revenue: string;
  recordId: string;
  score: number;
  failedQHeaders: string[];
}

export async function saveChargebackEntry(orgId: OrgId, entry: ChargebackEntry): Promise<void> {
  const s = await store(ChargebackEntryDto);
  // Key by findingId so re-audits overwrite the previous entry for the same finding.
  await s.set([orgId, entry.findingId], entry as any);
}

export async function deleteChargebackEntry(orgId: OrgId, findingId: string): Promise<void> {
  const s = await store(ChargebackEntryDto);
  await s.delete([orgId, findingId]);
}

export async function getChargebackEntries(orgId: OrgId, since: number, until: number): Promise<ChargebackEntry[]> {
  const s = await store(ChargebackEntryDto);
  const results = await s.listRaw([orgId], { reverse: true });
  const items: ChargebackEntry[] = [];
  for (const r of results) {
    const v = r.value as unknown as ChargebackEntry;
    if (v.ts >= since && v.ts <= until) items.push(v);
  }
  return items;
}

export interface WireDeductionEntry {
  findingId: string;
  ts: number;
  score: number;
  questionsAudited: number;
  totalSuccess: number;
  recordId: string;
  office: string;
  excellenceAuditor: string;
  guestName: string;
}

export async function saveWireDeductionEntry(orgId: OrgId, entry: WireDeductionEntry): Promise<void> {
  const s = await store(WireDeductionEntryDto);
  await s.set([orgId, entry.findingId], entry as any);
}

export async function getWireDeductionEntries(orgId: OrgId, since: number, until: number): Promise<WireDeductionEntry[]> {
  const s = await store(WireDeductionEntryDto);
  const results = await s.listRaw([orgId], { reverse: true });
  const items: WireDeductionEntry[] = [];
  for (const r of results) {
    const v = r.value as unknown as WireDeductionEntry;
    if (v.ts >= since && v.ts <= until) items.push(v);
  }
  return items;
}

export async function purgeOldEntries(orgId: OrgId, since: number, before: number): Promise<{ completed: number; chargebacks: number; wire: number }> {
  const [cbStore, wireStore, completedStore] = await Promise.all([
    store(ChargebackEntryDto), store(WireDeductionEntryDto), store(CompletedAuditStatDto),
  ]);
  const [cbResults, wireResults, completedResults] = await Promise.all([
    cbStore.listRaw([orgId]),
    wireStore.listRaw([orgId]),
    completedStore.listRaw([orgId]),
  ]);
  let cbDeleted = 0, wireDeleted = 0, completedDeleted = 0;
  for (const r of cbResults) {
    const v = r.value as unknown as ChargebackEntry;
    if (v.ts >= since && v.ts <= before) { await cbStore.rawDb.delete(r.key); cbDeleted++; }
  }
  for (const r of wireResults) {
    const v = r.value as unknown as WireDeductionEntry;
    if (v.ts >= since && v.ts <= before) { await wireStore.rawDb.delete(r.key); wireDeleted++; }
  }
  for (const r of completedResults) {
    const v = r.value as unknown as CompletedAuditStat;
    if (v.ts >= since && v.ts <= before) { await completedStore.rawDb.delete(r.key); completedDeleted++; }
  }
  return { completed: completedDeleted, chargebacks: cbDeleted, wire: wireDeleted };
}

export async function trackActive(orgId: OrgId, findingId: string, step: string, meta?: { recordId?: string; isPackage?: boolean; startedAt?: number; genieRetryAt?: number; genieAttempts?: number }) {
  const s = await store(ActiveTracking);
  const existing = await s.get([orgId, findingId]);
  const prev = (existing ?? {}) as Record<string, unknown>;
  await s.set([orgId, findingId], { ...prev, findingId, step, ts: Date.now(), ...(meta ?? {}) } as any);
  // Global watchdog index
  const w = await store(WatchdogActive);
  await w.set([findingId], { orgId, findingId, step, ts: Date.now() } as any, { expireIn: 2 * 60 * 60 * 1000 });
}

export async function trackCompleted(orgId: OrgId, findingId: string, meta?: { recordId?: string; isPackage?: boolean; startedAt?: number; durationMs?: number; score?: number; owner?: string; department?: string; voName?: string; reason?: string; shift?: string }) {
  const s = await store(ActiveTracking);
  await s.delete([orgId, findingId]);
  const w = await store(WatchdogActive);
  await w.delete([findingId]);
  const c = await store(CompletedAuditStatDto);
  await c.set([orgId, `${Date.now()}-${findingId}`], { findingId, ts: Date.now(), ...(meta ?? {}) } as any, { expireIn: DAY_MS });
  console.log(`[TRACK-COMPLETED] ✅ ${findingId}: score=${meta?.score ?? "?"}% owner=${meta?.owner ?? "unknown"} dept=${meta?.department ?? "unknown"} type=${meta?.isPackage ? "package" : "date-leg"}`);
  // Update persistent dimensions index (fire-and-forget)
  if (meta?.department || meta?.shift) {
    updateAuditDimensions(orgId, meta.department, meta.shift).catch(() => {});
  }
}

export async function updateCompletedStatScore(orgId: OrgId, findingId: string, score: number): Promise<void> {
  const c = await store(CompletedAuditStatDto);
  const results = await c.listRaw([orgId]);
  for (const r of results) {
    const v = r.value as unknown as CompletedAuditStat;
    if (v.findingId === findingId) {
      await c.rawDb.set(r.key, { ...v, score }, { expireIn: DAY_MS });
      console.log(`[TRACK-COMPLETED] ✅ Updated score for ${findingId} → ${score}%`);
      return;
    }
  }
}

export async function backfillReviewScores(orgId: OrgId, since: number, until: number): Promise<{ scanned: number; updated: number }> {
  const c = await store(CompletedAuditStatDto);
  const results = await c.listRaw([orgId]);
  let scanned = 0, updated = 0;
  for (const r of results) {
    const v = r.value as unknown as CompletedAuditStat;
    if (v.ts < since || v.ts > until) continue;
    scanned++;
    const finding = await getFinding(orgId, v.findingId);
    const reviewScore = (finding as Record<string, unknown>)?.reviewScore as number | undefined;
    if (reviewScore !== undefined && reviewScore !== v.score) {
      const remaining = (r.key as unknown as { expireIn?: number });
      await c.rawDb.set(r.key, { ...v, score: reviewScore }, { expireIn: DAY_MS });
      updated++;
      console.log(`[BACKFILL-REVIEW-SCORES] Updated ${v.findingId}: ${v.score}% → ${reviewScore}%`);
    }
  }
  return { scanned, updated };
}

export async function getStuckFindings(thresholdMs = 15 * 60 * 1000): Promise<Array<{ orgId: string; findingId: string; step: string; ts: number; ageMs: number }>> {
  const w = await store(WatchdogActive);
  const now = Date.now();
  const all = await w.list();
  const stuck: Array<{ orgId: string; findingId: string; step: string; ts: number; ageMs: number }> = [];
  for (const entry of all) {
    const v = entry.value as unknown as { orgId: string; findingId: string; step: string; ts: number };
    const ageMs = now - (v.ts ?? 0);
    if (ageMs > thresholdMs) stuck.push({ ...v, ageMs });
  }
  return stuck;
}

export async function terminateAllActive(orgId: OrgId): Promise<number> {
  const s = await store(ActiveTracking);
  const entries = await s.listRaw([orgId]);
  await Promise.all(entries.map(async (entry) => {
    const v = entry.value as unknown as { findingId?: string };
    // Use value first, fall back to key segment (handles old entries without findingId in value)
    const fid = v.findingId || (entry.key[entry.key.length - 1] as string) || "";
    console.log(`[terminateAllActive] terminating fid=${fid} key=${JSON.stringify(entry.key)}`);
    try {
      const finding = await getFinding(orgId, fid);
      if (finding && finding.findingStatus !== "finished") {
        finding.findingStatus = "terminated";
        await saveFinding(orgId, finding);
      }
    } catch { /* best-effort */ }
    // Delete by the actual KV key segment, not derived fid
    const keyFid = entry.key[entry.key.length - 1] as string;
    await s.delete([orgId, keyFid]);
    const w = await store(WatchdogActive);
    await w.delete([keyFid]);
  }));
  return entries.length;
}

export async function terminateFinding(orgId: OrgId, findingId: string): Promise<void> {
  const s = await store(ActiveTracking);
  try {
    const finding = await getFinding(orgId, findingId);
    if (finding && finding.findingStatus !== "finished") {
      finding.findingStatus = "terminated";
      await saveFinding(orgId, finding);
    }
  } catch { /* best-effort */ }
  await s.delete([orgId, findingId]);
  const w = await store(WatchdogActive);
  await w.delete([findingId]);
}

export async function trackError(orgId: OrgId, findingId: string, step: string, error: string) {
  const s = await store(ErrorTracking);
  await s.set([orgId, `${Date.now()}-${findingId}`], { findingId, step, error, ts: Date.now() } as any, { expireIn: DAY_MS });
}

export async function clearErrors(orgId: OrgId): Promise<number> {
  const s = await store(ErrorTracking);
  const entries = await s.listRaw([orgId], { limit: 1000 });
  // e.key is the full raw key [__TypeName__, ...parts]; slice(1) to drop the prefix before passing to s.delete()
  await Promise.all(entries.map((e) => s.delete(Array.from(e.key).slice(1) as string[])));
  return entries.length;
}

export async function trackRetry(orgId: OrgId, findingId: string, step: string, attempt: number) {
  const s = await store(RetryTracking);
  await s.set([orgId, `${Date.now()}-${findingId}`], { findingId, step, attempt, ts: Date.now() } as any, { expireIn: DAY_MS });
}

export async function getStats(orgId: OrgId) {
  console.log(`[getStats] 🔍 start orgId=${orgId}`);
  try {
    const activeStore = await store(ActiveTracking);
    console.log(`[getStats] activeStore ready`);
    const activeRaw = await activeStore.listRaw([orgId]);
    console.log(`[getStats] activeRaw count=${activeRaw.length}`);
    const active = activeRaw.map((e) => {
      const v = e.value as unknown as Record<string, unknown>;
      // findingId is now stored in the value; fall back to last key segment for old records
      const findingId = (v.findingId as string | undefined) || (e.key[e.key.length - 1] as string) || "";
      return { ...v, findingId };
    });

    // Lazy-enrich active entries missing recordId
    await Promise.all(active.map(async (entry: any) => {
      if (entry.recordId) return;
      try {
        const finding = await getFinding(orgId, entry.findingId);
        if (!finding) return;
        const recordId = String(finding.record?.RecordId ?? "");
        if (!recordId) return;
        entry.recordId = recordId;
        entry.isPackage = finding.recordingIdField === "GenieNumber";
        await activeStore.set([orgId, entry.findingId], {
          step: entry.step, ts: entry.ts, recordId: entry.recordId, isPackage: entry.isPackage,
        } as any);
      } catch (err) {
        console.warn(`[getStats] ⚠️ enrich failed for ${entry.findingId}:`, err);
      }
    }));
    console.log(`[getStats] active enriched count=${active.length}`);

    const since24h = Date.now() - DAY_MS;

    const completedStore = await store(CompletedAuditStatDto);
    console.log(`[getStats] completedStore ready`);
    const completed = (await completedStore.listRaw([orgId], { reverse: true, limit: 500 }))
      .map((e) => e.value)
      .filter((c: any) => c.ts > since24h);
    console.log(`[getStats] completed 24h count=${completed.length}`);

    const errorStore = await store(ErrorTracking);
    const errors = (await errorStore.listRaw([orgId], { reverse: true, limit: 500 }))
      .map((e) => e.value)
      .filter((e: any) => e.ts > since24h);
    console.log(`[getStats] errors 24h count=${errors.length}`);

    const retryStore = await store(RetryTracking);
    const retries = (await retryStore.listRaw([orgId], { reverse: true, limit: 500 }))
      .map((e) => e.value)
      .filter((r: any) => r.ts > since24h);
    console.log(`[getStats] retries 24h count=${retries.length}`);

    console.log(`[getStats] ✅ done`);
    return { active, completed, completedCount: completed.length, errors, retries };
  } catch (err) {
    console.error(`[getStats] ❌ failed:`, err);
    throw err;
  }
}

// ── Transcript (chunked) ────────────────────────────────────────────────────

export async function saveTranscript(orgId: OrgId, findingId: string, raw: string, diarized?: string, utteranceTimes?: number[]) {
  const s = await store(AuditTranscript);
  const existing = await s.getChunked([orgId, findingId]) as { raw: string; diarized: string; utteranceTimes?: number[] } | null;
  await s.setChunked([orgId, findingId], {
    raw,
    diarized: diarized ?? existing?.diarized ?? raw,
    utteranceTimes: utteranceTimes ?? existing?.utteranceTimes,
  } as any);
}

export async function getTranscript(orgId: OrgId, findingId: string) {
  const s = await store(AuditTranscript);
  return s.getChunked([orgId, findingId]) as Promise<{ raw: string; diarized: string; utteranceTimes?: number[] } | null>;
}

export async function backfillUtteranceTimes(
  orgId: OrgId,
  findingId: string,
  transcript: { raw: string; diarized: string; utteranceTimes?: number[] },
): Promise<{ raw: string; diarized: string; utteranceTimes?: number[] }> {
  if (transcript.utteranceTimes && transcript.utteranceTimes.length > 0) return transcript;

  try {
    const finding = await getFinding(orgId, findingId);
    const transcriptId = (finding as Record<string, unknown>)?.assemblyAiTranscriptId as string | undefined;

    if (transcriptId) {
      try {
        const aaiResult = await pollTranscriptOnce(transcriptId);
        if (aaiResult.status === "completed") {
          const snipStart = (finding as Record<string, unknown>)?.snipStart as number | undefined;
          const snipEnd = (finding as Record<string, unknown>)?.snipEnd as number | undefined;
          const processed = processTranscriptResult(aaiResult, snipStart, snipEnd);
          if (processed.utterances && processed.utterances.length > 0) {
            const times = processed.utterances.map((u: { start: number }) => u.start);
            await saveTranscript(orgId, findingId, transcript.raw, transcript.diarized, times);
            console.log(`[BACKFILL] ${findingId}: Backfilled ${times.length} utteranceTimes from AssemblyAI`);
            return { ...transcript, utteranceTimes: times };
          }
        }
      } catch {
        // AssemblyAI re-fetch failed — fall through to synthetic generation
      }
    }

    const raw = transcript.raw || "";
    const lines = raw.split("\n").filter((l: string) => l.trim().length > 0);
    if (lines.length > 0) {
      const wordCounts = lines.map((l: string) => l.split(/\s+/).length);
      const totalWords = wordCounts.reduce((a: number, b: number) => a + b, 0);
      const estimatedDurationMs = (totalWords / 150) * 60 * 1000;
      const times: number[] = [];
      let cumWords = 0;
      for (const wc of wordCounts) {
        times.push(Math.round((cumWords / totalWords) * estimatedDurationMs));
        cumWords += wc;
      }
      await saveTranscript(orgId, findingId, transcript.raw, transcript.diarized, times);
      console.log(`[BACKFILL] ${findingId}: Generated ${times.length} synthetic utteranceTimes (${Math.round(estimatedDurationMs / 1000)}s estimated)`);
      return { ...transcript, utteranceTimes: times };
    }
  } catch (err) {
    console.warn(`[BACKFILL] ${findingId}: Failed to backfill utteranceTimes:`, err);
  }

  return transcript;
}

// ── Pipeline Config ─────────────────────────────────────────────────────────

export interface PipelineConfig {
  maxRetries: number;
  retryDelaySeconds: number;
  parallelism: number;
}

const DEFAULT_PIPELINE_CONFIG: PipelineConfig = { maxRetries: 5, retryDelaySeconds: 10, parallelism: 20 };

export async function getPipelineConfig(orgId: OrgId): Promise<PipelineConfig> {
  const s = await store(PipelineConfigDto);
  const v = await s.get([orgId]);
  return (v as unknown as PipelineConfig) ?? DEFAULT_PIPELINE_CONFIG;
}

export async function setPipelineConfig(orgId: OrgId, config: Partial<PipelineConfig>): Promise<PipelineConfig> {
  const s = await store(PipelineConfigDto);
  const current = ((await s.get([orgId])) as unknown as PipelineConfig) ?? DEFAULT_PIPELINE_CONFIG;
  const merged = { ...current, ...config };
  await s.set([orgId], merged as any);
  return merged;
}

// ── Webhook Config ──────────────────────────────────────────────────────────

export interface WebhookConfig {
  postUrl: string;
  postHeaders: Record<string, string>;
  testEmail?: string;
  emailTemplateId?: string;
  bcc?: string;
}

// ── Sheets Service Account (stored in KV to avoid env var secret scanning) ──

export interface SheetsServiceAccount {
  email: string;
  privateKey: string; // base64-encoded PEM
}

export async function getSheetsServiceAccount(orgId: OrgId): Promise<SheetsServiceAccount | null> {
  const kv = await db();
  const v = await kv.get<SheetsServiceAccount>([orgId, "sheets-sa"]);
  return v.value;
}

export async function saveSheetsServiceAccount(orgId: OrgId, sa: SheetsServiceAccount): Promise<void> {
  const kv = await db();
  await kv.set([orgId, "sheets-sa"], sa);
}

export type WebhookKind = "terminate" | "appeal" | "manager" | "judge" | "re-audit-receipt";

export async function getWebhookConfig(orgId: OrgId, kind: WebhookKind): Promise<WebhookConfig | null> {
  const s = await store(WebhookConfigDto);
  const v = await s.get([orgId, kind]);
  return v as unknown as WebhookConfig | null;
}

export async function saveWebhookConfig(orgId: OrgId, kind: WebhookKind, config: WebhookConfig): Promise<void> {
  const s = await store(WebhookConfigDto);
  await s.set([orgId, kind], config as any);
}

// ── Webhook Email Handler Registry ──────────────────────────────────────────
// Deno Deploy blocks HTTP self-fetches (508 Loop Detected), so email handlers
// are registered here and called in-process instead of via fetch().

type WebhookEmailHandler = (orgId: OrgId, payload: unknown) => Promise<void>;
const _webhookEmailHandlers: Partial<Record<WebhookKind, WebhookEmailHandler>> = {};

export function registerWebhookEmailHandler(kind: WebhookKind, handler: WebhookEmailHandler): void {
  _webhookEmailHandlers[kind] = handler;
}

export async function fireWebhook(orgId: OrgId, kind: WebhookKind, payload: unknown): Promise<void> {
  const fid = (payload as Record<string, unknown>).findingId ?? "";
  console.log(`[WEBHOOK:${kind}] 🔔 Starting — org=${orgId} fid=${fid}`);
  const config = await getWebhookConfig(orgId, kind);
  console.log(`[WEBHOOK:${kind}] Config: postUrl=${config?.postUrl || "none"} emailTemplateId=${config?.emailTemplateId || "none"} fid=${fid}`);

  // Call registered email handler directly (avoids Deno Deploy 508 loop-detected)
  const emailHandler = _webhookEmailHandlers[kind];
  if (emailHandler) {
    console.log(`[WEBHOOK:${kind}] Calling in-process email handler fid=${fid}`);
    await emailHandler(orgId, payload).catch((err) =>
      console.error(`[WEBHOOK:${kind}] ❌ Email handler failed fid=${fid}:`, err)
    );
  }

  // External webhook URL — skip if not set or if it points to our own endpoint
  const selfEmailPaths: Partial<Record<WebhookKind, string>> = {
    terminate: "/webhooks/audit-complete",
    appeal: "/webhooks/appeal-filed",
    manager: "/webhooks/manager-review",
    judge: "/webhooks/appeal-decided",
  };
  const selfPath = selfEmailPaths[kind];
  const isSelfUrl = selfPath && config?.postUrl?.includes(selfPath);
  if (!config?.postUrl || isSelfUrl) {
    console.log(`[WEBHOOK:${kind}] No external postUrl — done fid=${fid}`);
    return;
  }

  console.log(`[WEBHOOK:${kind}] External POST → ${config.postUrl} fid=${fid}`);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...config.postHeaders,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(config.postUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const respText = await res.text().catch(() => "");
    console.log(`[WEBHOOK:${kind}] ✅ POST success fid=${fid} resp=${respText.slice(0, 200)}`);
  } catch (err) {
    console.error(`[WEBHOOK:${kind}] ❌ POST failed fid=${fid}:`, err);
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── Email Report Config ─────────────────────────────────────────────────────

export type ScheduleSimpleDays = "every" | "weekdays" | "weekends";

export type ScheduleConfig =
  | { mode: "simple"; frequency: "daily";   timeOfDayEst: string; days: ScheduleSimpleDays }
  | { mode: "simple"; frequency: "hourly" }
  | { mode: "simple"; frequency: "monthly"; timeOfDayEst: string; dayOfMonth: number }
  | { mode: "cron";   expression: string };

export type DateRangeConfig =
  | { mode: "rolling"; hours: number }
  | { mode: "fixed"; from: number; to: number };

export interface AuditDoneIndexEntry {
  findingId: string;
  completedAt: number;
  doneAt?: number;
  completed: boolean;
  reason?: "perfect_score" | "invalid_genie" | "reviewed";
  score: number;
}

export type CriteriaField =
  | "questionHeader"
  | "questionAnswer"
  | "score"
  | "reason"
  | "voName"
  | "department"
  | "appealStatus"
  | "auditType"        // "internal" (date-leg) | "partner" (package)
  | "reviewed";        // "true" | "false" — was this audit touched by a human reviewer

export type CriteriaOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "starts_with"
  | "less_than"
  | "greater_than";

export type ReportColumnKey =
  | "recordId"
  | "findingId"
  | "guestName"
  | "voName"
  | "department"
  | "score"
  | "appealStatus"
  | "finalizedAt"
  | "markedForReview";

export interface CriteriaRule {
  field: CriteriaField;
  operator: CriteriaOperator;
  value: string;
}

export interface ReportSectionDef {
  id: string;
  header: string;
  criteria: CriteriaRule[];
  columns: ReportColumnKey[];
}

export interface EmailReportConfig {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  // Master filter
  onlyCompleted?: boolean;        // default true — filter by doneAt; false = filter by completedAt
  dateRange?: DateRangeConfig;    // default { mode: "rolling", hours: 24 }
  // Schedule
  schedule?: ScheduleConfig;
  // Recipients
  recipients: string[];
  cc?: string[];
  bcc?: string[];
  // Report definition
  templateId?: string;
  topLevelFilters?: CriteriaRule[];
  reportSections?: ReportSectionDef[];
  disabled?: boolean;
}

export async function listEmailReportConfigs(orgId: OrgId): Promise<EmailReportConfig[]> {
  const s = await store(EmailReportConfigDto);
  const results = await s.list(orgId);
  return results.map((r) => r.value) as unknown as EmailReportConfig[];
}

export async function getEmailReportConfig(orgId: OrgId, id: string): Promise<EmailReportConfig | null> {
  const s = await store(EmailReportConfigDto);
  return s.get([orgId, id]) as unknown as Promise<EmailReportConfig | null>;
}

export async function saveEmailReportConfig(
  orgId: OrgId,
  config: Partial<EmailReportConfig> & { name: string; recipients: string[] },
): Promise<EmailReportConfig> {
  const s = await store(EmailReportConfigDto);
  const now = Date.now();
  const full: EmailReportConfig = {
    id: config.id || crypto.randomUUID(),
    name: config.name,
    recipients: config.recipients,
    onlyCompleted: config.onlyCompleted ?? true,
    ...(config.dateRange ? { dateRange: config.dateRange } : {}),
    ...(config.cc ? { cc: config.cc } : {}),
    ...(config.bcc ? { bcc: config.bcc } : {}),
    ...(config.schedule ? { schedule: config.schedule } : {}),
    ...(config.templateId ? { templateId: config.templateId } : {}),
    ...(config.topLevelFilters ? { topLevelFilters: config.topLevelFilters } : {}),
    ...(config.reportSections ? { reportSections: config.reportSections } : {}),
    ...(config.disabled ? { disabled: config.disabled } : {}),
    createdAt: config.createdAt || now,
    updatedAt: now,
  };
  await s.set([orgId, full.id], full as any);
  return full;
}

export async function deleteEmailReportConfig(orgId: OrgId, id: string): Promise<void> {
  const s = await store(EmailReportConfigDto);
  await s.delete([orgId, id]);
}

// ── Audit Done Secondary Index ───────────────────────────────────────────────

function padTs(ts: number): string {
  return String(ts).padStart(16, "0");
}

export async function writeAuditDoneIndex(
  orgId: OrgId,
  entry: AuditDoneIndexEntry,
): Promise<void> {
  const kvDb = await db();
  const key = orgKey(orgId, "audit-done-idx", padTs(entry.completedAt), entry.findingId);
  await kvDb.set(key, entry);
}

export async function queryAuditDoneIndex(
  orgId: OrgId,
  from: number,
  to: number,
): Promise<AuditDoneIndexEntry[]> {
  const kvDb = await db();
  const start = orgKey(orgId, "audit-done-idx", padTs(from));
  const end = orgKey(orgId, "audit-done-idx", padTs(to + 1));
  const entries: AuditDoneIndexEntry[] = [];
  for await (const entry of kvDb.list<AuditDoneIndexEntry>({ start, end })) {
    if (entry.value) entries.push(entry.value);
  }
  return entries;
}

// ── Email Report Preview Cache ───────────────────────────────────────────────

export interface EmailReportPreview {
  html: string;
  renderedAt: number;
}

export async function getEmailReportPreview(orgId: OrgId, configId: string): Promise<EmailReportPreview | null> {
  const kvDb = await db();
  const entry = await kvDb.get<EmailReportPreview>(orgKey(orgId, "email-report-preview", configId));
  return entry.value ?? null;
}

export async function saveEmailReportPreview(orgId: OrgId, configId: string, html: string): Promise<void> {
  const kvDb = await db();
  await kvDb.set(orgKey(orgId, "email-report-preview", configId), { html, renderedAt: Date.now() }, { expireIn: 86_400_000 });
}

export async function deleteEmailReportPreview(orgId: OrgId, configId: string): Promise<void> {
  const kvDb = await db();
  await kvDb.delete(orgKey(orgId, "email-report-preview", configId));
}

// ── Email Templates ─────────────────────────────────────────────────────────

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  html: string;
  createdAt: number;
  updatedAt: number;
}

export async function listEmailTemplates(orgId: OrgId): Promise<EmailTemplate[]> {
  const s = await store(EmailTemplateDto);
  const results = await s.list(orgId);
  return results.map((r) => r.value) as unknown as EmailTemplate[];
}

export async function getEmailTemplate(orgId: OrgId, id: string): Promise<EmailTemplate | null> {
  const s = await store(EmailTemplateDto);
  return s.get([orgId, id]) as unknown as Promise<EmailTemplate | null>;
}

export async function saveEmailTemplate(orgId: OrgId, template: Partial<EmailTemplate> & { name: string; subject: string; html: string }): Promise<EmailTemplate> {
  const s = await store(EmailTemplateDto);
  const now = Date.now();
  const full: EmailTemplate = {
    id: template.id || crypto.randomUUID(),
    name: template.name,
    subject: template.subject,
    html: template.html,
    createdAt: template.createdAt || now,
    updatedAt: now,
  };
  await s.set([orgId, full.id], full as any);
  return full;
}

export async function deleteEmailTemplate(orgId: OrgId, id: string): Promise<void> {
  const s = await store(EmailTemplateDto);
  await s.delete([orgId, id]);
}

// ── Bad Word Config ─────────────────────────────────────────────────────────

export interface ExclusionRule {
  word: string;
  buffer: number;
  type: "prefix" | "suffix";
}

export interface BadWordEntry {
  word: string;
  exclusions?: ExclusionRule[];
}

export interface BadWordConfig {
  enabled: boolean;
  emails: string[];
  words: BadWordEntry[];
  allOffices: boolean;
  officePatterns: string[];
}

const DEFAULT_BAD_WORD_CONFIG: BadWordConfig = {
  enabled: false,
  emails: [],
  words: [],
  allOffices: false,
  officePatterns: [],
};

export async function getBadWordConfig(orgId: OrgId): Promise<BadWordConfig> {
  const s = await store(BadWordConfigDto);
  const v = await s.get([orgId]);
  return (v as unknown as BadWordConfig) ?? { ...DEFAULT_BAD_WORD_CONFIG };
}

export async function saveBadWordConfig(orgId: OrgId, config: BadWordConfig): Promise<void> {
  const s = await store(BadWordConfigDto);
  await s.set([orgId], config as any);
}

// ── Office Bypass Config ─────────────────────────────────────────────────────

export interface OfficeBypassConfig {
  // Office name patterns (case-insensitive contains). Matching offices skip review queue + audit emails.
  patterns: string[];
}

export async function getOfficeBypassConfig(orgId: OrgId): Promise<OfficeBypassConfig> {
  const s = await store(OfficeBypassConfigDto);
  const v = await s.get([orgId]);
  return (v as unknown as OfficeBypassConfig) ?? { patterns: [] };
}

export async function saveOfficeBypassConfig(orgId: OrgId, config: OfficeBypassConfig): Promise<void> {
  const s = await store(OfficeBypassConfigDto);
  await s.set([orgId], config as any);
}

// ── Manager Scope (department+shift access per manager) ──────────────────────

export interface ManagerScope {
  departments: string[];
  shifts: string[];
}

export async function getManagerScope(orgId: OrgId, managerEmail: string): Promise<ManagerScope> {
  const s = await store(ManagerScopeConfigDto);
  const v = await s.get([orgId, managerEmail]);
  return (v as unknown as ManagerScope) ?? { departments: [], shifts: [] };
}

export async function saveManagerScope(orgId: OrgId, managerEmail: string, scope: ManagerScope): Promise<void> {
  const s = await store(ManagerScopeConfigDto);
  await s.set([orgId, managerEmail], scope as any);
}

export async function listManagerScopes(orgId: OrgId): Promise<Record<string, ManagerScope>> {
  const s = await store(ManagerScopeConfigDto);
  const results = await s.listRaw([orgId]);
  const out: Record<string, ManagerScope> = {};
  for (const r of results) {
    const email = (r.key as string[])[2]; // [__manager-scope-config__, orgId, email]
    if (email) out[email] = r.value as unknown as ManagerScope;
  }
  return out;
}

// ── Persistent Audit Dimensions Index ────────────────────────────────────────

export interface AuditDimensions {
  departments: string[];
  shifts: string[];
}

export async function getAuditDimensions(orgId: OrgId): Promise<AuditDimensions> {
  const s = await store(AuditDimensionsConfigDto);
  const v = await s.get([orgId]);
  return (v as unknown as AuditDimensions) ?? { departments: [], shifts: [] };
}

export async function saveAuditDimensions(orgId: OrgId, dims: AuditDimensions): Promise<void> {
  const s = await store(AuditDimensionsConfigDto);
  await s.set([orgId], dims as any);
}

export async function updateAuditDimensions(orgId: OrgId, department?: string, shift?: string): Promise<void> {
  const dims = await getAuditDimensions(orgId);
  let changed = false;
  if (department && !dims.departments.includes(department)) {
    dims.departments = [...dims.departments, department].sort();
    changed = true;
  }
  if (shift && !dims.shifts.includes(shift)) {
    dims.shifts = [...dims.shifts, shift].sort();
    changed = true;
  }
  if (changed) await saveAuditDimensions(orgId, dims);
}

// ── Reviewer Config (judge-assigned per-reviewer type limits) ────────────────

export interface ReviewerConfig {
  allowedTypes: ("date-leg" | "package")[];
}

export async function getReviewerConfig(orgId: OrgId, email: string): Promise<ReviewerConfig | null> {
  const s = await store(ReviewerConfigDto);
  return s.get([orgId, email]) as unknown as Promise<ReviewerConfig | null>;
}

export async function saveReviewerConfig(orgId: OrgId, email: string, config: ReviewerConfig): Promise<void> {
  const s = await store(ReviewerConfigDto);
  await s.set([orgId, email], config as any);
}

// ── Sound Pack Metadata ─────────────────────────────────────────────────────

export type SoundSlot = "ping" | "double" | "triple" | "mega" | "ultra" | "rampage" | "godlike" | "levelup" | "shutdown";
export type SoundPackId = "synth" | "smite" | "opengameart" | "mixkit-punchy" | "mixkit-epic" | (string & {});

export interface SoundPackMeta {
  id: string;
  name: string;
  slots: Partial<Record<SoundSlot, string>>;
  createdAt: number;
  createdBy: string;
}

export async function listSoundPacks(orgId: OrgId): Promise<SoundPackMeta[]> {
  const s = await store(SoundPackMetaDto);
  const results = await s.list(orgId);
  return results.map((r) => r.value) as unknown as SoundPackMeta[];
}

export async function getSoundPack(orgId: OrgId, packId: string): Promise<SoundPackMeta | null> {
  const s = await store(SoundPackMetaDto);
  return s.get([orgId, packId]) as unknown as Promise<SoundPackMeta | null>;
}

export async function saveSoundPack(orgId: OrgId, pack: SoundPackMeta): Promise<void> {
  const s = await store(SoundPackMetaDto);
  await s.set([orgId, pack.id], pack as any);
}

export async function deleteSoundPack(orgId: OrgId, packId: string): Promise<void> {
  const s = await store(SoundPackMetaDto);
  await s.delete([orgId, packId]);
}

// ── Gamification Settings ───────────────────────────────────────────────────

export interface GamificationSettings {
  threshold: number | null;
  comboTimeoutMs: number | null;
  enabled: boolean | null;
  sounds: Partial<Record<SoundSlot, SoundPackId>> | null;
}

const GAMIFICATION_DEFAULTS: Required<{ [K in keyof GamificationSettings]: NonNullable<GamificationSettings[K]> }> = {
  threshold: 0,
  comboTimeoutMs: 10000,
  enabled: true,
  sounds: {},
};

export async function getGamificationSettings(orgId: OrgId): Promise<GamificationSettings | null> {
  const s = await store(GamificationSettingsDto);
  return s.get([orgId]) as unknown as Promise<GamificationSettings | null>;
}

export async function saveGamificationSettings(orgId: OrgId, settings: GamificationSettings): Promise<void> {
  const s = await store(GamificationSettingsDto);
  await s.set([orgId], settings as any);
}

export async function getJudgeGamificationOverride(orgId: OrgId, judgeEmail: string): Promise<GamificationSettings | null> {
  const s = await store(GamificationSettingsDto);
  return s.get([orgId, "judge", judgeEmail]) as unknown as Promise<GamificationSettings | null>;
}

export async function saveJudgeGamificationOverride(orgId: OrgId, judgeEmail: string, settings: GamificationSettings): Promise<void> {
  const s = await store(GamificationSettingsDto);
  await s.set([orgId, "judge", judgeEmail], settings as any);
}

export async function getReviewerGamificationOverride(orgId: OrgId, email: string): Promise<GamificationSettings | null> {
  const s = await store(GamificationSettingsDto);
  return s.get([orgId, "reviewer", email]) as unknown as Promise<GamificationSettings | null>;
}

export async function saveReviewerGamificationOverride(orgId: OrgId, email: string, settings: GamificationSettings): Promise<void> {
  const s = await store(GamificationSettingsDto);
  await s.set([orgId, "reviewer", email], settings as any);
}

function overlaySettings(
  base: Record<string, unknown>,
  override: GamificationSettings | null,
): Record<string, unknown> {
  if (!override) return base;
  const result = { ...base };
  for (const key of Object.keys(override) as (keyof GamificationSettings)[]) {
    if (override[key] !== null && override[key] !== undefined) {
      result[key] = override[key];
    }
  }
  return result;
}

export interface ResolvedGamificationSettings {
  threshold: number;
  comboTimeoutMs: number;
  enabled: boolean;
  sounds: Partial<Record<SoundSlot, SoundPackId>>;
}

export async function resolveGamificationSettings(
  orgId: OrgId,
  email: string,
  role: string,
  supervisor?: string | null,
): Promise<ResolvedGamificationSettings> {
  let merged: Record<string, unknown> = { ...GAMIFICATION_DEFAULTS };
  const orgSettings = await getGamificationSettings(orgId);
  merged = overlaySettings(merged, orgSettings);
  if (role === "reviewer" && supervisor) {
    const judgeOverride = await getJudgeGamificationOverride(orgId, supervisor);
    merged = overlaySettings(merged, judgeOverride);
  }
  const personalOverride = await getReviewerGamificationOverride(orgId, email);
  merged = overlaySettings(merged, personalOverride);
  return merged as unknown as ResolvedGamificationSettings;
}

// ── Custom Store Items ──────────────────────────────────────────────────────

import type { StoreItem } from "../shared/badges.ts";

export async function listCustomStoreItems(orgId: OrgId): Promise<StoreItem[]> {
  const s = await store(CustomStoreItem);
  const results = await s.list(orgId);
  return results.map((r) => r.value) as unknown as StoreItem[];
}

export async function saveCustomStoreItem(orgId: OrgId, item: StoreItem): Promise<void> {
  const s = await store(CustomStoreItem);
  await s.set([orgId, item.id], item as any);
}

export async function deleteCustomStoreItem(orgId: OrgId, itemId: string): Promise<void> {
  const s = await store(CustomStoreItem);
  await s.delete([orgId, itemId]);
}

// ── Badge + Game State ──────────────────────────────────────────────────────

import type { EarnedBadge, BadgeCheckState, GameState, BadgeDef } from "../shared/badges.ts";
import { DEFAULT_BADGE_STATS, DEFAULT_GAME_STATE, getLevel, LEVEL_THRESHOLDS, AGENT_LEVEL_THRESHOLDS } from "../shared/badges.ts";

export async function getEarnedBadges(orgId: OrgId, email: string): Promise<EarnedBadge[]> {
  const s = await store(EarnedBadgeDto);
  const results = await s.list(orgId, email);
  return results.map((r) => r.value) as unknown as EarnedBadge[];
}

export async function awardBadge(orgId: OrgId, email: string, badge: BadgeDef): Promise<boolean> {
  const s = await store(EarnedBadgeDto);
  const key = s.toKey([orgId, email, badge.id]);
  const existing = await s.rawDb.get(key);
  if (existing.value) return false;
  const earned: EarnedBadge = { badgeId: badge.id, earnedAt: Date.now() };
  const res = await s.rawDb.atomic()
    .check(existing)
    .set(key, earned)
    .commit();
  return res.ok;
}

export async function hasBadge(orgId: OrgId, email: string, badgeId: string): Promise<boolean> {
  const s = await store(EarnedBadgeDto);
  const v = await s.get([orgId, email, badgeId]);
  return v !== null;
}

export async function getBadgeStats(orgId: OrgId, email: string): Promise<BadgeCheckState> {
  const s = await store(BadgeStatsDto);
  const v = await s.get([orgId, email]);
  return (v as unknown as BadgeCheckState) ?? { ...DEFAULT_BADGE_STATS };
}

export async function updateBadgeStats(orgId: OrgId, email: string, patch: Partial<BadgeCheckState>): Promise<BadgeCheckState> {
  const s = await store(BadgeStatsDto);
  const current = ((await s.get([orgId, email])) as unknown as BadgeCheckState) ?? { ...DEFAULT_BADGE_STATS };
  const updated = { ...current, ...patch };
  await s.set([orgId, email], updated as any);
  return updated;
}

export async function getGameState(orgId: OrgId, email: string): Promise<GameState> {
  const s = await store(GameStateDto);
  const v = await s.get([orgId, email]);
  return (v as unknown as GameState) ?? { ...DEFAULT_GAME_STATE };
}

export async function saveGameState(orgId: OrgId, email: string, state: GameState): Promise<void> {
  const s = await store(GameStateDto);
  await s.set([orgId, email], state as any);
}

export async function awardXp(
  orgId: OrgId,
  email: string,
  xpAmount: number,
  role: "reviewer" | "judge" | "manager" | "agent",
): Promise<{ state: GameState; xpGained: number; leveledUp: boolean }> {
  const state = await getGameState(orgId, email);
  const prevLevel = state.level;
  state.totalXp += xpAmount;
  state.tokenBalance += xpAmount;
  const thresholds = role === "agent" ? AGENT_LEVEL_THRESHOLDS : LEVEL_THRESHOLDS;
  state.level = getLevel(state.totalXp, thresholds);
  const today = new Date().toISOString().slice(0, 10);
  if (state.lastActiveDate !== today) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    state.dayStreak = state.lastActiveDate === yesterday ? state.dayStreak + 1 : 1;
    state.lastActiveDate = today;
  }
  await saveGameState(orgId, email, state);
  const leveledUp = state.level > prevLevel;
  if (leveledUp) {
    checkAndEmitPrefab(orgId, "level_up", email, `${email.split("@")[0]} reached level ${state.level}!`)
      .catch(() => {});
  }
  return { state, xpGained: xpAmount, leveledUp };
}

export async function purchaseStoreItem(
  orgId: OrgId,
  email: string,
  itemId: string,
  price: number,
): Promise<{ ok: true; newBalance: number } | { ok: false; error: string }> {
  const s = await store(GameStateDto);
  const key = s.toKey([orgId, email]);
  const entry = await s.rawDb.get<GameState>(key);
  const state = entry.value ?? { ...DEFAULT_GAME_STATE };
  if (state.purchases.includes(itemId)) {
    return { ok: false, error: "already purchased" };
  }
  if (state.tokenBalance < price) {
    return { ok: false, error: "insufficient tokens" };
  }
  state.tokenBalance -= price;
  state.purchases.push(itemId);
  const res = await s.rawDb.atomic()
    .check(entry)
    .set(key, state)
    .commit();
  if (!res.ok) return { ok: false, error: "concurrent modification, try again" };
  return { ok: true, newBalance: state.tokenBalance };
}

// ── SSE Events ──────────────────────────────────────────────────────────────

export type EventType =
  | "audit-completed"
  | "review-decided"
  | "appeal-decided"
  | "remediation-submitted"
  | "message-received";

export interface AppEvent {
  id: string;
  type: EventType;
  payload: Record<string, unknown>;
  createdAt: number;
}

export async function emitEvent(
  orgId: OrgId,
  targetEmail: string,
  type: EventType,
  payload: Record<string, unknown>,
): Promise<void> {
  const s = await store(AppEventDto);
  const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const event: AppEvent = { id, type, payload, createdAt: Date.now() };
  await s.set([orgId, targetEmail, id], event as any, { expireIn: DAY_MS });
}

export async function getEvents(
  orgId: OrgId,
  email: string,
  since = 0,
): Promise<AppEvent[]> {
  const s = await store(AppEventDto);
  const results = await s.list(orgId, email);
  return (results.map((r) => r.value) as unknown as AppEvent[])
    .filter((e) => e.createdAt > since);
}

export async function deleteEvents(orgId: OrgId, email: string, eventIds: string[]): Promise<void> {
  const s = await store(AppEventDto);
  for (const id of eventIds) {
    await s.delete([orgId, email, id]);
  }
}

// ── Prefab Broadcast Events ─────────────────────────────────────────────────

export interface BroadcastEvent {
  id: string;
  type: string;
  triggerEmail: string;
  displayName: string;
  message: string;
  animationId: string | null;
  ts: number;
}

export async function getPrefabSubscriptions(orgId: OrgId): Promise<Record<string, boolean>> {
  const s = await store(PrefabSubscriptions);
  const v = await s.get([orgId]);
  return (v as unknown as Record<string, boolean>) ?? {};
}

export async function savePrefabSubscriptions(orgId: OrgId, subs: Record<string, boolean>): Promise<void> {
  const s = await store(PrefabSubscriptions);
  await s.set([orgId], subs as any);
}

export async function emitBroadcastEvent(
  orgId: OrgId,
  prefabType: string,
  triggerEmail: string,
  message: string,
  animationId: string | null,
): Promise<void> {
  const s = await store(BroadcastEventDto);
  const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const event: BroadcastEvent = {
    id,
    type: prefabType,
    triggerEmail,
    displayName: triggerEmail.split("@")[0],
    message,
    animationId,
    ts: Date.now(),
  };
  await s.set([orgId, id], event as any, { expireIn: DAY_MS });
}

export async function getBroadcastEvents(orgId: OrgId, since = 0): Promise<BroadcastEvent[]> {
  const s = await store(BroadcastEventDto);
  const results = await s.list(orgId);
  return (results.map((r) => r.value) as unknown as BroadcastEvent[])
    .filter((e) => e.ts > since);
}

export async function checkAndEmitPrefab(
  orgId: OrgId,
  prefabType: string,
  email: string,
  message: string,
): Promise<void> {
  const subs = await getPrefabSubscriptions(orgId);
  if (!subs[prefabType]) return;
  const gs = await getGameState(orgId, email);
  const animationId = gs.animBindings?.[prefabType] ?? null;
  await emitBroadcastEvent(orgId, prefabType, email, message, animationId);
}

// ── Messaging ───────────────────────────────────────────────────────────────

export interface Message {
  id: string;
  from: string;
  to: string;
  body: string;
  ts: number;
  read: boolean;
}

export async function sendMessage(
  orgId: OrgId,
  from: string,
  to: string,
  body: string,
): Promise<Message> {
  const msgStore = await store(MessageDto);
  const unreadStore = await store(UnreadCount);
  const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const msg: Message = { id, from, to, body, ts: Date.now(), read: false };

  const convKey1 = msgStore.toKey([orgId, from, to, id]);
  const convKey2 = msgStore.toKey([orgId, to, from, id]);
  const unreadKey = unreadStore.toKey([orgId, to]);

  const unreadEntry = await unreadStore.rawDb.get<number>(unreadKey);
  const currentUnread = unreadEntry.value ?? 0;

  await msgStore.rawDb.atomic()
    .set(convKey1, msg)
    .set(convKey2, msg)
    .set(unreadKey, currentUnread + 1)
    .commit();

  return msg;
}

export async function getConversation(
  orgId: OrgId,
  ownerEmail: string,
  otherEmail: string,
  limit = 50,
): Promise<Message[]> {
  const s = await store(MessageDto);
  const results = await s.listRaw([orgId, ownerEmail, otherEmail], { reverse: true, limit });
  return results.map((r) => r.value) as unknown as Message[];
}

export async function getUnreadCount(orgId: OrgId, email: string): Promise<number> {
  const s = await store(UnreadCount);
  const v = await s.get([orgId, email]);
  return (v as unknown as number) ?? 0;
}

export async function markConversationRead(
  orgId: OrgId,
  ownerEmail: string,
  otherEmail: string,
): Promise<void> {
  const msgStore = await store(MessageDto);
  const results = await msgStore.listRaw([orgId, ownerEmail, otherEmail]);
  let readCount = 0;
  for (const entry of results) {
    const msg = entry.value as unknown as Message;
    if (msg && !msg.read && msg.from !== ownerEmail) {
      const updated = { ...msg, read: true };
      await msgStore.rawDb.set(entry.key, updated);
      readCount++;
    }
  }
  if (readCount > 0) {
    const unreadStore = await store(UnreadCount);
    const unreadKey = unreadStore.toKey([orgId, ownerEmail]);
    const unreadEntry = await unreadStore.rawDb.get<number>(unreadKey);
    const current = unreadEntry.value ?? 0;
    await unreadStore.rawDb.set(unreadKey, Math.max(0, current - readCount));
  }
}

export async function getConversationList(
  orgId: OrgId,
  email: string,
): Promise<Array<{ email: string; lastMessage: Message; unread: number }>> {
  const s = await store(MessageDto);
  const results = await s.listRaw([orgId, email]);
  const convMap = new Map<string, { lastMessage: Message; unread: number }>();

  for (const entry of results) {
    const msg = entry.value as unknown as Message;
    if (!msg) continue;
    const otherEmail = msg.from === email ? msg.to : msg.from;
    const existing = convMap.get(otherEmail);
    if (!existing || msg.ts > existing.lastMessage.ts) {
      const unread = existing?.unread ?? 0;
      convMap.set(otherEmail, {
        lastMessage: msg,
        unread: unread + (!msg.read && msg.from !== email ? 1 : 0),
      });
    } else if (!msg.read && msg.from !== email) {
      existing.unread++;
    }
  }

  return Array.from(convMap.entries())
    .map(([email, data]) => ({ email, ...data }))
    .sort((a, b) => b.lastMessage.ts - a.lastMessage.ts);
}
