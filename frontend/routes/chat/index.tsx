/** Chat page — conversation list sidebar + message thread + input. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { apiFetch } from "../../lib/api.ts";
import ChatInput from "../../islands/ChatInput.tsx";

interface Conversation { peer: string; lastMessage?: string; lastTs?: number; unread?: number; }
interface Message { id: string; from: string; to: string; body: string; ts: number; }

export default define.page(async function ChatPage(ctx) {
  const user = ctx.state.user!;
  const url = new URL(ctx.req.url);
  const activePeer = url.searchParams.get("peer") ?? "";

  let conversations: Conversation[] = [];
  let messages: Message[] = [];
  let users: { email: string }[] = [];

  try {
    const [convData, userData] = await Promise.all([
      apiFetch<{ conversations: Conversation[] }>(`/api/messages/conversations?email=${encodeURIComponent(user.email)}`, ctx.req),
      apiFetch<{ users: { email: string }[] }>("/api/users", ctx.req),
    ]);
    conversations = convData.conversations ?? [];
    users = userData.users ?? [];
  } catch (e) { console.error("Chat data error:", e); }

  return (
    <Layout title="Chat" section="chat" user={user}>
      <div class="chat-layout">
        {/* Conversation list */}
        <div class="chat-sidebar">
          <div class="chat-sidebar-header">
            <span class="chat-sidebar-title">Messages</span>
            <select
              class="chat-new-convo"
              onchange={`if(this.value)window.location='/chat?peer='+encodeURIComponent(this.value);this.value=''`}
            >
              <option value="">New chat...</option>
              {users.filter(u => u.email !== user.email).map(u => (
                <option key={u.email} value={u.email}>{u.email}</option>
              ))}
            </select>
          </div>
          <div class="chat-convo-list">
            {conversations.length === 0 ? (
              <div class="chat-empty-convos">No conversations yet</div>
            ) : conversations.map((c) => (
              <a
                key={c.peer}
                href={`/chat?peer=${encodeURIComponent(c.peer)}`}
                class={`chat-convo-item ${activePeer === c.peer ? "active" : ""}`}
              >
                <div class="chat-convo-avatar">{c.peer.slice(0, 2).toUpperCase()}</div>
                <div class="chat-convo-info">
                  <div class="chat-convo-name">{c.peer}</div>
                  <div class="chat-convo-preview">{c.lastMessage?.slice(0, 50) ?? ""}</div>
                </div>
                {(c.unread ?? 0) > 0 && <div class="chat-convo-badge">{c.unread}</div>}
              </a>
            ))}
          </div>
        </div>

        {/* Thread */}
        <div class="chat-thread">
          {activePeer ? (
            <>
              <div class="chat-thread-header">
                <span class="chat-thread-peer">{activePeer}</span>
              </div>
              <div
                id="chat-messages"
                class="chat-messages"
                hx-get={`/api/chat/thread?email=${encodeURIComponent(user.email)}&peer=${encodeURIComponent(activePeer)}`}
                hx-trigger="load, every 5s"
                hx-swap="innerHTML"
              >
                <div class="chat-loading">Loading messages...</div>
              </div>
              <ChatInput email={user.email} peer={activePeer} />
            </>
          ) : (
            <div class="chat-no-thread">
              <div style="font-size:48px;opacity:0.3;margin-bottom:12px;">💬</div>
              <div style="color:var(--text-muted);">Select a conversation or start a new one</div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
});
