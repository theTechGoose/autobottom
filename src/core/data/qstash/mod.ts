/** QStash queue adapter for audit pipeline step orchestration. Ported from lib/queue.ts. */
import { AsyncLocalStorage } from "node:async_hooks";
import { withSpan, metric } from "@core/data/datadog-otel/mod.ts";

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
  "ask-batch": QUESTIONS_QUEUE,
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
  // 3. Construct this deployment's public URL from Deno Deploy's build hash.
  //    Handles cron jobs and any call-site that runs before any HTTP request.
  const deploymentId = Deno.env.get("DENO_DEPLOYMENT_ID");
  if (deploymentId) return `https://autobottom-${deploymentId}.thetechgoose.deno.net`;
  // 4. Env fallback (for local dev or non-Deploy hosts).
  const envUrl = Deno.env.get("SELF_URL");
  if (envUrl) return envUrl;
  // 5. Last resort — only reachable when QStash is disabled (local dev).
  return scoped ?? "http://localhost:3000";
}

/** Expose the current effective self-URL for debug endpoints. Always returns a
 *  string — AsyncLocalStorage origin when inside a request, env var otherwise. */
export function getSelfUrl(): string { return selfUrl(); }

/** Debug helper: dump every candidate source selfUrl() considers, so operators
 *  can see exactly why the callback URL is what it is. */
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

export async function purgeAllQueues(): Promise<number> {
  return withSpan("qstash.purgeAllQueues", async (span) => {
    if (isLocalMode()) return 0;
    let total = 0;
    await Promise.all(ALL_QUEUES.map(async (q) => {
      let cursor: string | undefined;
      do {
        const url = new URL(`${qstashUrl()}/v2/messages`);
        url.searchParams.set("queueName", q);
        if (cursor) url.searchParams.set("cursor", cursor);
        const res = await fetch(url.toString(), { headers: qstashAuth() });
        if (!res.ok) { console.error(`[QSTASH] list ${q} failed: ${res.status}`); return; }
        const { messages = [], cursor: next } = await res.json();
        cursor = next;
        await Promise.all((messages as { messageId: string }[]).map(async (m) => {
          const del = await fetch(`${qstashUrl()}/v2/messages/${m.messageId}`, { method: "DELETE", headers: qstashAuth() });
          if (del.ok) total++;
        }));
      } while (cursor);
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
    return { ok: true };
  }, {}, "client");
}

/** Apply default parallelism to all three audit queues. Called on boot so
 *  fresh deployments + new QStash queues land at sensible values without
 *  manual configuration. transcribe/cleanup are I/O-heavy → can run higher
 *  concurrency; questions is LLM-heavy and rate-limit-sensitive → kept lower. */
export async function applyDefaultQueueParallelism(): Promise<void> {
  if (isLocalMode()) return;
  await setQstashQueueParallelism(TRANSCRIBE_QUEUE, 8);
  await setQstashQueueParallelism(QUESTIONS_QUEUE, 4);
  await setQstashQueueParallelism(CLEANUP_QUEUE, 8);
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
      return [q, data.messageCount ?? 0] as [string, number];
    }));
    metric("autobottom.qstash.get_counts", 1);
    return Object.fromEntries(pairs);
  }, {}, "client");
}
