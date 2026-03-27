import { useSignal, useComputed } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";

interface Message {
  from: string;
  body: string;
  ts: number;
}

interface Conversation {
  email: string;
  lastMessage?: { body: string; ts: number; from: string };
  unread: number;
}

interface User {
  email: string;
  role: string;
}

interface Me {
  username: string;
  role: string;
}

const ROLE_HOME: Record<string, string> = {
  admin: "/admin/dashboard",
  judge: "/judge/dashboard",
  manager: "/manager",
  reviewer: "/review/dashboard",
  user: "/agent",
};

function relTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return mins + "m";
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + "h";
  const days = Math.floor(hrs / 24);
  if (days < 7) return days + "d";
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function dateLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function timeStr(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function initial(email: string): string {
  return (email || "?")[0].toUpperCase();
}

function sortedConversations(convs: Conversation[]): Conversation[] {
  return [...convs].sort((a, b) => (b.lastMessage?.ts || 0) - (a.lastMessage?.ts || 0));
}

export default function ChatRoom() {
  const me = useSignal<Me | null>(null);
  const conversations = useSignal<Conversation[]>([]);
  const allUsers = useSignal<User[]>([]);
  const activeEmail = useSignal<string | null>(null);
  const messages = useSignal<Message[]>([]);
  const msgInput = useSignal("");
  const sending = useSignal(false);
  const convSearch = useSignal("");
  const modalOpen = useSignal(false);
  const modalSearch = useSignal("");
  const loadingConv = useSignal(false);
  const initialized = useSignal(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pollIntervalRef = useRef<number | null>(null);

  function scrollToBottom() {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }

  async function loadConversations() {
    try {
      const res = await fetch("/api/messages/conversations");
      if (res.ok) {
        const data: Conversation[] = await res.json();
        conversations.value = data;
      }
    } catch { /* ignore */ }
  }

  async function openConversation(email: string) {
    activeEmail.value = email;
    loadingConv.value = true;

    // Mark unread as 0
    conversations.value = conversations.value.map((c) =>
      c.email === email ? { ...c, unread: 0 } : c
    );

    try {
      const res = await fetch("/api/messages/" + encodeURIComponent(email));
      if (res.ok) {
        messages.value = await res.json();
        setTimeout(scrollToBottom, 50);
      }
    } catch { /* ignore */ }
    finally {
      loadingConv.value = false;
    }

    if (textareaRef.current) textareaRef.current.focus();
  }

  async function sendMsg() {
    const body = msgInput.value.trim();
    if (!body || !activeEmail.value || sending.value) return;

    sending.value = true;
    const now = Date.now();

    // Optimistic update
    const optimistic: Message = { from: me.value?.username || "", body, ts: now };
    messages.value = [...messages.value, optimistic];
    msgInput.value = "";
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    setTimeout(scrollToBottom, 20);

    // Update conversation list
    const existing = conversations.value.find((c) => c.email === activeEmail.value);
    if (existing) {
      conversations.value = conversations.value.map((c) =>
        c.email === activeEmail.value
          ? { ...c, lastMessage: { body, ts: now, from: me.value?.username || "" } }
          : c
      );
    } else {
      conversations.value = [
        { email: activeEmail.value!, lastMessage: { body, ts: now, from: me.value?.username || "" }, unread: 0 },
        ...conversations.value,
      ];
    }

    try {
      await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: activeEmail.value, body }),
      });
    } catch { /* ignore send errors */ }

    sending.value = false;
  }

  // Poll for new messages in active conversation
  function startPolling() {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    pollIntervalRef.current = setInterval(async () => {
      if (!activeEmail.value) return;
      try {
        const res = await fetch("/api/messages/" + encodeURIComponent(activeEmail.value));
        if (res.ok) {
          const data: Message[] = await res.json();
          if (data.length !== messages.value.length) {
            messages.value = data;
            scrollToBottom();
          }
        }
      } catch { /* ignore */ }

      // Also refresh conversation list for unread indicators
      loadConversations();
    }, 5000);
  }

  function stopPolling() {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }

  useEffect(() => {
    async function init() {
      try {
        const [meRes, convsRes, usersRes] = await Promise.all([
          fetch("/chat/api/me"),
          fetch("/api/messages/conversations"),
          fetch("/api/users"),
        ]);

        if (!meRes.ok) { window.location.href = "/login"; return; }

        const meData: Me = await meRes.json();
        me.value = meData;

        // Update sidebar
        const navAvatar = document.getElementById("nav-avatar");
        const navUsername = document.getElementById("nav-username");
        const navRole = document.getElementById("nav-role");
        const dashLink = document.getElementById("dashboard-link") as HTMLAnchorElement;
        if (navAvatar) navAvatar.textContent = initial(meData.username);
        if (navUsername) navUsername.textContent = meData.username;
        if (navRole) navRole.textContent = meData.role;
        if (dashLink) dashLink.href = ROLE_HOME[meData.role] || "/";

        if (convsRes.ok) conversations.value = await convsRes.json();
        if (usersRes.ok) allUsers.value = await usersRes.json();

        initialized.value = true;
      } catch { /* ignore */ }
    }

    init();
    startPolling();

    return () => stopPolling();
  }, []);

  const filteredConversations = useComputed(() => {
    const q = convSearch.value.toLowerCase();
    const convs = q
      ? conversations.value.filter((c) => c.email.toLowerCase().includes(q))
      : conversations.value;
    return sortedConversations(convs);
  });

  const filteredModalUsers = useComputed(() => {
    const q = modalSearch.value.toLowerCase();
    return q ? allUsers.value.filter((u) => u.email.toLowerCase().includes(q)) : allUsers.value;
  });

  // Group messages by date
  const groupedMessages = useComputed(() => {
    const sorted = [...messages.value].sort((a, b) => a.ts - b.ts);
    const groups: Array<{ label: string; messages: Message[] }> = [];
    let lastLabel = "";
    for (const m of sorted) {
      const label = dateLabel(m.ts);
      if (label !== lastLabel) {
        groups.push({ label, messages: [m] });
        lastLabel = label;
      } else {
        groups[groups.length - 1].messages.push(m);
      }
    }
    return groups;
  });

  const activeConv = useComputed(() =>
    conversations.value.find((c) => c.email === activeEmail.value) || null
  );

  return (
    <div style="display:contents">
      <style>{`
        .conv-panel { width: 320px; min-width: 320px; border-right: 1px solid var(--border); display: flex; flex-direction: column; background: var(--bg); }
        .conv-header { padding: 16px; border-bottom: 1px solid var(--border); }
        .conv-header h2 { font-size: 14px; font-weight: 700; color: var(--text-bright); margin-bottom: 12px; }
        .btn-new { width: 100%; padding: 9px 12px; border: 1px solid var(--cyan-dim); background: linear-gradient(135deg,rgba(57,208,216,0.15),rgba(57,208,216,0.08)); color: var(--cyan); border-radius: 10px; font-size: 12px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; transition: all 0.2s; }
        .btn-new:hover { background: linear-gradient(135deg,rgba(57,208,216,0.22),rgba(57,208,216,0.12)); transform: translateY(-1px); }
        .conv-search { width: 100%; padding: 8px 12px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 12px; margin-top: 10px; outline: none; }
        .conv-search:focus { border-color: var(--cyan-dim); }
        .conv-search::placeholder { color: var(--text-dim); }
        .conv-list { flex: 1; overflow-y: auto; padding: 6px 8px; }
        .conv-item { display: flex; align-items: center; gap: 10px; padding: 10px; border-radius: 10px; cursor: pointer; border: 1px solid transparent; transition: all 0.2s; margin-bottom: 2px; }
        .conv-item:hover { background: var(--bg-surface); border-color: var(--border); }
        .conv-item.active { background: var(--cyan-bg); border-color: var(--cyan-dim); }
        .conv-avatar { width: 38px; height: 38px; border-radius: 50%; background: var(--bg-surface); color: var(--text-muted); display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; flex-shrink: 0; }
        .conv-item.active .conv-avatar { background: rgba(57,208,216,0.15); color: var(--cyan); }
        .conv-info { flex: 1; min-width: 0; }
        .conv-email { font-size: 12px; font-weight: 600; color: var(--text-bright); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .conv-preview { font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
        .conv-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex-shrink: 0; }
        .conv-time { font-size: 10px; color: var(--text-dim); }
        .conv-unread { width: 8px; height: 8px; border-radius: 50%; background: var(--cyan); box-shadow: 0 0 6px rgba(57,208,216,0.5); }
        .conv-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--text-dim); font-size: 13px; padding: 24px; text-align: center; gap: 8px; }
        .thread-panel { flex: 1; display: flex; flex-direction: column; background: var(--bg); min-width: 0; }
        .thread-header { padding: 14px 24px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 12px; min-height: 56px; background: var(--bg-raised); }
        .th-email { font-size: 13px; font-weight: 600; color: var(--text-bright); }
        .th-role { font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 10px; background: var(--cyan-bg); color: var(--cyan); text-transform: capitalize; margin-left: 6px; }
        .thread-messages { flex: 1; overflow-y: auto; padding: 20px 24px; display: flex; flex-direction: column; gap: 2px; }
        .msg-date-sep { text-align: center; font-size: 10px; color: var(--text-dim); margin: 20px 0 12px; font-weight: 600; letter-spacing: 0.5px; display: flex; align-items: center; gap: 16px; }
        .msg-date-sep::before, .msg-date-sep::after { content: ''; flex: 1; height: 1px; background: linear-gradient(90deg, transparent, var(--border), transparent); }
        .msg-row { display: flex; margin-bottom: 2px; }
        .msg-row.sent { justify-content: flex-end; }
        .msg-row.received { justify-content: flex-start; }
        .msg-wrap { max-width: 65%; display: flex; flex-direction: column; }
        .msg-row.sent .msg-wrap { align-items: flex-end; }
        .msg-row.received .msg-wrap { align-items: flex-start; }
        .msg-bubble { padding: 10px 14px; border-radius: 18px; font-size: 13.5px; line-height: 1.5; overflow-wrap: break-word; white-space: pre-wrap; }
        .msg-row.sent .msg-bubble { background: linear-gradient(135deg,#2dd4bf,var(--cyan)); color: #0a0e14; border-bottom-right-radius: 4px; }
        .msg-row.received .msg-bubble { background: var(--bg-surface); color: var(--text); border: 1px solid var(--border); border-bottom-left-radius: 4px; }
        .msg-time { font-size: 9px; color: var(--text-dim); margin-top: 3px; padding: 0 4px; }
        .msg-row.sent .msg-time { text-align: right; }
        .thread-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--text-dim); font-size: 13px; padding: 24px; text-align: center; gap: 8px; }
        .thread-input { padding: 14px 24px; border-top: 1px solid var(--border); display: flex; gap: 10px; align-items: flex-end; background: var(--bg-raised); }
        .thread-input textarea { flex: 1; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 12px; color: var(--text); font-size: 13px; padding: 10px 14px; resize: none; outline: none; max-height: 120px; min-height: 42px; font-family: inherit; line-height: 1.4; }
        .thread-input textarea:focus { border-color: var(--cyan-dim); }
        .thread-input textarea::placeholder { color: var(--text-dim); }
        .btn-send { width: 42px; height: 42px; border-radius: 12px; background: var(--cyan); color: #0a0e14; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all 0.2s; }
        .btn-send:hover:not(:disabled) { transform: scale(1.05); box-shadow: 0 4px 16px rgba(57,208,216,0.3); }
        .btn-send:disabled { opacity: 0.3; cursor: not-allowed; background: var(--bg-surface); color: var(--text-dim); }
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); backdrop-filter: blur(4px); z-index: 100; display: flex; align-items: center; justify-content: center; opacity: 0; pointer-events: none; transition: opacity 0.2s; }
        .modal-overlay.show { opacity: 1; pointer-events: auto; }
        .modal { background: var(--bg-raised); border: 1px solid var(--border); border-radius: 14px; width: 380px; max-height: 480px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 24px 48px rgba(0,0,0,0.4); transform: translateY(12px) scale(0.97); transition: transform 0.25s cubic-bezier(0.34,1.56,0.64,1); }
        .modal-overlay.show .modal { transform: translateY(0) scale(1); }
        .modal-header { padding: 16px 20px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
        .modal-header h3 { font-size: 14px; font-weight: 700; color: var(--text-bright); }
        .modal-close { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 18px; line-height: 1; padding: 4px; border-radius: 6px; }
        .modal-close:hover { background: var(--bg-surface); color: var(--text); }
        .modal-search { padding: 12px 16px 8px; }
        .modal-search input { width: 100%; padding: 9px 12px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 12px; outline: none; }
        .modal-search input:focus { border-color: var(--cyan-dim); }
        .modal-search input::placeholder { color: var(--text-dim); }
        .modal-list { flex: 1; overflow-y: auto; padding: 4px 8px 8px; }
        .modal-user { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px; cursor: pointer; transition: all 0.15s; border: 1px solid transparent; }
        .modal-user:hover { background: var(--bg-surface); border-color: var(--border); }
        .modal-avatar { width: 28px; height: 28px; border-radius: 50%; background: var(--bg-surface); color: var(--text-muted); display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0; }
        .mu-info { flex: 1; min-width: 0; }
        .mu-email { font-size: 12px; color: var(--text-bright); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .mu-role { font-size: 10px; padding: 2px 6px; border-radius: 8px; background: var(--bg-surface); color: var(--text-muted); text-transform: capitalize; flex-shrink: 0; }
        .modal-empty { padding: 24px; text-align: center; color: var(--text-dim); font-size: 12px; }
      `}</style>

      {/* Conversation list panel */}
      <div class="conv-panel">
        <div class="conv-header">
          <h2>Messages</h2>
          <button class="btn-new" onClick={() => { modalOpen.value = true; modalSearch.value = ""; }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" x2="12" y1="5" y2="19" /><line x1="5" x2="19" y1="12" y2="12" />
            </svg>
            New Message
          </button>
          <input
            type="text"
            class="conv-search"
            placeholder="Search conversations..."
            value={convSearch.value}
            onInput={(e) => { convSearch.value = (e.target as HTMLInputElement).value; }}
          />
        </div>
        <div class="conv-list">
          {filteredConversations.value.length === 0 ? (
            <div class="conv-empty">
              <span>&#128172;</span>
              <span>{convSearch.value ? "No matches" : "No conversations yet"}</span>
            </div>
          ) : (
            filteredConversations.value.map((c) => (
              <div
                key={c.email}
                class={`conv-item${activeEmail.value === c.email ? " active" : ""}`}
                onClick={() => openConversation(c.email)}
              >
                <div class="conv-avatar">{initial(c.email)}</div>
                <div class="conv-info">
                  <div class="conv-email">{c.email}</div>
                  {c.lastMessage && (
                    <div class="conv-preview">{c.lastMessage.body}</div>
                  )}
                </div>
                <div class="conv-meta">
                  {c.lastMessage && (
                    <div class="conv-time">{relTime(c.lastMessage.ts)}</div>
                  )}
                  {c.unread > 0 && <div class="conv-unread" />}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Thread panel */}
      <div class="thread-panel">
        {activeEmail.value ? (
          <>
            <div class="thread-header">
              <div class="conv-avatar" style="width:32px;height:32px;font-size:12px;">
                {initial(activeEmail.value)}
              </div>
              <div>
                <span class="th-email">{activeEmail.value}</span>
                {(() => {
                  const u = allUsers.value.find((u) => u.email === activeEmail.value);
                  return u ? <span class="th-role">{u.role}</span> : null;
                })()}
              </div>
            </div>

            <div class="thread-messages">
              {loadingConv.value ? (
                <div class="thread-empty">Loading messages...</div>
              ) : groupedMessages.value.length === 0 ? (
                <div class="thread-empty">
                  <span>&#128172;</span>
                  <span>No messages yet. Say hello!</span>
                </div>
              ) : (
                groupedMessages.value.map((group, gi) => (
                  <div key={gi}>
                    <div class="msg-date-sep">{group.label}</div>
                    {group.messages.map((m, mi) => {
                      const isSent = m.from === me.value?.username;
                      return (
                        <div class={`msg-row ${isSent ? "sent" : "received"}`} key={mi}>
                          <div class="msg-wrap">
                            <div class="msg-bubble">{m.body}</div>
                            <div class="msg-time">{timeStr(m.ts)}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            <div class="thread-input">
              <textarea
                ref={textareaRef}
                rows={1}
                placeholder="Type a message..."
                value={msgInput.value}
                onInput={(e) => {
                  const ta = e.target as HTMLTextAreaElement;
                  msgInput.value = ta.value;
                  ta.style.height = "auto";
                  ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMsg();
                  }
                }}
              />
              <button
                class="btn-send"
                disabled={!msgInput.value.trim() || sending.value}
                onClick={sendMsg}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" />
                </svg>
              </button>
            </div>
          </>
        ) : (
          <div class="thread-empty" style="flex:1;">
            <span>&#128172;</span>
            <span>Select a conversation to start messaging</span>
          </div>
        )}
      </div>

      {/* New Message Modal */}
      <div class={`modal-overlay${modalOpen.value ? " show" : ""}`} onClick={(e) => { if (e.target === e.currentTarget) modalOpen.value = false; }}>
        <div class="modal">
          <div class="modal-header">
            <h3>New Message</h3>
            <button class="modal-close" onClick={() => { modalOpen.value = false; }}>&times;</button>
          </div>
          <div class="modal-search">
            <input
              type="text"
              placeholder="Search users..."
              value={modalSearch.value}
              onInput={(e) => { modalSearch.value = (e.target as HTMLInputElement).value; }}
              autoFocus={modalOpen.value}
            />
          </div>
          <div class="modal-list">
            {filteredModalUsers.value.length === 0 ? (
              <div class="modal-empty">No users found</div>
            ) : (
              filteredModalUsers.value.map((u) => (
                <div
                  class="modal-user"
                  key={u.email}
                  onClick={() => {
                    modalOpen.value = false;
                    openConversation(u.email);
                  }}
                >
                  <div class="modal-avatar">{initial(u.email)}</div>
                  <div class="mu-info">
                    <div class="mu-email">{u.email}</div>
                  </div>
                  <div class="mu-role">{u.role}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
