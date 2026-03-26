/** QStash queue helper for enqueuing pipeline steps. */
import { env } from "../../../../env.ts";

const QUEUE_NAME = "audit-pipeline";
const CLEANUP_QUEUE = "audit-cleanup";

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

  // QStash enqueue (queue-based) does not support Upstash-Delay.
  // Use publish (non-queued) for delayed messages instead.
  let endpoint: string;
  if (delaySeconds) {
    headers["Upstash-Delay"] = `${delaySeconds}s`;
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
  const url = `${env.selfUrl}/audit/step/${step}`;
  return enqueue(QUEUE_NAME, url, body, delaySeconds);
}

export function enqueueCleanup(body: unknown, delaySeconds: number) {
  const url = `${env.selfUrl}/audit/step/cleanup`;
  return enqueue(CLEANUP_QUEUE, url, body, delaySeconds);
}
