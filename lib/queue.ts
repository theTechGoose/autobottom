/** QStash queue helper for enqueuing pipeline steps. */
import { env } from "../env.ts";

const TRANSCRIBE_QUEUE = "audit-transcribe";
const QUESTIONS_QUEUE = "audit-questions";
const CLEANUP_QUEUE = "audit-cleanup";

/** All managed queues — used by admin handlers to apply parallelism changes to all queues at once. */
export const ALL_QUEUES = [TRANSCRIBE_QUEUE, QUESTIONS_QUEUE, CLEANUP_QUEUE] as const;

/** Routes each step to its dedicated queue so each pool of 20 slots stays independent. */
const STEP_QUEUE: Record<string, string> = {
  "init":            TRANSCRIBE_QUEUE,
  "transcribe":      TRANSCRIBE_QUEUE,
  "poll-transcript": TRANSCRIBE_QUEUE,
  "transcribe-complete": TRANSCRIBE_QUEUE,
  "prepare":         TRANSCRIBE_QUEUE,
  "ask-batch":       QUESTIONS_QUEUE,
  "ask-all":         QUESTIONS_QUEUE,
  "finalize":        CLEANUP_QUEUE,
  "diarize-async":   CLEANUP_QUEUE,
  "pinecone-async":  CLEANUP_QUEUE,
  "bad-word-check":  CLEANUP_QUEUE,
};

const LOCAL_MODE = Deno.env.get("LOCAL_QUEUE") === "true";

/** In local mode, POST directly to localhost instead of QStash. */
async function localEnqueue(targetUrl: string, body: unknown, delaySeconds?: number) {
  const delay = delaySeconds ? delaySeconds * 1000 : 0;
  setTimeout(async () => {
    try {
      const res = await fetch(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        console.error(`[LOCAL-QUEUE] ${targetUrl} failed: ${res.status} ${text}`);
      }
    } catch (err) {
      console.error(`[LOCAL-QUEUE] ${targetUrl} error:`, err);
    }
  }, delay);
  return `local-${Date.now()}`;
}

async function enqueue(queueName: string, targetUrl: string, body: unknown, delaySeconds?: number, extraHeaders?: Record<string, string>) {
  if (LOCAL_MODE) {
    return localEnqueue(targetUrl, body, delaySeconds);
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.qstashToken}`,
    "Content-Type": "application/json",
    "Upstash-Retries": "0",
    ...extraHeaders,
  };

  // QStash enqueue (queue-based) does not support Upstash-Delay.
  // Use publish (non-queued) for delayed messages instead.
  // Delayed publishes get 3 retries so a cold-start 5xx doesn't silently drop the message.
  let endpoint: string;
  if (delaySeconds) {
    headers["Upstash-Delay"] = `${delaySeconds}s`;
    headers["Upstash-Retries"] = "3";
    endpoint = `${env.qstashUrl}/v2/publish/${targetUrl}`;
  } else {
    endpoint = `${env.qstashUrl}/v2/enqueue/${queueName}/${targetUrl}`;
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`QStash enqueue failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  return data.messageId;
}

export function enqueueStep(step: string, body: unknown, delaySeconds?: number) {
  const queueName = STEP_QUEUE[step] ?? QUESTIONS_QUEUE;
  const url = `${env.selfUrl}/audit/step/${step}`;
  // ask-all runs 25 questions in parallel with model fallback chains — needs more than QStash's 30s default.
  // 120s is enough for any fallback scenario while keeping slot hold time reasonable (vs 900s which starved the queue).
  const extraHeaders = step === "ask-all" ? { "Upstash-Timeout": "120s" } : undefined;
  return enqueue(queueName, url, body, delaySeconds, extraHeaders);
}

/** Bypass the queue and deliver immediately via QStash publish. Use for admin retries to skip the backlog. */
export async function publishStep(step: string, body: unknown) {
  const url = `${env.selfUrl}/audit/step/${step}`;
  if (LOCAL_MODE) return localEnqueue(url, body);
  // ask-all needs a longer response timeout — publish path only (queue slots stay free)
  const timeout = step === "ask-all" ? { "Upstash-Timeout": "900s" } : {};
  const res = await fetch(`${env.qstashUrl}/v2/publish/${url}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.qstashToken}`,
      "Content-Type": "application/json",
      "Upstash-Retries": "0",
      ...timeout,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`QStash publish failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  return data.messageId;
}

export function enqueueCleanup(body: unknown, delaySeconds: number) {
  const url = `${env.selfUrl}/audit/step/cleanup`;
  return enqueue(CLEANUP_QUEUE, url, body, delaySeconds);
}

const qstashAuth = () => ({ Authorization: `Bearer ${env.qstashToken}` });

async function forEachQueue<T>(fn: (q: string) => Promise<T>): Promise<T[]> {
  return Promise.all(ALL_QUEUES.map(fn));
}

async function setAllQueuesState(action: "pause" | "resume"): Promise<void> {
  if (LOCAL_MODE) return;
  await forEachQueue(async (q) => {
    const res = await fetch(`${env.qstashUrl}/v2/queues/${q}/${action}`, {
      method: "POST",
      headers: qstashAuth(),
    });
    if (!res.ok) console.error(`[QSTASH] ${action} ${q} failed: ${res.status} ${await res.text()}`);
  });
}

/** Pause all QStash queues — pending messages stop delivering until resumed. */
export const pauseAllQueues = () => setAllQueuesState("pause");

/** Resume all QStash queues after a pause. */
export const resumeAllQueues = () => setAllQueuesState("resume");

/** Delete all pending messages from every managed queue. Returns total deleted. */
export async function purgeAllQueues(): Promise<number> {
  if (LOCAL_MODE) return 0;
  let total = 0;
  await forEachQueue(async (q) => {
    let cursor: string | undefined;
    do {
      const url = new URL(`${env.qstashUrl}/v2/messages`);
      url.searchParams.set("queueName", q);
      if (cursor) url.searchParams.set("cursor", cursor);
      const res = await fetch(url.toString(), { headers: qstashAuth() });
      if (!res.ok) { console.error(`[QSTASH] list ${q} failed: ${res.status}`); return; }
      const { messages = [], cursor: next } = await res.json();
      cursor = next;
      await Promise.all((messages as { messageId: string }[]).map(async (m) => {
        const del = await fetch(`${env.qstashUrl}/v2/messages/${m.messageId}`, {
          method: "DELETE", headers: qstashAuth(),
        });
        if (del.ok) total++;
      }));
    } while (cursor);
  });
  return total;
}

/** Get pending message count per queue from QStash. */
export async function getQueueCounts(): Promise<Record<string, number>> {
  if (LOCAL_MODE) return Object.fromEntries(ALL_QUEUES.map((q) => [q, 0]));
  const pairs = await forEachQueue(async (q) => {
    const res = await fetch(`${env.qstashUrl}/v2/queues/${q}`, { headers: qstashAuth() });
    const data = res.ok ? await res.json() : {};
    return [q, data.messageCount ?? 0] as [string, number];
  });
  return Object.fromEntries(pairs);
}
