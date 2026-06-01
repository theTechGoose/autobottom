/** QStash queue adapter for audit pipeline step orchestration. Ported from lib/queue.ts. */
import { AsyncLocalStorage } from "node:async_hooks";
import { withSpan, metric } from "@core/data/datadog-otel/mod.ts";
import { getStored, setStored } from "@core/data/firestore/mod.ts";

// Storage type for operator-set parallelism overrides. Keyed by queue name
// at the GLOBAL org so a single operator config applies regardless of which
// org context the boot path runs under.
const PARALLELISM_CONFIG_TYPE = "queue-parallelism-config";
const PARALLELISM_CONFIG_ORG = "" as const;

interface ParallelismConfig {
  queueName: string;
  parallelism: number;
  updatedAt: number;
}

const TRANSCRIBE_QUEUE = "audit-transcribe";
const QUESTIONS_QUEUE = "audit-questions";
const CLEANUP_QUEUE = "audit-cleanup";

export const ALL_QUEUES = [TRANSCRIBE_QUEUE, QUESTIONS_QUEUE, CLEANUP_QUEUE] as const;

const STEP_QUEUE: Record<string, string> = {
  "init": TRANSCRIBE_QUEUE,
  "transcribe": TRANSCRIBE_QUEUE,
  "poll-transcript": TRANSCRIBE_QUEUE,
  "transcribe-complete": TRANSCRIBE_QUEUE,
  "prepare": TRANSCRIBE_QUEUE,
  "ask-all": QUESTIONS_QUEUE,
  "finalize": CLEANUP_QUEUE,
  "diarize-async": CLEANUP_QUEUE,
  "pinecone-async": CLEANUP_QUEUE,
  "bad-word-check": CLEANUP_QUEUE,
};

/** Request-scoped origin store. When an HTTP request is in flight on a branch
 *  preview deployment, we capture `new URL(req.url).origin` here so QStash
 *  callbacks go back to THIS deployment, not wherever SELF_URL env points.
 *
 *  Why: Deno Deploy branch previews have auto-generated hostnames
 *  (autobottom-<hash>.thetechgoose.deno.net). Env vars are shared across
 *  deployments, so SELF_URL in .env is always the main prod URL. Without this,
 *  QStash delivers step callbacks to main prod instead of the preview. */
const requestOriginStore = new AsyncLocalStorage<string>();

/** Cache of the first NON-localhost origin we've seen in this process. When the
 *  frontend SSR makes an internal fetch to http://localhost:3000, the inner
 *  runWithOrigin sets ALS to localhost — but QStash can't call back to a
 *  loopback address. This cache lets selfUrl() recover the external hostname
 *  that the original browser request came in on. */
let knownPublicOrigin: string | null = null;

function isLocalhostOrigin(origin: string): boolean {
  return origin.startsWith("http://localhost") ||
         origin.startsWith("http://127.") ||
         origin.startsWith("http://[::1]") ||
         origin.startsWith("http://0.0.0.0");
}

/** Wrap an async request handler so that selfUrl() reads back the request's origin. */
export function runWithOrigin<T>(origin: string, fn: () => Promise<T>): Promise<T> {
  // Remember the first external origin so subsequent localhost (internal)
  // requests can still produce valid QStash callback URLs.
  if (!isLocalhostOrigin(origin)) knownPublicOrigin = origin;
  return requestOriginStore.run(origin, fn);
}

function selfUrl(): string {
  // 1. Prefer the current inbound request's origin if it's publicly reachable.
  const scoped = requestOriginStore.getStore();
  if (scoped && !isLocalhostOrigin(scoped)) return scoped;
  // 2. Fall back to the most recent external origin observed in this process
  //    — handles internal Fresh→backend localhost fetches.
  if (knownPublicOrigin) return knownPublicOrigin;
  // 3. SELF_URL env — the stable callback host for non-request contexts
  //    (cron jobs, any call-site that runs before any HTTP request). On prod
  //    this is https://autobottom.thetechgoose.deno.net.
  //
  //    NOTE: we deliberately do NOT construct a host from DENO_DEPLOYMENT_ID
  //    here. That id is a 64-char build hash that does NOT map to a routable
  //    `autobottom-<id>.thetechgoose.deno.net` hostname (preview hosts use a
  //    short slug), so the constructed URL fails DNS ("no such host") and
  //    broke the watchdog cron's re-publish in production. The legitimate
  //    branch-preview case is covered by the AsyncLocalStorage origin (step 1)
  //    on real HTTP requests; Deno Deploy crons run on production only.
  const envUrl = Deno.env.get("SELF_URL");
  if (envUrl) return envUrl;
  // 4. Last resort — only reachable when QStash is disabled (local dev).
  return scoped ?? "http://localhost:3000";
}

/** Expose the current effective self-URL for debug endpoints. Always returns a
 *  string — AsyncLocalStorage origin when inside a request, env var otherwise. */
export function getSelfUrl(): string { return selfUrl(); }

/** Debug helper: dump every candidate source selfUrl() considers, so operators
 *  can see exactly why the callback URL is what it is. `deploymentId` is
 *  informational only — it no longer drives selfUrl() (see the note in selfUrl
 *  about why DENO_DEPLOYMENT_ID can't build a routable host). */
export function getSelfUrlSources(): {
  scopedOrigin: string | null;
  scopedIsLocalhost: boolean;
  knownPublicOrigin: string | null;
  deploymentId: string | null;
  envSelfUrl: string | null;
  effective: string;
} {
  const scoped = requestOriginStore.getStore() ?? null;
  return {
    scopedOrigin: scoped,
    scopedIsLocalhost: scoped ? isLocalhostOrigin(scoped) : false,
    knownPublicOrigin,
    deploymentId: Deno.env.get("DENO_DEPLOYMENT_ID") ?? null,
    envSelfUrl: Deno.env.get("SELF_URL") ?? null,
    effective: selfUrl(),
  };
}
function qstashUrl(): string { return Deno.env.get("QSTASH_URL") ?? "https://qstash.upstash.io"; }
function qstashToken(): string { return Deno.env.get("QSTASH_TOKEN") ?? ""; }
function isLocalMode(): boolean { return Deno.env.get("LOCAL_QUEUE") === "true"; }
function qstashAuth(): Record<string, string> { return { Authorization: `Bearer ${qstashToken()}` }; }

async function localEnqueue(targetUrl: string, body: unknown, delaySeconds?: number): Promise<string> {
  const delay = delaySeconds ? delaySeconds * 1000 : 0;
  setTimeout(async () => {
    try {
      const res = await fetch(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) console.error(`[LOCAL-QUEUE] ${targetUrl} failed: ${res.status} ${await res.text()}`);
    } catch (err) {
      console.error(`[LOCAL-QUEUE] ${targetUrl} error:`, err);
    }
  }, delay);
  return `local-${Date.now()}`;
}

async function enqueue(queueName: string, targetUrl: string, body: unknown, delaySeconds?: number, extraHeaders?: Record<string, string>): Promise<string> {
  if (isLocalMode()) return localEnqueue(targetUrl, body, delaySeconds);

  const headers: Record<string, string> = {
    ...qstashAuth(),
    "Content-Type": "application/json",
    "Upstash-Retries": "0",
    ...extraHeaders,
  };

  let endpoint: string;
  if (delaySeconds) {
    headers["Upstash-Delay"] = `${delaySeconds}s`;
    headers["Upstash-Retries"] = "3";
    endpoint = `${qstashUrl()}/v2/publish/${targetUrl}`;
  } else {
    endpoint = `${qstashUrl()}/v2/enqueue/${queueName}/${targetUrl}`;
  }

  const res = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`QStash enqueue failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.messageId;
}

export function enqueueStep(step: string, body: unknown, delaySeconds?: number): Promise<string> {
  return withSpan("qstash.enqueueStep", async (span) => {
    span.setAttribute("qstash.step", step);
    const queueName = STEP_QUEUE[step] ?? QUESTIONS_QUEUE;
    const url = `${selfUrl()}/audit/step/${step}`;
    const findingId = (body as { findingId?: string })?.findingId ?? "<none>";
    console.log(`📮 [QSTASH] enqueueStep step=${step} finding=${findingId} callback=${url}`);
    const extraHeaders = step === "ask-all" ? { "Upstash-Timeout": "120s" } : undefined;
    const result = await enqueue(queueName, url, body, delaySeconds, extraHeaders);
    metric("autobottom.qstash.enqueue", 1, { step });
    return result;
  }, {}, "client");
}

export async function publishStep(step: string, body: unknown): Promise<string> {
  return withSpan("qstash.publishStep", async (span) => {
    span.setAttribute("qstash.step", step);
    const url = `${selfUrl()}/audit/step/${step}`;
    if (isLocalMode()) return localEnqueue(url, body);
    const timeout: Record<string, string> = step === "ask-all" ? { "Upstash-Timeout": "900s" } : {};
    const res = await fetch(`${qstashUrl()}/v2/publish/${url}`, {
      method: "POST",
      headers: { ...qstashAuth(), "Content-Type": "application/json", "Upstash-Retries": "0", ...timeout },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`QStash publish failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    metric("autobottom.qstash.publish", 1, { step });
    return data.messageId;
  }, {}, "client");
}

/** Publish JSON to an arbitrary URL via QStash with optional delay. Used by
 *  long-running multi-tick jobs (e.g. audit-counts deep scan) that need to
 *  self-schedule a follow-up tick without bolting onto the pipeline-step
 *  machinery. URL must be absolute. */
export async function publishUrl(url: string, body: unknown, delaySeconds?: number): Promise<string> {
  return withSpan("qstash.publishUrl", async (span) => {
    span.setAttribute("qstash.url", url);
    if (isLocalMode()) return localEnqueue(url, body, delaySeconds);
    const headers: Record<string, string> = {
      ...qstashAuth(),
      "Content-Type": "application/json",
      "Upstash-Retries": "0",
    };
    if (delaySeconds) headers["Upstash-Delay"] = `${delaySeconds}s`;
    const res = await fetch(`${qstashUrl()}/v2/publish/${url}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`QStash publishUrl failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    metric("autobottom.qstash.publish_url", 1);
    return data.messageId;
  }, {}, "client");
}

export function enqueueCleanup(body: unknown, delaySeconds: number): Promise<string> {
  return withSpan("qstash.enqueueCleanup", async () => {
    const url = `${selfUrl()}/audit/step/cleanup`;
    const result = await enqueue(CLEANUP_QUEUE, url, body, delaySeconds);
    metric("autobottom.qstash.enqueue_cleanup", 1);
    return result;
  }, {}, "client");
}

export async function pauseAllQueues(): Promise<void> {
  return withSpan("qstash.pauseAllQueues", async () => {
    if (isLocalMode()) return;
    await Promise.all(ALL_QUEUES.map(async (q) => {
      const res = await fetch(`${qstashUrl()}/v2/queues/${q}/pause`, { method: "POST", headers: qstashAuth() });
      if (!res.ok) console.error(`[QSTASH] pause ${q} failed: ${res.status} ${await res.text()}`);
    }));
    metric("autobottom.qstash.pause", 1);
  }, {}, "client");
}

export async function resumeAllQueues(): Promise<void> {
  return withSpan("qstash.resumeAllQueues", async () => {
    if (isLocalMode()) return;
    await Promise.all(ALL_QUEUES.map(async (q) => {
      const res = await fetch(`${qstashUrl()}/v2/queues/${q}/resume`, { method: "POST", headers: qstashAuth() });
      if (!res.ok) console.error(`[QSTASH] resume ${q} failed: ${res.status} ${await res.text()}`);
    }));
    metric("autobottom.qstash.resume", 1);
  }, {}, "client");
}

/** Purge every queued message from each audit queue.
 *
 *  The previous implementation walked GET /v2/messages?queueName=X and
 *  deleted each by id, but that endpoint doesn't surface messages still
 *  sitting in the queue waiting to be delivered (only ones with delivery
 *  attempts already recorded). Result: a queue with lag=200 returned
 *  "purged 0 messages" and the backlog stayed.
 *
 *  Reliable approach: DELETE the queue (which discards every queued
 *  message) and recreate it with the same parallelism + paused state.
 *  We read the current state first so the recreate doesn't unpause a
 *  queue an operator just paused or reset parallelism. */
export async function purgeAllQueues(): Promise<number> {
  return withSpan("qstash.purgeAllQueues", async (span) => {
    if (isLocalMode()) return 0;
    let total = 0;
    await Promise.all(ALL_QUEUES.map(async (q) => {
      // Snapshot current settings so we can recreate the queue identically.
      let parallelism = 1;
      let paused = false;
      let lag = 0;
      try {
        const cur = await fetch(`${qstashUrl()}/v2/queues/${q}`, { headers: qstashAuth() });
        if (cur.ok) {
          const data = await cur.json();
          parallelism = typeof data.parallelism === "number" ? data.parallelism : 1;
          paused = !!data.paused;
          lag = typeof data.lag === "number" ? data.lag : 0;
        }
      } catch (err) {
        console.warn(`[QSTASH] purge ${q}: read state failed:`, err);
      }

      // Delete the queue. This force-discards every message still queued
      // for delivery — including those a paused queue is holding.
      try {
        const del = await fetch(`${qstashUrl()}/v2/queues/${q}`, { method: "DELETE", headers: qstashAuth() });
        if (!del.ok) {
          const text = await del.text().catch(() => "");
          console.error(`[QSTASH] purge ${q}: delete failed: ${del.status} ${text.slice(0, 200)}`);
          return;
        }
      } catch (err) {
        console.error(`[QSTASH] purge ${q}: delete threw:`, err);
        return;
      }

      // Recreate with the same parallelism + paused so the operator's
      // earlier configuration is preserved across the purge.
      try {
        const re = await fetch(`${qstashUrl()}/v2/queues`, {
          method: "POST",
          headers: { ...qstashAuth(), "content-type": "application/json" },
          body: JSON.stringify({ queueName: q, parallelism: Math.max(1, Math.floor(parallelism)), paused }),
        });
        if (!re.ok) {
          const text = await re.text().catch(() => "");
          console.error(`[QSTASH] purge ${q}: recreate failed: ${re.status} ${text.slice(0, 200)}`);
          return;
        }
      } catch (err) {
        console.error(`[QSTASH] purge ${q}: recreate threw:`, err);
        return;
      }

      console.log(`💣 [QSTASH] purged ${q}: discarded ${lag} queued messages, recreated parallelism=${parallelism} paused=${paused}`);
      total += lag;
    }));
    span.setAttribute("qstash.purged_count", total);
    metric("autobottom.qstash.purge", 1);
    return total;
  }, {}, "client");
}

/** Push parallelism settings to QStash so the queue itself enforces the
 *  in-flight cap — without this, "parallelism=20" in our admin UI is purely
 *  cosmetic and QStash defaults (typically 1) apply, causing massive
 *  backlogs when n8n bulk-fires hundreds of audits.
 *
 *  ⚠️  POST /v2/queues is an UPSERT. If we send {queueName, parallelism}
 *  alone, QStash resets every other property — most importantly `paused`
 *  flips back to false, which silently un-pauses a queue an operator just
 *  paused for safety. We therefore GET the current queue first, copy its
 *  `paused` state into the upsert body, and re-send it alongside the new
 *  parallelism. (We've eaten this exact bug in production: saving the
 *  Pipeline Settings modal while queues were paused un-paused them and
 *  caused a flood. Do not remove the paused-preservation step.) */
export async function setQstashQueueParallelism(queueName: string, parallelism: number): Promise<{ ok: boolean; error?: string }> {
  return withSpan("qstash.setQueueParallelism", async (span) => {
    if (isLocalMode()) return { ok: true };
    span.setAttribute("qstash.queue", queueName);
    span.setAttribute("qstash.parallelism", parallelism);

    // Read current paused state so we can preserve it through the upsert.
    // If the GET fails (queue may not exist yet on a fresh deploy), default
    // to NOT paused — same behavior as the original create.
    let currentPaused = false;
    try {
      const cur = await fetch(`${qstashUrl()}/v2/queues/${queueName}`, { headers: qstashAuth() });
      if (cur.ok) {
        const data = await cur.json();
        currentPaused = !!data.paused;
      }
    } catch { /* fall through with currentPaused=false */ }

    const body = {
      queueName,
      parallelism: Math.max(1, Math.floor(parallelism)),
      paused: currentPaused,
    };

    const res = await fetch(`${qstashUrl()}/v2/queues`, {
      method: "POST",
      headers: { ...qstashAuth(), "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[QSTASH] set parallelism ${queueName}=${parallelism} failed: ${res.status} ${text.slice(0, 200)}`);
      return { ok: false, error: `${res.status}: ${text.slice(0, 200)}` };
    }
    console.log(`✅ [QSTASH] queue ${queueName} parallelism=${parallelism} paused=${currentPaused}`);
    metric("autobottom.qstash.set_parallelism", 1, { queue: queueName });

    // Persist the operator's choice so it survives the next boot. Without
    // this, applyDefaultQueueParallelism would clobber the operator's
    // emergency throttle on every redeploy. Best-effort — failure to
    // persist doesn't block the QStash push that already succeeded.
    try {
      const cfg: ParallelismConfig = { queueName, parallelism: Math.max(1, Math.floor(parallelism)), updatedAt: Date.now() };
      await setStored(PARALLELISM_CONFIG_TYPE, PARALLELISM_CONFIG_ORG, [queueName], cfg);
    } catch (err) {
      console.warn(`[QSTASH] persist parallelism for ${queueName} failed (non-fatal):`, err);
    }

    return { ok: true };
  }, {}, "client");
}

const DEFAULT_PARALLELISM: Record<string, number> = {
  [TRANSCRIBE_QUEUE]: 8,
  [QUESTIONS_QUEUE]: 4,
  [CLEANUP_QUEUE]: 8,
};

/** Apply parallelism to all three audit queues on boot. Operator overrides
 *  set via /admin/set-queue-parallelism are persisted to Firestore and read
 *  here FIRST — only fall back to hardcoded defaults if no operator value
 *  exists. Without this, every redeploy wiped the operator's emergency
 *  throttle (we hit this at 09:01 today: operator dropped transcribe to 3,
 *  next boot reset it to 8 → next bulk fire melted Firestore again).
 *
 *  transcribe/cleanup are I/O-heavy → can run higher concurrency by default;
 *  questions is LLM-heavy and rate-limit-sensitive → kept lower. */
export interface ApplyDefaultsResult {
  queueName: string;
  parallelism: number;
  source: "default" | "persisted";
  ok: boolean;
  error?: string;
}

export async function applyDefaultQueueParallelism(): Promise<ApplyDefaultsResult[]> {
  if (isLocalMode()) return ALL_QUEUES.map((q) => ({ queueName: q, parallelism: DEFAULT_PARALLELISM[q], source: "default", ok: true }));
  const results: ApplyDefaultsResult[] = [];
  for (const q of ALL_QUEUES) {
    let parallelism = DEFAULT_PARALLELISM[q];
    let source: "default" | "persisted" = "default";
    try {
      const persisted = await getStored<ParallelismConfig>(PARALLELISM_CONFIG_TYPE, PARALLELISM_CONFIG_ORG, q);
      if (persisted && Number.isFinite(persisted.parallelism) && persisted.parallelism >= 1) {
        parallelism = persisted.parallelism;
        source = "persisted";
      }
    } catch (err) {
      console.warn(`[QSTASH] read persisted parallelism for ${q} failed, using default:`, err);
    }
    console.log(`🔧 [QSTASH] boot apply ${q} parallelism=${parallelism} (${source})`);
    try {
      await setQstashQueueParallelism(q, parallelism);
      results.push({ queueName: q, parallelism, source, ok: true });
    } catch (err) {
      results.push({ queueName: q, parallelism, source, ok: false, error: (err as Error).message ?? String(err) });
    }
  }
  return results;
}

/** Read QStash's actual queue settings — the source of truth for whether
 *  our parallelism push actually landed. Useful for verifying after deploys. */
export async function getQueueInfo(): Promise<Array<{ queueName: string; parallelism?: number; messageCount?: number; paused?: boolean; raw?: unknown }>> {
  return withSpan("qstash.getQueueInfo", async () => {
    if (isLocalMode()) return ALL_QUEUES.map((q) => ({ queueName: q, parallelism: 0, messageCount: 0, paused: false }));
    const out = await Promise.all(ALL_QUEUES.map(async (q) => {
      try {
        const res = await fetch(`${qstashUrl()}/v2/queues/${q}`, { headers: qstashAuth() });
        if (!res.ok) return { queueName: q, error: `${res.status}` };
        const data = await res.json();
        return {
          queueName: q,
          parallelism: data.parallelism,
          messageCount: data.messageCount,
          paused: data.paused,
          raw: data,
        };
      } catch (err) {
        return { queueName: q, error: err instanceof Error ? err.message : String(err) };
      }
    }));
    return out;
  }, {}, "client");
}

export async function getQueueCounts(): Promise<Record<string, number>> {
  return withSpan("qstash.getQueueCounts", async () => {
    if (isLocalMode()) return Object.fromEntries(ALL_QUEUES.map((q) => [q, 0]));
    const pairs = await Promise.all(ALL_QUEUES.map(async (q) => {
      const res = await fetch(`${qstashUrl()}/v2/queues/${q}`, { headers: qstashAuth() });
      const data = res.ok ? await res.json() : {};
      // QStash exposes queued-message count as `lag` on /v2/queues/{name}.
      // We previously read `messageCount` which doesn't exist on this
      // endpoint, so the dashboard's "In Pipeline" stat was always 0
      // even with hundreds of messages queued. Fall back to messageCount
      // for compatibility in case the API surface ever changes back.
      return [q, data.lag ?? data.messageCount ?? 0] as [string, number];
    }));
    metric("autobottom.qstash.get_counts", 1);
    return Object.fromEntries(pairs);
  }, {}, "client");
}
