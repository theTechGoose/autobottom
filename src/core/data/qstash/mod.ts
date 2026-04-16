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

/** Wrap an async request handler so that selfUrl() reads back the request's origin. */
export function runWithOrigin<T>(origin: string, fn: () => Promise<T>): Promise<T> {
  return requestOriginStore.run(origin, fn);
}

function selfUrl(): string {
  // Prefer the origin of the current inbound request (set by main.ts handler).
  // Falls back to env var for cron/background callers that have no active request.
  const scoped = requestOriginStore.getStore();
  if (scoped) return scoped;
  return Deno.env.get("SELF_URL") ?? "http://localhost:3000";
}

/** Expose the current effective self-URL for debug endpoints. Always returns a
 *  string — AsyncLocalStorage origin when inside a request, env var otherwise. */
export function getSelfUrl(): string { return selfUrl(); }
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
