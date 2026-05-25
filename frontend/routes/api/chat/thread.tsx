/** HTMX fragment — returns rendered message thread HTML.
 *  When the peer has equipped cosmetics (game-state) the sender name is
 *  rendered above each `received` bubble with the peer's name color + flair. */
import { define } from "../../../lib/define.ts";
import { apiFetch } from "../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import { resolveCosmetics } from "../../../lib/cosmetics.ts";

interface Message { id: string; from: string; to: string; body: string; ts: number; }
interface PeerCosmeticsResp {
  gameState?: {
    equippedTitle?: string | null;
    equippedNameColor?: string | null;
    equippedFlair?: string | null;
  } | null;
}

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const email = url.searchParams.get("email") ?? "";
    const peer = url.searchParams.get("peer") ?? "";
    try {
      // Parallel: thread + peer cosmetics (one extra small Firestore read).
      const [convos, peerState] = await Promise.all([
        apiFetch<{ conversations: { peer: string; messages?: Message[] }[] }>(
          `/api/messages/conversations?email=${encodeURIComponent(email)}`, ctx.req,
        ),
        peer
          ? apiFetch<PeerCosmeticsResp>(`/gamification/api/my-state?email=${encodeURIComponent(peer)}`, ctx.req).catch(() => ({} as PeerCosmeticsResp))
          : Promise.resolve({} as PeerCosmeticsResp),
      ]);
      const convo = convos.conversations?.find(c => c.peer === peer);
      const messages: Message[] = (convo as any)?.messages ?? [];
      const peerCos = resolveCosmetics(peerState.gameState ?? null);
      const peerName = peer.split("@")[0];

      const html = renderToString(
        <>
          {messages.length === 0 ? (
            <div style="text-align:center;color:var(--text-dim);padding:40px;">No messages yet — say hello!</div>
          ) : messages.map((m) => {
            const isReceived = m.from !== email;
            return (
              <div key={m.id} class={`chat-bubble ${isReceived ? "received" : "sent"}`}>
                {isReceived && (
                  <div
                    class="chat-bubble-sender"
                    style={`font-size:10px;font-weight:600;margin-bottom:2px;color:${peerCos.nameColor};`}
                  >
                    {peerName}{peerCos.flair && <span style="margin-left:3px;">{peerCos.flair}</span>}
                  </div>
                )}
                <div class="chat-bubble-body">{m.body}</div>
                <div class="chat-bubble-time">{new Date(m.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
              </div>
            );
          })}
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
