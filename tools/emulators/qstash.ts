/** QStash stand-in: the queue semantics the pipeline actually depends on.
 *
 *  Covers the endpoints the app calls — enqueue, publish, and the queue
 *  management surface (`/v2/queues`, pause, resume, delete) that boot-time
 *  `applyDefaultQueueParallelism()` uses. Unlike the old LOCAL_QUEUE branch,
 *  which was a bare setTimeout inside the app, this is a real out-of-process
 *  broker: it honors per-queue parallelism, the `Upstash-Delay` header, and
 *  `Upstash-Retries` with backoff. The app's code path is unchanged — it
 *  makes the same HTTP calls it makes to Upstash.
 *
 *  Deliberately NOT durable: restarting the emulator drops in-flight work, the
 *  same way it would if you dropped a local Upstash. */

import { EMULATOR_PORTS } from "@core/config/endpoints.ts";

interface QueueState {
  parallelism: number;
  paused: boolean;
  running: number;
  lag: number;
  pending: Array<() => Promise<void>>;
}

const queues = new Map<string, QueueState>();

function queue(name: string): QueueState {
  let q = queues.get(name);
  if (!q) {
    q = { parallelism: 1, paused: false, running: 0, lag: 0, pending: [] };
    queues.set(name, q);
  }
  return q;
}

function pump(name: string): void {
  const q = queue(name);
  while (!q.paused && q.running < q.parallelism && q.pending.length > 0) {
    const job = q.pending.shift()!;
    q.lag = q.pending.length;
    q.running++;
    job().finally(() => {
      q.running--;
      pump(name);
    });
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One delivery attempt chain: POST the body at the target, retrying on a
 *  non-2xx the way QStash does (fixed backoff, capped attempts). */
function deliver(targetUrl: string, body: string, retries: number, label: string): () => Promise<void> {
  return async () => {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(targetUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        });
        if (res.ok) {
          await res.body?.cancel();
          console.log(`[QSTASH-EMU] ${label} → ${res.status}`);
          return;
        }
        console.warn(`[QSTASH-EMU] ${label} → ${res.status} (attempt ${attempt + 1}/${retries + 1})`);
        await res.body?.cancel();
      } catch (err) {
        console.warn(`[QSTASH-EMU] ${label} threw (attempt ${attempt + 1}/${retries + 1}):`, err);
      }
      if (attempt < retries) await sleep(1000 * (attempt + 1));
    }
    console.error(`[QSTASH-EMU] ${label} exhausted retries`);
  };
}

function messageId(): string {
  return `emu_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // ── Queue management ──────────────────────────────────────────────────────
  if (path === "/v2/queues" && req.method === "POST") {
    const body = await req.json().catch(() => ({})) as { queueName?: string; parallelism?: number; paused?: boolean };
    if (!body.queueName) return Response.json({ error: "queueName required" }, { status: 400 });
    const q = queue(body.queueName);
    if (typeof body.parallelism === "number") q.parallelism = body.parallelism;
    if (typeof body.paused === "boolean") q.paused = body.paused;
    pump(body.queueName);
    return Response.json({ queueName: body.queueName, parallelism: q.parallelism, paused: q.paused });
  }

  const queueMatch = /^\/v2\/queues\/([^/]+)(\/pause|\/resume)?$/.exec(path);
  if (queueMatch) {
    const name = decodeURIComponent(queueMatch[1]);
    const action = queueMatch[2];
    const q = queue(name);
    if (action === "/pause") { q.paused = true; return Response.json({ ok: true }); }
    if (action === "/resume") { q.paused = false; pump(name); return Response.json({ ok: true }); }
    if (req.method === "DELETE") { queues.delete(name); return Response.json({ ok: true }); }
    return Response.json({ name, parallelism: q.parallelism, paused: q.paused, lag: q.lag });
  }

  // ── Delivery ──────────────────────────────────────────────────────────────
  // Both shapes carry the destination as the remainder of the path:
  //   /v2/enqueue/<queueName>/<absolute target url>
  //   /v2/publish/<absolute target url>
  const enqueueMatch = /^\/v2\/enqueue\/([^/]+)\/(.+)$/.exec(path);
  const publishMatch = /^\/v2\/publish\/(.+)$/.exec(path);
  if (enqueueMatch || publishMatch) {
    const body = await req.text();
    const retries = Number(req.headers.get("upstash-retries") ?? "0");
    const delayHeader = req.headers.get("upstash-delay");
    const delayMs = delayHeader ? Number(delayHeader.replace(/s$/, "")) * 1000 : 0;
    const target = decodeURIComponent((enqueueMatch ? enqueueMatch[2] : publishMatch![1]) + url.search);
    const name = enqueueMatch ? decodeURIComponent(enqueueMatch[1]) : "publish";
    const id = messageId();
    const label = `${name} ${target.slice(0, 90)}`;
    const job = deliver(target, body, retries, label);

    if (delayMs > 0) {
      setTimeout(() => { queue(name).pending.push(job); queue(name).lag++; pump(name); }, delayMs);
    } else {
      queue(name).pending.push(job);
      queue(name).lag++;
      pump(name);
    }
    return Response.json({ messageId: id });
  }

  return Response.json({ error: `unhandled ${req.method} ${path}` }, { status: 404 });
}

export function startQStash(): Deno.HttpServer {
  return Deno.serve({ port: EMULATOR_PORTS.qstash, onListen: () => {} }, handle);
}
