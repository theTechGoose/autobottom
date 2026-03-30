/** Deno KV state management for audit findings, jobs, and counters. All keys are org-scoped. */

import type { StoreItem } from "../../business/gamification-badges/mod.ts";
import type { EarnedBadge, BadgeCheckState, GameState, BadgeDef } from "../../business/gamification-badges/mod.ts";
import { DEFAULT_BADGE_STATS, DEFAULT_GAME_STATE, getLevel, LEVEL_THRESHOLDS, AGENT_LEVEL_THRESHOLDS } from "../../business/gamification-badges/mod.ts";

// -- Public types re-exported from org.ts --

export type OrgId = string;

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
    const ops = this.#db.atomic();
    for (let i = 0; i < n; i++) {
      ops.set([...prefix, i], raw.slice(i * CHUNK_LIMIT, (i + 1) * CHUNK_LIMIT), options ?? {});
    }
    ops.set([...prefix, "_n"], n, options ?? {});
    await ops.commit();
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
    const ops = this.#db.atomic();
    for (let i = 0; i < meta.value; i++) {
      ops.delete([...prefix, i]);
    }
    ops.delete([...prefix, "_n"]);
    await ops.commit();
  }
}

// -- Pipeline Config types --

export interface PipelineConfig {
  maxRetries: number;
  retryDelaySeconds: number;
}

// -- Webhook Config types --

export interface WebhookConfig {
  postUrl: string;
  postHeaders: Record<string, string>;
}

export type WebhookKind = "terminate" | "appeal" | "manager" | "judge";

// -- Email Report Config types --

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

// -- Sound Pack types --

export type SoundSlot = "ping" | "double" | "triple" | "mega" | "ultra" | "rampage" | "godlike" | "levelup" | "shutdown";
export type SoundPackId = "synth" | "smite" | "opengameart" | "mixkit-punchy" | "mixkit-epic" | (string & {});

export interface SoundPackMeta {
  id: string;
  name: string;
  slots: Partial<Record<SoundSlot, string>>; // slot -> original filename
  createdAt: number;
  createdBy: string;
}

// -- Gamification Settings types --

export interface GamificationSettings {
  threshold: number | null;       // seconds per question (0 = use flat timeout, null = inherit)
  comboTimeoutMs: number | null;  // flat timeout fallback in ms (null = inherit, default 10000)
  enabled: boolean | null;        // null = inherit, default true
  sounds: Partial<Record<SoundSlot, SoundPackId>> | null; // slot -> pack ID (null = inherit = synth)
}

export interface ResolvedGamificationSettings {
  threshold: number;
  comboTimeoutMs: number;
  enabled: boolean;
  sounds: Partial<Record<SoundSlot, SoundPackId>>;
}

// -- SSE Event types --

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

// -- Broadcast Event types --

export interface BroadcastEvent {
  id: string;
  type: string;
  triggerEmail: string;
  displayName: string;
  message: string;
  animationId: string | null;
  ts: number;
}

// -- Messaging types --

export interface Message {
  id: string;
  from: string;
  to: string;
  body: string;
  ts: number;
  read: boolean;
}

// -- Constants --

const DEFAULT_PIPELINE_CONFIG: PipelineConfig = { maxRetries: 5, retryDelaySeconds: 10 };
const DAY_MS = 86_400_000;

const GAMIFICATION_DEFAULTS: Required<{ [K in keyof GamificationSettings]: NonNullable<GamificationSettings[K]> }> = {
  threshold: 0,
  comboTimeoutMs: 10000,
  enabled: true,
  sounds: {},
};

// -- Helpers --

async function hashString(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
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

// =============================================================================
// Kv Class
// =============================================================================

export class Kv {
  static #instance: Kv | undefined;
  #db: Deno.Kv;
  #chunked: ChunkedKv;

  constructor(db: Deno.Kv) {
    this.#db = db;
    this.#chunked = new ChunkedKv(db);
  }

  // -- Static methods (factory + org) --

  static async getInstance(): Promise<Kv> {
    if (!Kv.#instance) {
      const path = Deno.env.get("DENO_KV_PATH");
      Kv.#instance = new Kv(await Deno.openKv(path));
    }
    return Kv.#instance;
  }

  static setInstance(kv: Kv): void {
    Kv.#instance = kv;
  }

  static resetInstance(): void {
    Kv.#instance = undefined;
  }

  static orgKey(orgId: string, ...parts: Deno.KvKeyPart[]): Deno.KvKey {
    return [orgId, ...parts];
  }

  get db(): Deno.Kv {
    return this.#db;
  }

  // -- Finding CRUD --

  async getFinding(orgId: OrgId, id: string) {
    return this.#chunked.get<Record<string, any>>(Kv.orgKey(orgId, "audit-finding", id));
  }

  async saveFinding(orgId: OrgId, finding: Record<string, any>) {
    await this.#chunked.set(Kv.orgKey(orgId, "audit-finding", finding.id), finding);
  }

  // -- Job CRUD --

  async getJob(orgId: OrgId, id: string) {
    const entry = await this.#db.get(Kv.orgKey(orgId, "audit-job", id));
    return entry.value as Record<string, any> | null;
  }

  async saveJob(orgId: OrgId, job: Record<string, any>) {
    await this.#db.set(Kv.orgKey(orgId, "audit-job", job.id), job);
  }

  // -- Question Cache (10 min TTL) --

  async getCachedAnswer(orgId: OrgId, auditId: string, questionText: string) {
    const hash = await hashString(questionText);
    const entry = await this.#db.get(Kv.orgKey(orgId, "question-cache", auditId, hash));
    return entry.value as { answer: string; thinking: string; defense: string } | null;
  }

  async cacheAnswer(
    orgId: OrgId,
    auditId: string,
    questionText: string,
    answer: { answer: string; thinking: string; defense: string },
  ) {
    const hash = await hashString(questionText);
    await this.#db.set(Kv.orgKey(orgId, "question-cache", auditId, hash), answer, { expireIn: 600_000 });
  }

  // -- Question Destination Cache (10 min TTL) --

  async getCachedQuestions(orgId: OrgId, destinationId: string) {
    return this.#chunked.get<any[]>(Kv.orgKey(orgId, "destination-questions", destinationId));
  }

  async cacheQuestions(orgId: OrgId, destinationId: string, questions: any[]) {
    await this.#chunked.set(Kv.orgKey(orgId, "destination-questions", destinationId), questions, { expireIn: 600_000 });
  }

  // -- Batch Counter (for fan-out / fan-in) --

  async setBatchCounter(orgId: OrgId, findingId: string, count: number) {
    await this.#db.set(Kv.orgKey(orgId, "audit-batches-remaining", findingId), count);
  }

  async decrementBatchCounter(orgId: OrgId, findingId: string): Promise<number> {
    const key = Kv.orgKey(orgId, "audit-batches-remaining", findingId);
    while (true) {
      const entry = await this.#db.get<number>(key);
      const current = entry.value ?? 0;
      const next = current - 1;
      const res = await this.#db.atomic()
        .check(entry)
        .set(key, next)
        .commit();
      if (res.ok) return next;
      // CAS failed, retry
    }
  }

  // -- Populated Questions (chunked) --

  async savePopulatedQuestions(orgId: OrgId, findingId: string, questions: any[]) {
    await this.#chunked.set(Kv.orgKey(orgId, "audit-populated-questions", findingId), questions);
  }

  async getPopulatedQuestions(orgId: OrgId, findingId: string): Promise<any[] | null> {
    return this.#chunked.get<any[]>(Kv.orgKey(orgId, "audit-populated-questions", findingId));
  }

  // -- Batch Answers --

  async saveBatchAnswers(orgId: OrgId, findingId: string, batchIndex: number, answers: any[]) {
    await this.#chunked.set(Kv.orgKey(orgId, "audit-answers", findingId, batchIndex), answers);
  }

  async getAllBatchAnswers(orgId: OrgId, findingId: string, totalBatches: number) {
    const all: any[] = [];
    for (let i = 0; i < totalBatches; i++) {
      const batch = await this.#chunked.get<any[]>(Kv.orgKey(orgId, "audit-answers", findingId, i));
      if (batch && Array.isArray(batch)) {
        all.push(...batch);
      }
    }
    return all;
  }

  /** Scan all batch answer keys for a finding (no totalBatches needed). */
  async getAllAnswersForFinding(orgId: OrgId, findingId: string) {
    const all: any[] = [];
    for (let i = 0; i < 100; i++) {
      const batch = await this.#chunked.get<any[]>(Kv.orgKey(orgId, "audit-answers", findingId, i));
      if (batch === null) break;
      if (Array.isArray(batch)) {
        all.push(...batch);
      }
    }
    return all;
  }

  // -- Pipeline Stats (24h TTL) --

  /** Mark a finding as actively processing. */
  async trackActive(orgId: OrgId, findingId: string, step: string) {
    await this.#db.set(Kv.orgKey(orgId, "stats-active", findingId), { step, ts: Date.now() });
  }

  /** Remove a finding from active tracking (finished or cleaned up). */
  async trackCompleted(orgId: OrgId, findingId: string) {
    await this.#db.delete(Kv.orgKey(orgId, "stats-active", findingId));
    await this.#db.set(Kv.orgKey(orgId, "stats-completed", `${Date.now()}-${findingId}`), { findingId, ts: Date.now() }, { expireIn: DAY_MS });
  }

  /** Log a step error event. */
  async trackError(orgId: OrgId, findingId: string, step: string, error: string) {
    await this.#db.set(Kv.orgKey(orgId, "stats-error", `${Date.now()}-${findingId}`), { findingId, step, error, ts: Date.now() }, { expireIn: DAY_MS });
  }

  /** Log a retry event. */
  async trackRetry(orgId: OrgId, findingId: string, step: string, attempt: number) {
    await this.#db.set(Kv.orgKey(orgId, "stats-retry", `${Date.now()}-${findingId}`), { findingId, step, attempt, ts: Date.now() }, { expireIn: DAY_MS });
  }

  /** Get pipeline stats. */
  async getStats(orgId: OrgId) {
    const active: any[] = [];
    for await (const e of this.#db.list({ prefix: Kv.orgKey(orgId, "stats-active") })) {
      active.push({ findingId: (e.key as any[])[2], ...(e.value as any) });
    }

    const completed: any[] = [];
    for await (const e of this.#db.list({ prefix: Kv.orgKey(orgId, "stats-completed") })) {
      completed.push(e.value);
    }

    const errors: any[] = [];
    for await (const e of this.#db.list({ prefix: Kv.orgKey(orgId, "stats-error") })) {
      errors.push(e.value);
    }

    const retries: any[] = [];
    for await (const e of this.#db.list({ prefix: Kv.orgKey(orgId, "stats-retry") })) {
      retries.push(e.value);
    }

    return { active, completed, completedCount: completed.length, errors, retries };
  }

  // -- Transcript (chunked) --

  async saveTranscript(orgId: OrgId, findingId: string, raw: string, diarized?: string) {
    await this.#chunked.set(Kv.orgKey(orgId, "audit-transcript", findingId), { raw, diarized: diarized ?? raw });
  }

  async getTranscript(orgId: OrgId, findingId: string) {
    return this.#chunked.get<{ raw: string; diarized: string }>(Kv.orgKey(orgId, "audit-transcript", findingId));
  }

  // -- Pipeline Config (admin-settable) --

  async getPipelineConfig(orgId: OrgId): Promise<PipelineConfig> {
    const entry = await this.#db.get<PipelineConfig>(Kv.orgKey(orgId, "pipeline-config"));
    return entry.value ?? DEFAULT_PIPELINE_CONFIG;
  }

  async setPipelineConfig(orgId: OrgId, config: Partial<PipelineConfig>): Promise<PipelineConfig> {
    const current = (await this.#db.get<PipelineConfig>(Kv.orgKey(orgId, "pipeline-config"))).value ?? DEFAULT_PIPELINE_CONFIG;
    const merged = { ...current, ...config };
    await this.#db.set(Kv.orgKey(orgId, "pipeline-config"), merged);
    return merged;
  }

  // -- Webhook Config --

  async getWebhookConfig(orgId: OrgId, kind: WebhookKind): Promise<WebhookConfig | null> {
    const entry = await this.#db.get<WebhookConfig>(Kv.orgKey(orgId, "webhook-settings", kind));
    if (entry.value) return entry.value;

    // Legacy fallback: review settings used to live at ["review-settings"] or ["webhook-settings", "review"]
    if (kind === "terminate") {
      for (const legacyKey of [Kv.orgKey(orgId, "webhook-settings", "review"), ["review-settings"]] as Deno.KvKey[]) {
        const legacy = await this.#db.get<WebhookConfig>(legacyKey);
        if (legacy.value) {
          await this.#db.set(Kv.orgKey(orgId, "webhook-settings", "terminate"), legacy.value);
          return legacy.value;
        }
      }
    }

    return null;
  }

  async saveWebhookConfig(orgId: OrgId, kind: WebhookKind, config: WebhookConfig): Promise<void> {
    await this.#db.set(Kv.orgKey(orgId, "webhook-settings", kind), config);
  }

  async fireWebhook(orgId: OrgId, kind: WebhookKind, payload: unknown): Promise<void> {
    const config = await this.getWebhookConfig(orgId, kind);
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

  async listEmailReportConfigs(orgId: OrgId): Promise<EmailReportConfig[]> {
    const configs: EmailReportConfig[] = [];
    for await (const entry of this.#db.list<EmailReportConfig>({ prefix: Kv.orgKey(orgId, "email-report-config") })) {
      if (entry.value) configs.push(entry.value);
    }
    return configs;
  }

  async getEmailReportConfig(orgId: OrgId, id: string): Promise<EmailReportConfig | null> {
    const entry = await this.#db.get<EmailReportConfig>(Kv.orgKey(orgId, "email-report-config", id));
    return entry.value ?? null;
  }

  async saveEmailReportConfig(orgId: OrgId, config: Partial<EmailReportConfig> & { name: string; recipients: string[]; sections: Record<ReportSection, SectionConfig> }): Promise<EmailReportConfig> {
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
    await this.#db.set(Kv.orgKey(orgId, "email-report-config", full.id), full);
    return full;
  }

  async deleteEmailReportConfig(orgId: OrgId, id: string): Promise<void> {
    await this.#db.delete(Kv.orgKey(orgId, "email-report-config", id));
  }

  // -- Sound Pack Metadata (S3-backed) --

  async listSoundPacks(orgId: OrgId): Promise<SoundPackMeta[]> {
    const packs: SoundPackMeta[] = [];
    for await (const entry of this.#db.list<SoundPackMeta>({ prefix: Kv.orgKey(orgId, "sound-pack") })) {
      if (entry.value) packs.push(entry.value);
    }
    return packs;
  }

  async getSoundPack(orgId: OrgId, packId: string): Promise<SoundPackMeta | null> {
    const entry = await this.#db.get<SoundPackMeta>(Kv.orgKey(orgId, "sound-pack", packId));
    return entry.value ?? null;
  }

  async saveSoundPack(orgId: OrgId, pack: SoundPackMeta): Promise<void> {
    await this.#db.set(Kv.orgKey(orgId, "sound-pack", pack.id), pack);
  }

  async deleteSoundPack(orgId: OrgId, packId: string): Promise<void> {
    await this.#db.delete(Kv.orgKey(orgId, "sound-pack", packId));
  }

  // -- Gamification Settings --

  async getGamificationSettings(orgId: OrgId): Promise<GamificationSettings | null> {
    const entry = await this.#db.get<GamificationSettings>(Kv.orgKey(orgId, "gamification"));
    return entry.value ?? null;
  }

  async saveGamificationSettings(orgId: OrgId, settings: GamificationSettings): Promise<void> {
    await this.#db.set(Kv.orgKey(orgId, "gamification"), settings);
  }

  async getJudgeGamificationOverride(orgId: OrgId, judgeEmail: string): Promise<GamificationSettings | null> {
    const entry = await this.#db.get<GamificationSettings>(Kv.orgKey(orgId, "gamification", "judge", judgeEmail));
    return entry.value ?? null;
  }

  async saveJudgeGamificationOverride(orgId: OrgId, judgeEmail: string, settings: GamificationSettings): Promise<void> {
    await this.#db.set(Kv.orgKey(orgId, "gamification", "judge", judgeEmail), settings);
  }

  async getReviewerGamificationOverride(orgId: OrgId, email: string): Promise<GamificationSettings | null> {
    const entry = await this.#db.get<GamificationSettings>(Kv.orgKey(orgId, "gamification", "reviewer", email));
    return entry.value ?? null;
  }

  async saveReviewerGamificationOverride(orgId: OrgId, email: string, settings: GamificationSettings): Promise<void> {
    await this.#db.set(Kv.orgKey(orgId, "gamification", "reviewer", email), settings);
  }

  async resolveGamificationSettings(
    orgId: OrgId,
    email: string,
    role: string,
    supervisor?: string | null,
  ): Promise<ResolvedGamificationSettings> {
    let merged: Record<string, unknown> = { ...GAMIFICATION_DEFAULTS };

    // Layer 1: admin org-level settings
    const orgSettings = await this.getGamificationSettings(orgId);
    merged = overlaySettings(merged, orgSettings);

    // Layer 2: judge override (only applies to reviewers under a judge)
    if (role === "reviewer" && supervisor) {
      const judgeOverride = await this.getJudgeGamificationOverride(orgId, supervisor);
      merged = overlaySettings(merged, judgeOverride);
    }

    // Layer 3: personal override
    const personalOverride = await this.getReviewerGamificationOverride(orgId, email);
    merged = overlaySettings(merged, personalOverride);

    return merged as unknown as ResolvedGamificationSettings;
  }

  // -- Custom Store Items --

  async listCustomStoreItems(orgId: OrgId): Promise<StoreItem[]> {
    const items: StoreItem[] = [];
    for await (const entry of this.#db.list<StoreItem>({ prefix: Kv.orgKey(orgId, "store-item") })) {
      if (entry.value) items.push(entry.value);
    }
    return items;
  }

  async saveCustomStoreItem(orgId: OrgId, item: StoreItem): Promise<void> {
    await this.#db.set(Kv.orgKey(orgId, "store-item", item.id), item);
  }

  async deleteCustomStoreItem(orgId: OrgId, itemId: string): Promise<void> {
    await this.#db.delete(Kv.orgKey(orgId, "store-item", itemId));
  }

  // -- Badge + Game State --

  /** Get all earned badges for a user. */
  async getEarnedBadges(orgId: OrgId, email: string): Promise<EarnedBadge[]> {
    const badges: EarnedBadge[] = [];
    const iter = this.#db.list<EarnedBadge>({ prefix: Kv.orgKey(orgId, "badge", email) });
    for await (const entry of iter) {
      badges.push(entry.value);
    }
    return badges;
  }

  /** Award a badge atomically (no re-award). Returns true if newly awarded. */
  async awardBadge(orgId: OrgId, email: string, badge: BadgeDef): Promise<boolean> {
    const key = Kv.orgKey(orgId, "badge", email, badge.id);
    const existing = await this.#db.get(key);
    if (existing.value) return false;

    const earned: EarnedBadge = { badgeId: badge.id, earnedAt: Date.now() };
    const res = await this.#db.atomic()
      .check(existing)
      .set(key, earned)
      .commit();
    return res.ok;
  }

  /** Check if a user has a specific badge. */
  async hasBadge(orgId: OrgId, email: string, badgeId: string): Promise<boolean> {
    const entry = await this.#db.get(Kv.orgKey(orgId, "badge", email, badgeId));
    return entry.value !== null;
  }

  /** Get running badge-check counters for a user. */
  async getBadgeStats(orgId: OrgId, email: string): Promise<BadgeCheckState> {
    const entry = await this.#db.get<BadgeCheckState>(Kv.orgKey(orgId, "badge-stats", email));
    return entry.value ?? { ...DEFAULT_BADGE_STATS };
  }

  /** Patch badge-check counters. Merges with existing state. */
  async updateBadgeStats(orgId: OrgId, email: string, patch: Partial<BadgeCheckState>): Promise<BadgeCheckState> {
    const key = Kv.orgKey(orgId, "badge-stats", email);
    const entry = await this.#db.get<BadgeCheckState>(key);
    const current = entry.value ?? { ...DEFAULT_BADGE_STATS };
    const updated = { ...current, ...patch };
    await this.#db.set(key, updated);
    return updated;
  }

  /** Get unified game state for a user (any role). */
  async getGameState(orgId: OrgId, email: string): Promise<GameState> {
    const entry = await this.#db.get<GameState>(Kv.orgKey(orgId, "game-state", email));
    return entry.value ?? { ...DEFAULT_GAME_STATE };
  }

  /** Save unified game state. */
  async saveGameState(orgId: OrgId, email: string, state: GameState): Promise<void> {
    await this.#db.set(Kv.orgKey(orgId, "game-state", email), state);
  }

  /**
   * Award XP to a user. Updates totalXp, tokenBalance, level, and streak.
   * Returns the updated state and the XP gained.
   */
  async awardXp(
    orgId: OrgId,
    email: string,
    xpAmount: number,
    role: "reviewer" | "judge" | "manager" | "agent",
  ): Promise<{ state: GameState; xpGained: number; leveledUp: boolean }> {
    const state = await this.getGameState(orgId, email);
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

    await this.saveGameState(orgId, email, state);

    const leveledUp = state.level > prevLevel;
    if (leveledUp) {
      this.checkAndEmitPrefab(orgId, "level_up", email, `${email.split("@")[0]} reached level ${state.level}!`)
        .catch(() => {});
    }

    return { state, xpGained: xpAmount, leveledUp };
  }

  /** Purchase a store item. Deducts tokens, records purchase. */
  async purchaseStoreItem(
    orgId: OrgId,
    email: string,
    itemId: string,
    price: number,
  ): Promise<{ ok: true; newBalance: number } | { ok: false; error: string }> {
    const key = Kv.orgKey(orgId, "game-state", email);
    const entry = await this.#db.get<GameState>(key);
    const state = entry.value ?? { ...DEFAULT_GAME_STATE };

    if (state.purchases.includes(itemId)) {
      return { ok: false, error: "already purchased" };
    }
    if (state.tokenBalance < price) {
      return { ok: false, error: "insufficient tokens" };
    }

    state.tokenBalance -= price;
    state.purchases.push(itemId);

    const res = await this.#db.atomic()
      .check(entry)
      .set(key, state)
      .commit();

    if (!res.ok) return { ok: false, error: "concurrent modification, try again" };
    return { ok: true, newBalance: state.tokenBalance };
  }

  // -- SSE Events --

  /** Emit an event for a specific user. Stored with 24h TTL. */
  async emitEvent(
    orgId: OrgId,
    targetEmail: string,
    type: EventType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const event: AppEvent = { id, type, payload, createdAt: Date.now() };
    await this.#db.set(Kv.orgKey(orgId, "event", targetEmail, id), event, { expireIn: DAY_MS });
  }

  /** Get all pending events for a user (since a given timestamp). */
  async getEvents(
    orgId: OrgId,
    email: string,
    since = 0,
  ): Promise<AppEvent[]> {
    const events: AppEvent[] = [];
    for await (const entry of this.#db.list<AppEvent>({ prefix: Kv.orgKey(orgId, "event", email) })) {
      if (entry.value && entry.value.createdAt > since) {
        events.push(entry.value);
      }
    }
    return events;
  }

  /** Delete consumed events for a user. */
  async deleteEvents(orgId: OrgId, email: string, eventIds: string[]): Promise<void> {
    for (const id of eventIds) {
      await this.#db.delete(Kv.orgKey(orgId, "event", email, id));
    }
  }

  // -- Prefab Broadcast Events --

  /** Get prefab event subscriptions for an org. */
  async getPrefabSubscriptions(orgId: OrgId): Promise<Record<string, boolean>> {
    const entry = await this.#db.get<Record<string, boolean>>(Kv.orgKey(orgId, "prefab-subs"));
    return entry.value ?? {};
  }

  /** Save prefab event subscriptions for an org. */
  async savePrefabSubscriptions(orgId: OrgId, subs: Record<string, boolean>): Promise<void> {
    await this.#db.set(Kv.orgKey(orgId, "prefab-subs"), subs);
  }

  /** Emit a broadcast event visible to all users in an org. 24h TTL. */
  async emitBroadcastEvent(
    orgId: OrgId,
    prefabType: string,
    triggerEmail: string,
    message: string,
    animationId: string | null,
  ): Promise<void> {
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
    await this.#db.set(Kv.orgKey(orgId, "broadcast", id), event, { expireIn: DAY_MS });
  }

  /** Get broadcast events for an org since a given timestamp. */
  async getBroadcastEvents(orgId: OrgId, since = 0): Promise<BroadcastEvent[]> {
    const events: BroadcastEvent[] = [];
    for await (const entry of this.#db.list<BroadcastEvent>({ prefix: Kv.orgKey(orgId, "broadcast") })) {
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
  async checkAndEmitPrefab(
    orgId: OrgId,
    prefabType: string,
    email: string,
    message: string,
  ): Promise<void> {
    const subs = await this.getPrefabSubscriptions(orgId);
    if (!subs[prefabType]) return;

    const gs = await this.getGameState(orgId, email);
    const animationId = gs.animBindings?.[prefabType] ?? null;

    await this.emitBroadcastEvent(orgId, prefabType, email, message, animationId);
  }

  // -- Messaging --

  /** Send a message from one user to another within an org. */
  async sendMessage(
    orgId: OrgId,
    from: string,
    to: string,
    body: string,
  ): Promise<Message> {
    const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const msg: Message = { id, from, to, body, ts: Date.now(), read: false };

    // Store in both participants' conversation views
    const convKey1 = Kv.orgKey(orgId, "message", from, to, id);
    const convKey2 = Kv.orgKey(orgId, "message", to, from, id);
    const unreadKey = Kv.orgKey(orgId, "unread-count", to);

    const unreadEntry = await this.#db.get<number>(unreadKey);
    const currentUnread = unreadEntry.value ?? 0;

    await this.#db.atomic()
      .set(convKey1, msg)
      .set(convKey2, msg)
      .set(unreadKey, currentUnread + 1)
      .commit();

    return msg;
  }

  /** Get conversation history between two users, newest first. */
  async getConversation(
    orgId: OrgId,
    ownerEmail: string,
    otherEmail: string,
    limit = 50,
  ): Promise<Message[]> {
    const messages: Message[] = [];
    for await (const entry of this.#db.list<Message>(
      { prefix: Kv.orgKey(orgId, "message", ownerEmail, otherEmail) },
      { reverse: true, limit },
    )) {
      if (entry.value) messages.push(entry.value);
    }
    return messages;
  }

  /** Get unread count for a user. */
  async getUnreadCount(orgId: OrgId, email: string): Promise<number> {
    const entry = await this.#db.get<number>(Kv.orgKey(orgId, "unread-count", email));
    return entry.value ?? 0;
  }

  /** Mark messages in a conversation as read and reset unread count. */
  async markConversationRead(
    orgId: OrgId,
    ownerEmail: string,
    otherEmail: string,
  ): Promise<void> {
    let readCount = 0;
    for await (const entry of this.#db.list<Message>({ prefix: Kv.orgKey(orgId, "message", ownerEmail, otherEmail) })) {
      if (entry.value && !entry.value.read && entry.value.from !== ownerEmail) {
        const updated = { ...entry.value, read: true };
        await this.#db.set(entry.key, updated);
        readCount++;
      }
    }
    if (readCount > 0) {
      const unreadKey = Kv.orgKey(orgId, "unread-count", ownerEmail);
      const unreadEntry = await this.#db.get<number>(unreadKey);
      const current = unreadEntry.value ?? 0;
      await this.#db.set(unreadKey, Math.max(0, current - readCount));
    }
  }

  /** Get list of recent conversations for a user (unique conversation partners). */
  async getConversationList(
    orgId: OrgId,
    email: string,
  ): Promise<Array<{ email: string; lastMessage: Message; unread: number }>> {
    const convMap = new Map<string, { lastMessage: Message; unread: number }>();

    for await (const entry of this.#db.list<Message>({ prefix: Kv.orgKey(orgId, "message", email) })) {
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
}

// =============================================================================
// Free-function wrappers (delegate to Kv singleton)
// =============================================================================

async function kv() { return Kv.getInstance(); }

export async function getFinding(orgId: OrgId, id: string) {
  return (await kv()).getFinding(orgId, id);
}
export async function saveFinding(orgId: OrgId, finding: Record<string, any>) {
  return (await kv()).saveFinding(orgId, finding);
}
export async function getJob(orgId: OrgId, id: string) {
  return (await kv()).getJob(orgId, id);
}
export async function saveJob(orgId: OrgId, job: Record<string, any>) {
  return (await kv()).saveJob(orgId, job);
}
export async function getCachedAnswer(orgId: OrgId, auditId: string, questionText: string) {
  return (await kv()).getCachedAnswer(orgId, auditId, questionText);
}
export async function cacheAnswer(orgId: OrgId, auditId: string, questionText: string, answer: { answer: string; thinking: string; defense: string }) {
  return (await kv()).cacheAnswer(orgId, auditId, questionText, answer);
}
export async function getCachedQuestions(orgId: OrgId, destinationId: string) {
  return (await kv()).getCachedQuestions(orgId, destinationId);
}
export async function cacheQuestions(orgId: OrgId, destinationId: string, questions: any[]) {
  return (await kv()).cacheQuestions(orgId, destinationId, questions);
}
export async function setBatchCounter(orgId: OrgId, findingId: string, count: number) {
  return (await kv()).setBatchCounter(orgId, findingId, count);
}
export async function decrementBatchCounter(orgId: OrgId, findingId: string) {
  return (await kv()).decrementBatchCounter(orgId, findingId);
}
export async function savePopulatedQuestions(orgId: OrgId, findingId: string, questions: any[]) {
  return (await kv()).savePopulatedQuestions(orgId, findingId, questions);
}
export async function getPopulatedQuestions(orgId: OrgId, findingId: string) {
  return (await kv()).getPopulatedQuestions(orgId, findingId);
}
export async function saveBatchAnswers(orgId: OrgId, findingId: string, batchIndex: number, answers: any[]) {
  return (await kv()).saveBatchAnswers(orgId, findingId, batchIndex, answers);
}
export async function getAllBatchAnswers(orgId: OrgId, findingId: string, totalBatches: number) {
  return (await kv()).getAllBatchAnswers(orgId, findingId, totalBatches);
}
export async function getAllAnswersForFinding(orgId: OrgId, findingId: string) {
  return (await kv()).getAllAnswersForFinding(orgId, findingId);
}
export async function trackActive(orgId: OrgId, findingId: string, step: string) {
  return (await kv()).trackActive(orgId, findingId, step);
}
export async function trackCompleted(orgId: OrgId, findingId: string) {
  return (await kv()).trackCompleted(orgId, findingId);
}
export async function saveTranscript(orgId: OrgId, findingId: string, raw: string, diarized?: string) {
  return (await kv()).saveTranscript(orgId, findingId, raw, diarized);
}
export async function getTranscript(orgId: OrgId, findingId: string) {
  return (await kv()).getTranscript(orgId, findingId);
}
export async function fireWebhook(orgId: OrgId, kind: WebhookKind, payload: unknown) {
  return (await kv()).fireWebhook(orgId, kind, payload);
}
export async function getBadgeStats(orgId: OrgId, email: string) {
  return (await kv()).getBadgeStats(orgId, email);
}
export async function updateBadgeStats(orgId: OrgId, email: string, patch: Partial<BadgeCheckState>) {
  return (await kv()).updateBadgeStats(orgId, email, patch);
}
export async function getEarnedBadges(orgId: OrgId, email: string) {
  return (await kv()).getEarnedBadges(orgId, email);
}
export async function awardBadge(orgId: OrgId, email: string, badge: BadgeDef) {
  return (await kv()).awardBadge(orgId, email, badge);
}
export async function awardXp(orgId: OrgId, email: string, xpAmount: number, role: "reviewer" | "judge" | "manager" | "agent") {
  return (await kv()).awardXp(orgId, email, xpAmount, role);
}
export async function emitEvent(orgId: OrgId, targetEmail: string, type: EventType, payload: Record<string, unknown>) {
  return (await kv()).emitEvent(orgId, targetEmail, type, payload);
}
export async function checkAndEmitPrefab(orgId: OrgId, prefabType: string, email: string, message: string) {
  return (await kv()).checkAndEmitPrefab(orgId, prefabType, email, message);
}
