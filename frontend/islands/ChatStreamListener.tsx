/** ChatStreamListener — chat-page-only island that opens an EventSource to
 *  /api/chat/stream and dispatches a synthetic `new-chat-message` event on
 *  the document body whenever a new message arrives. The existing HTMX
 *  thread-fragment swap is wired to that event via `hx-trigger`, so the
 *  thread re-fetches in real-time instead of every-5s polling.
 *
 *  Falls back gracefully: if EventSource fails the legacy `every 5s`
 *  trigger on the same hx-target keeps refreshing the thread. */

import { useEffect } from "preact/hooks";

interface ChatStreamListenerProps { email: string }

export default function ChatStreamListener(_props: ChatStreamListenerProps) {
  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: number | null = null;

    function fireThreadRefresh() {
      try {
        const evt = new CustomEvent("new-chat-message");
        document.body.dispatchEvent(evt);
      } catch { /* noop */ }
    }

    function connect() {
      try {
        es = new EventSource("/api/chat/stream");
        es.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data) as { type?: string };
            if (msg.type === "new-message") fireThreadRefresh();
          } catch { /* ignore malformed */ }
        };
        es.onerror = () => {
          if (reconnectTimer != null) return;
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            if (es && es.readyState === EventSource.CLOSED) {
              try { es.close(); } catch { /* noop */ }
              es = null;
              connect();
            }
          }, 3000) as unknown as number;
        };
      } catch { /* noop — polling fallback already handles missing stream */ }
    }

    connect();

    return () => {
      try { es?.close(); } catch { /* noop */ }
      es = null;
      if (reconnectTimer != null) clearTimeout(reconnectTimer);
    };
  }, []);

  return <div style="display:none" data-chat-stream></div>;
}
