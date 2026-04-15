/** Island: Chat message input with submit. */
import { useState, useRef } from "preact/hooks";

interface ChatInputProps {
  email: string;
  peer: string;
}

export default function ChatInput({ email, peer }: ChatInputProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await fetch("/api/chat/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from: email, to: peer, body }),
      });
      setText("");
      inputRef.current?.focus();
      // Trigger HTMX refresh of messages
      // @ts-ignore
      if (typeof htmx !== "undefined") htmx.trigger("#chat-messages", "load");
    } catch (e) {
      console.error("Send failed:", e);
    } finally {
      setSending(false);
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div class="chat-input-bar">
      <textarea
        ref={inputRef}
        class="chat-input"
        placeholder="Type a message..."
        value={text}
        onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
        onKeyDown={handleKeydown}
        rows={1}
        disabled={sending}
      />
      <button class="chat-send-btn" onClick={send} disabled={sending || !text.trim()}>
        {sending ? "..." : "Send"}
      </button>
    </div>
  );
}
