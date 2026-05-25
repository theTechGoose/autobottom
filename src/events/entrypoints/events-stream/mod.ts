/** SSE handler for real-time event delivery. Direct-dispatched from main.ts
 *  (danet controllers can't return a streaming Response without going through
 *  the buffered JSON path).
 *
 *  Two endpoints share this handler shape, distinguished by the `kind` param
 *  in the route table:
 *    /api/events/stream  — toast / broadcast / chat events for the requester
 *    /api/chat/stream    — chat-only stream (same payload shape; lighter)
 *
 *  Wire protocol:
 *    data: {"channel":"app","type":"new-message","payload":{...}}\n\n
 *
 *  Heartbeat (`: keepalive\n\n`) every 25s prevents Deno Deploy from killing
 *  the long-lived connection. The reader (EventSource) treats lines starting
 *  with `:` as comments and ignores them. */

import { authenticate } from "@core/business/auth/mod.ts";
import {
  subscribeUser, subscribeOrg, type BusEvent,
} from "@events/domain/business/event-bus/mod.ts";

const KEEPALIVE_INTERVAL_MS = 25_000;

function sseFrame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/** Stream both user-targeted app events AND org-wide broadcasts.
 *  Used by the global EventToaster island. */
export async function handleEventsStream(req: Request): Promise<Response> {
  const auth = await authenticate(req);
  if (!auth) return new Response("unauthorized", { status: 401 });

  const url = new URL(req.url);
  // Allow ?email= override for admin impersonation flows; default to the
  // authenticated email so a regular user can't tap someone else's stream.
  const email = url.searchParams.get("email") ?? auth.email;
  if (email !== auth.email && auth.role !== "admin") {
    return new Response("forbidden", { status: 403 });
  }

  const orgId = auth.orgId;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();

      let closed = false;
      const safeEnqueue = (s: string) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(s)); } catch { closed = true; }
      };

      // Initial hello so the client knows the stream is alive.
      safeEnqueue(sseFrame({ channel: "system", type: "ready", payload: { email } }));

      const onEvent = (event: BusEvent) => {
        safeEnqueue(sseFrame({
          channel: event.kind,
          type: event.type,
          payload: event.payload,
        }));
      };

      const unsubUser = subscribeUser(orgId, email, onEvent);
      const unsubOrg = subscribeOrg(orgId, onEvent);

      // Heartbeat — comment line, ignored by EventSource.
      const heartbeat = setInterval(() => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(`: keepalive\n\n`)); }
        catch { closed = true; }
      }, KEEPALIVE_INTERVAL_MS);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        try { unsubUser(); } catch { /* noop */ }
        try { unsubOrg(); } catch { /* noop */ }
      };

      req.signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel() { /* abort handled by req.signal */ },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
      "x-accel-buffering": "no",  // Disable nginx/proxy buffering if present.
    },
  });
}

/** Chat-only stream — same payload shape but excludes org-wide broadcasts
 *  so the chat page doesn't re-render the thread when a badge fires. */
export async function handleChatStream(req: Request): Promise<Response> {
  const auth = await authenticate(req);
  if (!auth) return new Response("unauthorized", { status: 401 });

  const url = new URL(req.url);
  const email = url.searchParams.get("email") ?? auth.email;
  if (email !== auth.email && auth.role !== "admin") {
    return new Response("forbidden", { status: 403 });
  }

  const orgId = auth.orgId;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const safeEnqueue = (s: string) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(s)); } catch { closed = true; }
      };

      safeEnqueue(sseFrame({ channel: "system", type: "ready", payload: { email } }));

      // Filter to chat-related event types only. Other app events still
      // flow through `/api/events/stream`.
      const CHAT_TYPES = new Set([
        "new-message", "unread-changed", "message-received",
        "typing-start", "typing-stop",
      ]);
      const unsubUser = subscribeUser(orgId, email, (event) => {
        if (event.kind !== "app") return;
        if (!CHAT_TYPES.has(event.type)) return;
        safeEnqueue(sseFrame({ channel: event.kind, type: event.type, payload: event.payload }));
      });

      const heartbeat = setInterval(() => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(`: keepalive\n\n`)); }
        catch { closed = true; }
      }, KEEPALIVE_INTERVAL_MS);

      req.signal.addEventListener("abort", () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        try { unsubUser(); } catch { /* noop */ }
      }, { once: true });
    },
    cancel() { /* abort handled by req.signal */ },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
