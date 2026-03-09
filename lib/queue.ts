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

async function enqueue(queueName: string, targetUrl: string, body: unknown, delaySeconds?: number) {
  if (LOCAL_MODE) {
    return localEnqueue(targetUrl, body, delaySeconds);
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.qstashToken}`,
    "Content-Type": "application/json",
    "Upstash-Retries": "0",
  };

  // ask-all runs 25 Groq calls in parallel — extend QStash delivery timeout to 900s (15 min)
  if (step === "ask-all") {
    headers["Upstash-Timeout"] = "900";
  }

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
  return enqueue(queueName, url, body, delaySeconds);
}

/** Bypass the queue and deliver immediately via QStash publish. Use for admin retries to skip the backlog. */
export async function publishStep(step: string, body: unknown) {
  const url = `${env.selfUrl}/audit/step/${step}`;
  if (LOCAL_MODE) return localEnqueue(url, body);
  const res = await fetch(`${env.qstashUrl}/v2/publish/${url}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.qstashToken}`,
      "Content-Type": "application/json",
      "Upstash-Retries": "0",
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
