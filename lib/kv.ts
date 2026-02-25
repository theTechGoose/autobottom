/** Deno KV state management for audit findings, jobs, and counters. All keys are org-scoped. */

import { orgKey } from "./org.ts";
import type { OrgId } from "./org.ts";

let _kv: Deno.Kv | undefined;

async function kv(): Promise<Deno.Kv> {
  if (!_kv) _kv = await Deno.openKv();
  return _kv;
}

// -- ChunkedKv: generic chunked storage to work around 64KB limit --

const CHUNK_LIMIT = 30_000; // chars per chunk; V8 may use 2-byte encoding so 30K*2=60KB < 64KB limit

class ChunkedKv {
  #db: Deno.Kv;
  constructor(db: Deno.Kv) { this.#db = db; }

  /** Save a JSON-serializable value, automatically chunking if needed. */
  async set(prefix: Deno.KvKey, value: unknown, options?: { expireIn?: number }) {
    const raw = JSON.stringify(value);
    if (raw.length <= CHUNK_LIMIT) {
      await this.#db.set([...prefix, 0], raw, options);
      await this.#db.set([...prefix, "_n"], 1, options);
      return;
    }
    const n = Math.ceil(raw.length / CHUNK_LIMIT);
    // Write chunks sequentially — atomic batch would exceed Deno KV's 800KB per-commit limit for large findings.
    // _n is written last so readers only see complete data.
    for (let i = 0; i < n; i++) {
      await this.#db.set([...prefix, i], raw.slice(i * CHUNK_LIMIT, (i + 1) * CHUNK_LIMIT), options ?? {});
    }
    await this.#db.set([...prefix, "_n"], n, options ?? {});
  }

  /** Read a chunked value back. Returns null if not found. */
  async get<T = unknown>(prefix: Deno.KvKey): Promise<T | null> {
    const meta = await this.#db.get<number>([...prefix, "_n"]);
    if (meta.value == null) return null;
    const parts: string[] = [];
    for (let i = 0; i < meta.value; i++) {
      const entry = await this.#db.get<string>([...prefix, i]);
      if (typeof entry.value !== "string") {
        console.error(`[ChunkedKv] Missing chunk ${i}/${meta.value} for key ${JSON.stringify(prefix)}`);
        return null;
      }
      parts.push(entry.value);
    }
    if (parts.length === 0) return null;
    return JSON.parse(parts.join("")) as T;
  }

  /** Delete all chunks for a prefix. */
  async delete(prefix: Deno.KvKey) {
    const meta = await this.#db.get<number>([...prefix, "_n"]);
    if (meta.value == null) return;
    // Delete _n first so readers see the key as gone immediately
    await this.#db.delete([...prefix, "_n"]);
    for (let i = 0; i < meta.value; i++) {
      await this.#db.delete([...prefix, i]);
    }
  }
}

async function chunked(): Promise<ChunkedKv> {
  return new ChunkedKv(await kv());
}

// -- Finding CRUD --

export async function getFinding(orgId: OrgId, id: string) {
  const store = await chunked();
  return store.get<Record<string, any>>(orgKey(orgId, "audit-finding", id));
}

export async function saveFinding(orgId: OrgId, finding: Record<string, any>) {
  const store = await chunked();
  await store.set(orgKey(orgId, "audit-finding", finding.id), finding);
}

// -- Job CRUD --

export async function getJob(orgId: OrgId, id: string) {
  const db = await kv();
  const entry = await db.get(orgKey(orgId, "audit-job", id));
  return entry.value as Record<string, any> | null;
}

export async function saveJob(orgId: OrgId, job: Record<string, any>) {
  const db = await kv();
  await db.set(orgKey(orgId, "audit-job", job.id), job);
}

// -- Question Cache (10 min TTL) --

export async function getCachedAnswer(orgId: OrgId, auditId: string, questionText: string) {
  const db = await kv();
  const hash = await hashString(questionText);
  const entry = await db.get(orgKey(orgId, "question-cache", auditId, hash));
  return entry.value as { answer: string; thinking: string; defense: string } | null;
}

export async function cacheAnswer(
  orgId: OrgId,
  auditId: string,
  questionText: string,
  answer: { answer: string; thinking: string; defense: string },
) {
  const db = await kv();
  const hash = await hashString(questionText);
  await db.set(orgKey(orgId, "question-cache", auditId, hash), answer, { expireIn: 600_000 });
}

// -- Question Destination Cache (10 min TTL) --

export async function getCachedQuestions(orgId: OrgId, destinationId: string) {
  const store = await chunked();
  return store.get<any[]>(orgKey(orgId, "destination-questions", destinationId));
}

export async function cacheQuestions(orgId: OrgId, destinationId: string, questions: any[]) {
  const store = await chunked();
  await store.set(orgKey(orgId, "destination-questions", destinationId), questions, { expireIn: 600_000 });
}

// -- Batch Counter (for fan-out / fan-in) --

export async function setBatchCounter(orgId: OrgId, findingId: string, count: number) {
  const db = await kv();
  await db.set(orgKey(orgId, "audit-batches-remaining", findingId), count);
}

export async function decrementBatchCounter(orgId: OrgId, findingId: string): Promise<number> {
  const db = await kv();
  const key = orgKey(orgId, "audit-batches-remaining", findingId);
  while (true) {
    const entry = await db.get<number>(key);
    const current = entry.value ?? 0;
    const next = current - 1;
    const res = await db.atomic()
      .check(entry)
      .set(key, next)
      .commit();
    if (res.ok) return next;
    // CAS failed, retry
  }
}

// -- Populated Questions (chunked) --

export async function savePopulatedQuestions(orgId: OrgId, findingId: string, questions: any[]) {
  const store = await chunked();
  await store.set(orgKey(orgId, "audit-populated-questions", findingId), questions);
}

export async function getPopulatedQuestions(orgId: OrgId, findingId: string): Promise<any[] | null> {
  const store = await chunked();
  return store.get<any[]>(orgKey(orgId, "audit-populated-questions", findingId));
}

// -- Batch Answers --

export async function saveBatchAnswers(orgId: OrgId, findingId: string, batchIndex: number, answers: any[]) {
  const store = await chunked();
  await store.set(orgKey(orgId, "audit-answers", findingId, batchIndex), answers);
}

export async function getAllBatchAnswers(orgId: OrgId, findingId: string, totalBatches: number) {
  const store = await chunked();
  const all: any[] = [];
  for (let i = 0; i < totalBatches; i++) {
    const batch = await store.get<any[]>(orgKey(orgId, "audit-answers", findingId, i));
    if (batch && Array.isArray(batch)) {
      all.push(...batch);
    }
  }
  return all;
}

/** Get recently completed findings, sorted newest-first (24h window, limit default 25). */
export async function getRecentCompleted(orgId: OrgId, limit = 25): Promise<Array<{ findingId: string; ts: number }>> {
  const db = await kv();
  const items: Array<{ findingId: string; ts: number }> = [];
  for await (const e of db.list<{ findingId: string; ts: number }>({ prefix: orgKey(orgId, "stats-completed") })) {
    if (e.value) items.push(e.value);
  }
  return items.sort((a, b) => b.ts - a.ts).slice(0, limit);
}

/** Scan all batch answer keys for a finding (no totalBatches needed). */
export async function getAllAnswersForFinding(orgId: OrgId, findingId: string) {
  const store = await chunked();
  // Scan batch indices 0..99 (more than enough)
  const all: any[] = [];
  for (let i = 0; i < 100; i++) {
    const batch = await store.get<any[]>(orgKey(orgId, "audit-answers", findingId, i));
    if (batch === null) break;
    if (Array.isArray(batch)) {
      all.push(...batch);
    }
  }
  return all;
}

// -- Pipeline Stats (24h TTL) --

const DAY_MS = 86_400_000;

/** Mark a finding as actively processing. */
export async function trackActive(orgId: OrgId, findingId: string, step: string) {
  const db = await kv();
  await db.set(orgKey(orgId, "stats-active", findingId), { step, ts: Date.now() });
}

/** Remove a finding from active tracking (finished or cleaned up). */
export async function trackCompleted(orgId: OrgId, findingId: string) {
  const db = await kv();
  await db.delete(orgKey(orgId, "stats-active", findingId));
  await db.set(orgKey(orgId, "stats-completed", `${Date.now()}-${findingId}`), { findingId, ts: Date.now() }, { expireIn: DAY_MS });
}

/** Log a step error event. */
export async function trackError(orgId: OrgId, findingId: string, step: string, error: string) {
  const db = await kv();
  await db.set(orgKey(orgId, "stats-error", `${Date.now()}-${findingId}`), { findingId, step, error, ts: Date.now() }, { expireIn: DAY_MS });
}

/** Log a retry event. */
export async function trackRetry(orgId: OrgId, findingId: string, step: string, attempt: number) {
  const db = await kv();
  await db.set(orgKey(orgId, "stats-retry", `${Date.now()}-${findingId}`), { findingId, step, attempt, ts: Date.now() }, { expireIn: DAY_MS });
}

/** Get pipeline stats. */
export async function getStats(orgId: OrgId) {
  const db = await kv();

  // Active (in pipe)
  const active: any[] = [];
  for await (const e of db.list({ prefix: orgKey(orgId, "stats-active") })) {
    active.push({ findingId: (e.key as any[])[2], ...(e.value as any) });
  }

  // Completed (24h) - collect timestamps for charting
  const completed: any[] = [];
  for await (const e of db.list({ prefix: orgKey(orgId, "stats-completed") })) {
    completed.push(e.value);
  }

  // Errors (24h)
  const errors: any[] = [];
  for await (const e of db.list({ prefix: orgKey(orgId, "stats-error") })) {
    errors.push(e.value);
  }

  // Retries (24h)
  const retries: any[] = [];
  for await (const e of db.list({ prefix: orgKey(orgId, "stats-retry") })) {
    retries.push(e.value);
  }

  return { active, completed, completedCount: completed.length, errors, retries };
}

// -- Transcript (chunked) --

export async function saveTranscript(orgId: OrgId, findingId: string, raw: string, diarized?: string) {
  const store = await chunked();
  await store.set(orgKey(orgId, "audit-transcript", findingId), { raw, diarized: diarized ?? raw });
}

export async function getTranscript(orgId: OrgId, findingId: string) {
  const store = await chunked();
  return store.get<{ raw: string; diarized: string }>(orgKey(orgId, "audit-transcript", findingId));
}

// -- Pipeline Config (admin-settable) --

export interface PipelineConfig {
  maxRetries: number;
  retryDelaySeconds: number;
}

const DEFAULT_PIPELINE_CONFIG: PipelineConfig = { maxRetries: 5, retryDelaySeconds: 10 };

export async function getPipelineConfig(orgId: OrgId): Promise<PipelineConfig> {
  const db = await kv();
  const entry = await db.get<PipelineConfig>(orgKey(orgId, "pipeline-config"));
  return entry.value ?? DEFAULT_PIPELINE_CONFIG;
}

export async function setPipelineConfig(orgId: OrgId, config: Partial<PipelineConfig>): Promise<PipelineConfig> {
  const db = await kv();
  const current = (await db.get<PipelineConfig>(orgKey(orgId, "pipeline-config"))).value ?? DEFAULT_PIPELINE_CONFIG;
  const merged = { ...current, ...config };
  await db.set(orgKey(orgId, "pipeline-config"), merged);
  return merged;
}

// -- Webhook Config --

export interface WebhookConfig {
  postUrl: string;
  postHeaders: Record<string, string>;
}

export type WebhookKind = "terminate" | "appeal" | "manager" | "judge";

export async function getWebhookConfig(orgId: OrgId, kind: WebhookKind): Promise<WebhookConfig | null> {
  const db = await kv();
  const entry = await db.get<WebhookConfig>(orgKey(orgId, "webhook-settings", kind));
  if (entry.value) return entry.value;

  // Legacy fallback: review settings used to live at ["review-settings"] or ["webhook-settings", "review"]
  if (kind === "terminate") {
    for (const legacyKey of [orgKey(orgId, "webhook-settings", "review"), ["review-settings"]] as Deno.KvKey[]) {
      const legacy = await db.get<WebhookConfig>(legacyKey);
      if (legacy.value) {
        await db.set(orgKey(orgId, "webhook-settings", "terminate"), legacy.value);
        return legacy.value;
      }
    }
  }

  return null;
}

export async function saveWebhookConfig(orgId: OrgId, kind: WebhookKind, config: WebhookConfig): Promise<void> {
  const db = await kv();
  await db.set(orgKey(orgId, "webhook-settings", kind), config);
}

export async function fireWebhook(orgId: OrgId, kind: WebhookKind, payload: unknown): Promise<void> {
  const config = await getWebhookConfig(orgId, kind);
  if (!config?.postUrl) return;

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
    console.log(`[WEBHOOK:${kind}] POST sent successfully`);
  } catch (err) {
    console.error(`[WEBHOOK:${kind}] POST failed:`, err);
  } finally {
    clearTimeout(timeoutId);
  }
}

// -- Email Report Config --

export type ReportSection = "pipeline" | "review" | "appeals" | "manager" | "tokens";
export type DetailLevel = "low" | "medium" | "high";

export interface SectionConfig {
  enabled: boolean;
  detail: DetailLevel;
}

export type ReportCadence = "daily" | "weekly" | "biweekly" | "monthly";

export interface EmailReportConfig {
  id: string;
  name: string;
  recipients: string[];
  cadence: ReportCadence;
  cadenceDay?: number; // 0-6 (Sun-Sat) for weekly/biweekly, 1-30 for monthly
  sections: Record<ReportSection, SectionConfig>;
  createdAt: number;
  updatedAt: number;
}

export async function listEmailReportConfigs(orgId: OrgId): Promise<EmailReportConfig[]> {
  const db = await kv();
  const configs: EmailReportConfig[] = [];
  for await (const entry of db.list<EmailReportConfig>({ prefix: orgKey(orgId, "email-report-config") })) {
    if (entry.value) configs.push(entry.value);
  }
  return configs;
}

export async function getEmailReportConfig(orgId: OrgId, id: string): Promise<EmailReportConfig | null> {
  const db = await kv();
  const entry = await db.get<EmailReportConfig>(orgKey(orgId, "email-report-config", id));
  return entry.value ?? null;
}

export async function saveEmailReportConfig(orgId: OrgId, config: Partial<EmailReportConfig> & { name: string; recipients: string[]; sections: Record<ReportSection, SectionConfig> }): Promise<EmailReportConfig> {
  const db = await kv();
  const now = Date.now();
  const full: EmailReportConfig = {
    id: config.id || crypto.randomUUID(),
    name: config.name,
    recipients: config.recipients,
    cadence: config.cadence || "weekly",
    cadenceDay: config.cadenceDay,
    sections: config.sections,
    createdAt: config.createdAt || now,
    updatedAt: now,
  };
  await db.set(orgKey(orgId, "email-report-config", full.id), full);
  return full;
}

export async function deleteEmailReportConfig(orgId: OrgId, id: string): Promise<void> {
  const db = await kv();
  await db.delete(orgKey(orgId, "email-report-config", id));
}

// -- Sound Pack Metadata (S3-backed) --

export type SoundSlot = "ping" | "double" | "triple" | "mega" | "ultra" | "rampage" | "godlike" | "levelup" | "shutdown";
export type SoundPackId = "synth" | "smite" | "opengameart" | "mixkit-punchy" | "mixkit-epic" | (string & {});

export interface SoundPackMeta {
  id: string;
  name: string;
  slots: Partial<Record<SoundSlot, string>>; // slot -> original filename
  createdAt: number;
  createdBy: string;
}

export async function listSoundPacks(orgId: OrgId): Promise<SoundPackMeta[]> {
  const db = await kv();
  const packs: SoundPackMeta[] = [];
  for await (const entry of db.list<SoundPackMeta>({ prefix: orgKey(orgId, "sound-pack") })) {
    if (entry.value) packs.push(entry.value);
  }
  return packs;
}

export async function getSoundPack(orgId: OrgId, packId: string): Promise<SoundPackMeta | null> {
  const db = await kv();
  const entry = await db.get<SoundPackMeta>(orgKey(orgId, "sound-pack", packId));
  return entry.value ?? null;
}

export async function saveSoundPack(orgId: OrgId, pack: SoundPackMeta): Promise<void> {
  const db = await kv();
  await db.set(orgKey(orgId, "sound-pack", pack.id), pack);
}

export async function deleteSoundPack(orgId: OrgId, packId: string): Promise<void> {
  const db = await kv();
  await db.delete(orgKey(orgId, "sound-pack", packId));
}

// -- Gamification Settings --

export interface GamificationSettings {
  threshold: number | null;       // seconds per question (0 = use flat timeout, null = inherit)
  comboTimeoutMs: number | null;  // flat timeout fallback in ms (null = inherit, default 10000)
  enabled: boolean | null;        // null = inherit, default true
  sounds: Partial<Record<SoundSlot, SoundPackId>> | null; // slot -> pack ID (null = inherit = synth)
}

const GAMIFICATION_DEFAULTS: Required<{ [K in keyof GamificationSettings]: NonNullable<GamificationSettings[K]> }> = {
  threshold: 0,
  comboTimeoutMs: 10000,
  enabled: true,
  sounds: {},
};

export async function getGamificationSettings(orgId: OrgId): Promise<GamificationSettings | null> {
  const db = await kv();
  const entry = await db.get<GamificationSettings>(orgKey(orgId, "gamification"));
  return entry.value ?? null;
}

export async function saveGamificationSettings(orgId: OrgId, settings: GamificationSettings): Promise<void> {
  const db = await kv();
  await db.set(orgKey(orgId, "gamification"), settings);
}

export async function getJudgeGamificationOverride(orgId: OrgId, judgeEmail: string): Promise<GamificationSettings | null> {
  const db = await kv();
  const entry = await db.get<GamificationSettings>(orgKey(orgId, "gamification", "judge", judgeEmail));
  return entry.value ?? null;
}

export async function saveJudgeGamificationOverride(orgId: OrgId, judgeEmail: string, settings: GamificationSettings): Promise<void> {
  const db = await kv();
  await db.set(orgKey(orgId, "gamification", "judge", judgeEmail), settings);
}

export async function getReviewerGamificationOverride(orgId: OrgId, email: string): Promise<GamificationSettings | null> {
  const db = await kv();
  const entry = await db.get<GamificationSettings>(orgKey(orgId, "gamification", "reviewer", email));
  return entry.value ?? null;
}

export async function saveReviewerGamificationOverride(orgId: OrgId, email: string, settings: GamificationSettings): Promise<void> {
  const db = await kv();
  await db.set(orgKey(orgId, "gamification", "reviewer", email), settings);
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

/**
 * Cascade merge: hardcoded defaults -> admin org -> judge (if reviewer) -> personal override.
 * `getUser` is imported by callers from auth/kv.ts to find the supervisor.
 */
export async function resolveGamificationSettings(
  orgId: OrgId,
  email: string,
  role: string,
  supervisor?: string | null,
): Promise<ResolvedGamificationSettings> {
  let merged: Record<string, unknown> = { ...GAMIFICATION_DEFAULTS };

  // Layer 1: admin org-level settings
  const orgSettings = await getGamificationSettings(orgId);
  merged = overlaySettings(merged, orgSettings);

  // Layer 2: judge override (only applies to reviewers under a judge)
  if (role === "reviewer" && supervisor) {
    const judgeOverride = await getJudgeGamificationOverride(orgId, supervisor);
    merged = overlaySettings(merged, judgeOverride);
  }

  // Layer 3: personal override
  const personalOverride = await getReviewerGamificationOverride(orgId, email);
  merged = overlaySettings(merged, personalOverride);

  return merged as unknown as ResolvedGamificationSettings;
}

// -- Custom Store Items --

import type { StoreItem } from "../shared/badges.ts";

export async function listCustomStoreItems(orgId: OrgId): Promise<StoreItem[]> {
  const db = await kv();
  const items: StoreItem[] = [];
  for await (const entry of db.list<StoreItem>({ prefix: orgKey(orgId, "store-item") })) {
    if (entry.value) items.push(entry.value);
  }
  return items;
}

export async function saveCustomStoreItem(orgId: OrgId, item: StoreItem): Promise<void> {
  const db = await kv();
  await db.set(orgKey(orgId, "store-item", item.id), item);
}

export async function deleteCustomStoreItem(orgId: OrgId, itemId: string): Promise<void> {
  const db = await kv();
  await db.delete(orgKey(orgId, "store-item", itemId));
}

// -- Badge + Game State --

import type { EarnedBadge, BadgeCheckState, GameState, BadgeDef } from "../shared/badges.ts";
import { DEFAULT_BADGE_STATS, DEFAULT_GAME_STATE, getLevel, LEVEL_THRESHOLDS, AGENT_LEVEL_THRESHOLDS } from "../shared/badges.ts";

/** Get all earned badges for a user. */
export async function getEarnedBadges(orgId: OrgId, email: string): Promise<EarnedBadge[]> {
  const db = await kv();
  const badges: EarnedBadge[] = [];
  const iter = db.list<EarnedBadge>({ prefix: orgKey(orgId, "badge", email) });
  for await (const entry of iter) {
    badges.push(entry.value);
  }
  return badges;
}

/** Award a badge atomically (no re-award). Returns true if newly awarded. */
export async function awardBadge(orgId: OrgId, email: string, badge: BadgeDef): Promise<boolean> {
  const db = await kv();
  const key = orgKey(orgId, "badge", email, badge.id);
  const existing = await db.get(key);
  if (existing.value) return false;

  const earned: EarnedBadge = { badgeId: badge.id, earnedAt: Date.now() };
  const res = await db.atomic()
    .check(existing)
    .set(key, earned)
    .commit();
  return res.ok;
}

/** Check if a user has a specific badge. */
export async function hasBadge(orgId: OrgId, email: string, badgeId: string): Promise<boolean> {
  const db = await kv();
  const entry = await db.get(orgKey(orgId, "badge", email, badgeId));
  return entry.value !== null;
}

/** Get running badge-check counters for a user. */
export async function getBadgeStats(orgId: OrgId, email: string): Promise<BadgeCheckState> {
  const db = await kv();
  const entry = await db.get<BadgeCheckState>(orgKey(orgId, "badge-stats", email));
  return entry.value ?? { ...DEFAULT_BADGE_STATS };
}

/** Patch badge-check counters. Merges with existing state. */
export async function updateBadgeStats(orgId: OrgId, email: string, patch: Partial<BadgeCheckState>): Promise<BadgeCheckState> {
  const db = await kv();
  const key = orgKey(orgId, "badge-stats", email);
  const entry = await db.get<BadgeCheckState>(key);
  const current = entry.value ?? { ...DEFAULT_BADGE_STATS };
  const updated = { ...current, ...patch };
  await db.set(key, updated);
  return updated;
}

/** Get unified game state for a user (any role). */
export async function getGameState(orgId: OrgId, email: string): Promise<GameState> {
  const db = await kv();
  const entry = await db.get<GameState>(orgKey(orgId, "game-state", email));
  return entry.value ?? { ...DEFAULT_GAME_STATE };
}

/** Save unified game state. */
export async function saveGameState(orgId: OrgId, email: string, state: GameState): Promise<void> {
  const db = await kv();
  await db.set(orgKey(orgId, "game-state", email), state);
}

/**
 * Award XP to a user. Updates totalXp, tokenBalance, level, and streak.
 * Returns the updated state and the XP gained.
 */
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

  // Update day streak
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

/** Purchase a store item. Deducts tokens, records purchase. */
export async function purchaseStoreItem(
  orgId: OrgId,
  email: string,
  itemId: string,
  price: number,
): Promise<{ ok: true; newBalance: number } | { ok: false; error: string }> {
  const db = await kv();
  const key = orgKey(orgId, "game-state", email);
  const entry = await db.get<GameState>(key);
  const state = entry.value ?? { ...DEFAULT_GAME_STATE };

  if (state.purchases.includes(itemId)) {
    return { ok: false, error: "already purchased" };
  }
  if (state.tokenBalance < price) {
    return { ok: false, error: "insufficient tokens" };
  }

  state.tokenBalance -= price;
  state.purchases.push(itemId);

  const res = await db.atomic()
    .check(entry)
    .set(key, state)
    .commit();

  if (!res.ok) return { ok: false, error: "concurrent modification, try again" };
  return { ok: true, newBalance: state.tokenBalance };
}

// -- SSE Events --

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

/** Emit an event for a specific user. Stored with 24h TTL. */
export async function emitEvent(
  orgId: OrgId,
  targetEmail: string,
  type: EventType,
  payload: Record<string, unknown>,
): Promise<void> {
  const db = await kv();
  const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const event: AppEvent = { id, type, payload, createdAt: Date.now() };
  await db.set(orgKey(orgId, "event", targetEmail, id), event, { expireIn: DAY_MS });
}

/** Get all pending events for a user (since a given timestamp). */
export async function getEvents(
  orgId: OrgId,
  email: string,
  since = 0,
): Promise<AppEvent[]> {
  const db = await kv();
  const events: AppEvent[] = [];
  for await (const entry of db.list<AppEvent>({ prefix: orgKey(orgId, "event", email) })) {
    if (entry.value && entry.value.createdAt > since) {
      events.push(entry.value);
    }
  }
  return events;
}

/** Delete consumed events for a user. */
export async function deleteEvents(orgId: OrgId, email: string, eventIds: string[]): Promise<void> {
  const db = await kv();
  for (const id of eventIds) {
    await db.delete(orgKey(orgId, "event", email, id));
  }
}

// -- Prefab Broadcast Events --

export interface BroadcastEvent {
  id: string;
  type: string;
  triggerEmail: string;
  displayName: string;
  message: string;
  animationId: string | null;
  ts: number;
}

/** Get prefab event subscriptions for an org. */
export async function getPrefabSubscriptions(orgId: OrgId): Promise<Record<string, boolean>> {
  const db = await kv();
  const entry = await db.get<Record<string, boolean>>(orgKey(orgId, "prefab-subs"));
  return entry.value ?? {};
}

/** Save prefab event subscriptions for an org. */
export async function savePrefabSubscriptions(orgId: OrgId, subs: Record<string, boolean>): Promise<void> {
  const db = await kv();
  await db.set(orgKey(orgId, "prefab-subs"), subs);
}

/** Emit a broadcast event visible to all users in an org. 24h TTL. */
export async function emitBroadcastEvent(
  orgId: OrgId,
  prefabType: string,
  triggerEmail: string,
  message: string,
  animationId: string | null,
): Promise<void> {
  const db = await kv();
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
  await db.set(orgKey(orgId, "broadcast", id), event, { expireIn: DAY_MS });
}

/** Get broadcast events for an org since a given timestamp. */
export async function getBroadcastEvents(orgId: OrgId, since = 0): Promise<BroadcastEvent[]> {
  const db = await kv();
  const events: BroadcastEvent[] = [];
  for await (const entry of db.list<BroadcastEvent>({ prefix: orgKey(orgId, "broadcast") })) {
    if (entry.value && entry.value.ts > since) {
      events.push(entry.value);
    }
  }
  return events;
}

/**
 * Check org subscriptions and emit a broadcast if the event type is enabled.
 * Reads the trigger user's animBindings to see if they have an animation configured.
 */
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

// -- Messaging --

export interface Message {
  id: string;
  from: string;
  to: string;
  body: string;
  ts: number;
  read: boolean;
}

/** Send a message from one user to another within an org. */
export async function sendMessage(
  orgId: OrgId,
  from: string,
  to: string,
  body: string,
): Promise<Message> {
  const db = await kv();
  const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const msg: Message = { id, from, to, body, ts: Date.now(), read: false };

  // Store in both participants' conversation views
  const convKey1 = orgKey(orgId, "message", from, to, id);
  const convKey2 = orgKey(orgId, "message", to, from, id);
  const unreadKey = orgKey(orgId, "unread-count", to);

  const unreadEntry = await db.get<number>(unreadKey);
  const currentUnread = unreadEntry.value ?? 0;

  await db.atomic()
    .set(convKey1, msg)
    .set(convKey2, msg)
    .set(unreadKey, currentUnread + 1)
    .commit();

  return msg;
}

/** Get conversation history between two users, newest first. */
export async function getConversation(
  orgId: OrgId,
  ownerEmail: string,
  otherEmail: string,
  limit = 50,
): Promise<Message[]> {
  const db = await kv();
  const messages: Message[] = [];
  for await (const entry of db.list<Message>(
    { prefix: orgKey(orgId, "message", ownerEmail, otherEmail) },
    { reverse: true, limit },
  )) {
    if (entry.value) messages.push(entry.value);
  }
  return messages;
}

/** Get unread count for a user. */
export async function getUnreadCount(orgId: OrgId, email: string): Promise<number> {
  const db = await kv();
  const entry = await db.get<number>(orgKey(orgId, "unread-count", email));
  return entry.value ?? 0;
}

/** Mark messages in a conversation as read and reset unread count. */
export async function markConversationRead(
  orgId: OrgId,
  ownerEmail: string,
  otherEmail: string,
): Promise<void> {
  const db = await kv();
  let readCount = 0;
  for await (const entry of db.list<Message>({ prefix: orgKey(orgId, "message", ownerEmail, otherEmail) })) {
    if (entry.value && !entry.value.read && entry.value.from !== ownerEmail) {
      const updated = { ...entry.value, read: true };
      await db.set(entry.key, updated);
      readCount++;
    }
  }
  if (readCount > 0) {
    const unreadKey = orgKey(orgId, "unread-count", ownerEmail);
    const unreadEntry = await db.get<number>(unreadKey);
    const current = unreadEntry.value ?? 0;
    await db.set(unreadKey, Math.max(0, current - readCount));
  }
}

/** Get list of recent conversations for a user (unique conversation partners). */
export async function getConversationList(
  orgId: OrgId,
  email: string,
): Promise<Array<{ email: string; lastMessage: Message; unread: number }>> {
  const db = await kv();
  const convMap = new Map<string, { lastMessage: Message; unread: number }>();

  for await (const entry of db.list<Message>({ prefix: orgKey(orgId, "message", email) })) {
    if (!entry.value) continue;
    const otherEmail = entry.value.from === email ? entry.value.to : entry.value.from;
    const existing = convMap.get(otherEmail);
    if (!existing || entry.value.ts > existing.lastMessage.ts) {
      const unread = existing?.unread ?? 0;
      convMap.set(otherEmail, {
        lastMessage: entry.value,
        unread: unread + (!entry.value.read && entry.value.from !== email ? 1 : 0),
      });
    } else if (!entry.value.read && entry.value.from !== email) {
      existing.unread++;
    }
  }

  return Array.from(convMap.entries())
    .map(([email, data]) => ({ email, ...data }))
    .sort((a, b) => b.lastMessage.ts - a.lastMessage.ts);
}

// -- Helpers --

async function hashString(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}
