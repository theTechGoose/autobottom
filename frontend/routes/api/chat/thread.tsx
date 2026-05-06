/** HTMX fragment — returns rendered message thread HTML. */
import { define } from "../../../lib/define.ts";
import { apiFetch } from "../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

interface Message { id: string; from: string; to: string; body: string; ts: number; }

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const email = url.searchParams.get("email") ?? "";
    const peer = url.searchParams.get("peer") ?? "";
    try {
      const convos = await apiFetch<{ conversations: { peer: string; messages?: Message[] }[] }>(
        `/api/messages/conversations?email=${encodeURIComponent(email)}`, ctx.req,
      );
      const convo = convos.conversations?.find(c => c.peer === peer);
      const messages: Message[] = (convo as any)?.messages ?? [];

      const html = renderToString(
        <>
          {messages.length === 0 ? (
            <div style="text-align:center;color:var(--text-dim);padding:40px;">No messages yet — say hello!</div>
          ) : messages.map((m) => (
            <div key={m.id} class={`chat-bubble ${m.from === email ? "sent" : "received"}`}>
              <div class="chat-bubble-body">{m.body}</div>
              <div class="chat-bubble-time">{new Date(m.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
            </div>
          ))}
        </>
      );
      return new Response(html, { headers: { "content-type": "text/html" } });
    } catch {
      return new Response(`<div style="color:var(--text-dim);padding:20px;">Failed to load messages</div>`, {
        headers: { "content-type": "text/html" },
      });
    }
  },
});
