/** HTTP handlers for SSE events and messaging routes. */

import { requireAuth, json } from "./helpers.ts";
import { authenticate, listUsers, getUser } from "../domain/coordinators/auth/mod.ts";
import { Kv } from "../domain/data/kv/mod.ts";

// -- SSE Events Endpoint --

export async function handleSSE(req: Request): Promise<Response> {
  const auth = await authenticate(req);
  if (!auth) return json({ error: "unauthorized" }, 401);

  let closed = false;
  let lastSeen = Date.now();

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch { closed = true; }
      };

      // Heartbeat every 15s
      const heartbeat = setInterval(() => {
        if (closed) { clearInterval(heartbeat); return; }
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch { closed = true; clearInterval(heartbeat); }
      }, 15_000);

      // Poll for personal events every 2s
      const poll = setInterval(async () => {
        if (closed) { clearInterval(poll); return; }
        try {
          const events = await getEvents(auth.orgId, auth.email, lastSeen);
          if (events.length > 0) {
            for (const evt of events) {
              send(evt.type, evt);
            }
            lastSeen = Math.max(...events.map((e) => e.createdAt));
            await deleteEvents(auth.orgId, auth.email, events.map((e) => e.id));
          }
        } catch (err) {
          console.error(`[SSE] Poll error for ${auth.email}:`, err);
        }
      }, 2_000);

      // Poll for broadcast events every 3s
      let lastBroadcastSeen = Date.now();
      const broadcastPoll = setInterval(async () => {
        if (closed) { clearInterval(broadcastPoll); return; }
        try {
          const broadcasts = await getBroadcastEvents(auth.orgId, lastBroadcastSeen);
          for (const evt of broadcasts) {
            if (evt.triggerEmail === auth.email) continue;
            send("prefab-broadcast", evt);
          }
          if (broadcasts.length > 0) {
            lastBroadcastSeen = Math.max(...broadcasts.map((e) => e.ts));
          }
        } catch (err) {
          console.error(`[SSE] Broadcast poll error for ${auth.email}:`, err);
        }
      }, 3_000);

      // Send initial connection event
      send("connected", { email: auth.email, ts: Date.now() });

      // Cleanup when the client disconnects
      req.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(heartbeat);
        clearInterval(poll);
        clearInterval(broadcastPoll);
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

// -- Messaging Endpoints --

export async function handleSendMessage(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const body = await req.json();
  const { to, body: msgBody } = body;
  if (!to || !msgBody) return json({ error: "to and body required" }, 400);
  if (typeof msgBody !== "string" || msgBody.trim().length === 0) {
    return json({ error: "body must be a non-empty string" }, 400);
  }

  const recipient = await getUser(auth.orgId, to);
  if (!recipient) return json({ error: "recipient not found" }, 404);

  const msg = await (await Kv.getInstance()).sendMessage(auth.orgId, auth.email, to, msgBody.trim());

  // Emit event for the recipient
  await emitEvent(auth.orgId, to, "message-received", {
    from: auth.email,
    preview: msgBody.trim().slice(0, 100),
    messageId: msg.id,
  });

  return json(msg);
}

export async function handleGetConversation(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const url = new URL(req.url);
  const otherEmail = url.pathname.replace("/api/messages/", "");
  if (!otherEmail || otherEmail === "unread" || otherEmail === "conversations") {
    return json({ error: "email parameter required" }, 400);
  }

  await (await Kv.getInstance()).markConversationRead(auth.orgId, auth.email, otherEmail);
  const messages = await (await Kv.getInstance()).getConversation(auth.orgId, auth.email, otherEmail);
  return json(messages);
}

export async function handleGetUnread(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const count = await (await Kv.getInstance()).getUnreadCount(auth.orgId, auth.email);
  return json({ count });
}

export async function handleGetConversations(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const conversations = await (await Kv.getInstance()).getConversationList(auth.orgId, auth.email);
  return json(conversations);
}

export async function handleGetOrgUsers(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const users = await listUsers(auth.orgId);
  return json(users.filter((u) => u.email !== auth.email).map((u) => ({ email: u.email, role: u.role })));
}
