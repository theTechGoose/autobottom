/** Deno KV state management for audit findings, jobs, and counters. */

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

async function chunked(): Promise<ChunkedKv> {
  return new ChunkedKv(await kv());
}

// -- Finding CRUD --

export async function getFinding(id: string) {
  const store = await chunked();
  return store.get<Record<string, any>>(["audit-finding", id]);
}

export async function saveFinding(finding: Record<string, any>) {
  const store = await chunked();
  await store.set(["audit-finding", finding.id], finding);
}

// -- Job CRUD --

export async function getJob(id: string) {
  const db = await kv();
  const entry = await db.get(["audit-job", id]);
  return entry.value as Record<string, any> | null;
}

export async function saveJob(job: Record<string, any>) {
  const db = await kv();
  await db.set(["audit-job", job.id], job);
}

// -- Question Cache (10 min TTL) --

export async function getCachedAnswer(auditId: string, questionText: string) {
  const db = await kv();
  const hash = await hashString(questionText);
  const entry = await db.get(["question-cache", auditId, hash]);
  return entry.value as { answer: string; thinking: string; defense: string } | null;
}

export async function cacheAnswer(
  auditId: string,
  questionText: string,
  answer: { answer: string; thinking: string; defense: string },
) {
  const db = await kv();
  const hash = await hashString(questionText);
  await db.set(["question-cache", auditId, hash], answer, { expireIn: 600_000 });
}

// -- Question Destination Cache (10 min TTL) --

export async function getCachedQuestions(destinationId: string) {
  const store = await chunked();
  return store.get<any[]>(["destination-questions", destinationId]);
}

export async function cacheQuestions(destinationId: string, questions: any[]) {
  const store = await chunked();
  await store.set(["destination-questions", destinationId], questions, { expireIn: 600_000 });
}

// -- Batch Counter (for fan-out / fan-in) --

export async function setBatchCounter(findingId: string, count: number) {
  const db = await kv();
  await db.set(["audit-batches-remaining", findingId], count);
}

export async function decrementBatchCounter(findingId: string): Promise<number> {
  const db = await kv();
  while (true) {
    const entry = await db.get<number>(["audit-batches-remaining", findingId]);
    const current = entry.value ?? 0;
    const next = current - 1;
    const res = await db.atomic()
      .check(entry)
      .set(["audit-batches-remaining", findingId], next)
      .commit();
    if (res.ok) return next;
    // CAS failed, retry
  }
}

// -- Populated Questions (chunked) --

export async function savePopulatedQuestions(findingId: string, questions: any[]) {
  const store = await chunked();
  await store.set(["audit-populated-questions", findingId], questions);
}

export async function getPopulatedQuestions(findingId: string): Promise<any[] | null> {
  const store = await chunked();
  return store.get<any[]>(["audit-populated-questions", findingId]);
}

// -- Batch Answers --

export async function saveBatchAnswers(findingId: string, batchIndex: number, answers: any[]) {
  const store = await chunked();
  await store.set(["audit-answers", findingId, batchIndex], answers);
}

export async function getAllBatchAnswers(findingId: string, totalBatches: number) {
  const store = await chunked();
  const all: any[] = [];
  for (let i = 0; i < totalBatches; i++) {
    const batch = await store.get<any[]>(["audit-answers", findingId, i]);
    if (batch && Array.isArray(batch)) {
      all.push(...batch);
    }
  }
  return all;
}

/** Scan all batch answer keys for a finding (no totalBatches needed). */
export async function getAllAnswersForFinding(findingId: string) {
  const store = await chunked();
  // Scan batch indices 0..99 (more than enough)
  const all: any[] = [];
  for (let i = 0; i < 100; i++) {
    const batch = await store.get<any[]>(["audit-answers", findingId, i]);
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
export async function trackActive(findingId: string, step: string) {
  const db = await kv();
  await db.set(["stats-active", findingId], { step, ts: Date.now() });
}

/** Remove a finding from active tracking (finished or cleaned up). */
export async function trackCompleted(findingId: string) {
  const db = await kv();
  await db.delete(["stats-active", findingId]);
  await db.set(["stats-completed", `${Date.now()}-${findingId}`], { findingId, ts: Date.now() }, { expireIn: DAY_MS });
}

/** Log a step error event. */
export async function trackError(findingId: string, step: string, error: string) {
  const db = await kv();
  await db.set(["stats-error", `${Date.now()}-${findingId}`], { findingId, step, error, ts: Date.now() }, { expireIn: DAY_MS });
}

/** Log a retry event. */
export async function trackRetry(findingId: string, step: string, attempt: number) {
  const db = await kv();
  await db.set(["stats-retry", `${Date.now()}-${findingId}`], { findingId, step, attempt, ts: Date.now() }, { expireIn: DAY_MS });
}

/** Get pipeline stats. */
export async function getStats() {
  const db = await kv();

  // Active (in pipe)
  const active: any[] = [];
  for await (const e of db.list({ prefix: ["stats-active"] })) {
    active.push({ findingId: (e.key as any[])[1], ...(e.value as any) });
  }

  // Completed (24h) - collect timestamps for charting
  const completed: any[] = [];
  for await (const e of db.list({ prefix: ["stats-completed"] })) {
    completed.push(e.value);
  }

  // Errors (24h)
  const errors: any[] = [];
  for await (const e of db.list({ prefix: ["stats-error"] })) {
    errors.push(e.value);
  }

  // Retries (24h)
  const retries: any[] = [];
  for await (const e of db.list({ prefix: ["stats-retry"] })) {
    retries.push(e.value);
  }

  return { active, completed, completedCount: completed.length, errors, retries };
}

// -- Transcript (chunked) --

export async function saveTranscript(findingId: string, raw: string, diarized?: string) {
  const store = await chunked();
  await store.set(["audit-transcript", findingId], { raw, diarized: diarized ?? raw });
}

export async function getTranscript(findingId: string) {
  const store = await chunked();
  return store.get<{ raw: string; diarized: string }>(["audit-transcript", findingId]);
}

// -- Pipeline Config (admin-settable) --

export interface PipelineConfig {
  maxRetries: number;
  retryDelaySeconds: number;
}

const DEFAULT_PIPELINE_CONFIG: PipelineConfig = { maxRetries: 5, retryDelaySeconds: 10 };

export async function getPipelineConfig(): Promise<PipelineConfig> {
  const db = await kv();
  const entry = await db.get<PipelineConfig>(["pipeline-config"]);
  return entry.value ?? DEFAULT_PIPELINE_CONFIG;
}

export async function setPipelineConfig(config: Partial<PipelineConfig>): Promise<PipelineConfig> {
  const db = await kv();
  const current = (await db.get<PipelineConfig>(["pipeline-config"])).value ?? DEFAULT_PIPELINE_CONFIG;
  const merged = { ...current, ...config };
  await db.set(["pipeline-config"], merged);
  return merged;
}

// -- Webhook Config --

export interface WebhookConfig {
  postUrl: string;
  postHeaders: Record<string, string>;
}

export type WebhookKind = "terminate" | "appeal" | "manager" | "judge";

export async function getWebhookConfig(kind: WebhookKind): Promise<WebhookConfig | null> {
  const db = await kv();
  const entry = await db.get<WebhookConfig>(["webhook-settings", kind]);
  if (entry.value) return entry.value;

  // Legacy fallback: review settings used to live at ["review-settings"] or ["webhook-settings", "review"]
  if (kind === "terminate") {
    for (const legacyKey of [["webhook-settings", "review"], ["review-settings"]] as Deno.KvKey[]) {
      const legacy = await db.get<WebhookConfig>(legacyKey);
      if (legacy.value) {
        await db.set(["webhook-settings", "terminate"], legacy.value);
        return legacy.value;
      }
    }
  }

  return null;
}

export async function saveWebhookConfig(kind: WebhookKind, config: WebhookConfig): Promise<void> {
  const db = await kv();
  await db.set(["webhook-settings", kind], config);
}

export async function fireWebhook(kind: WebhookKind, payload: unknown): Promise<void> {
  const config = await getWebhookConfig(kind);
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

export interface EmailReportConfig {
  id: string;
  name: string;
  recipients: string[];
  sections: Record<ReportSection, SectionConfig>;
  createdAt: number;
  updatedAt: number;
}

export async function listEmailReportConfigs(): Promise<EmailReportConfig[]> {
  const db = await kv();
  const configs: EmailReportConfig[] = [];
  for await (const entry of db.list<EmailReportConfig>({ prefix: ["email-report-config"] })) {
    if (entry.value) configs.push(entry.value);
  }
  return configs;
}

export async function getEmailReportConfig(id: string): Promise<EmailReportConfig | null> {
  const db = await kv();
  const entry = await db.get<EmailReportConfig>(["email-report-config", id]);
  return entry.value ?? null;
}

export async function saveEmailReportConfig(config: Partial<EmailReportConfig> & { name: string; recipients: string[]; sections: Record<ReportSection, SectionConfig> }): Promise<EmailReportConfig> {
  const db = await kv();
  const now = Date.now();
  const full: EmailReportConfig = {
    id: config.id || crypto.randomUUID(),
    name: config.name,
    recipients: config.recipients,
    sections: config.sections,
    createdAt: config.createdAt || now,
    updatedAt: now,
  };
  await db.set(["email-report-config", full.id], full);
  return full;
}

export async function deleteEmailReportConfig(id: string): Promise<void> {
  const db = await kv();
  await db.delete(["email-report-config", id]);
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
