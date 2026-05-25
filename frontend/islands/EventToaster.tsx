/** EventToaster — global island mounted from Layout.
 *  Opens an EventSource to /api/events/stream and:
 *    • renders broadcast events as toasts (top-right stack)
 *    • plays a sound for events whose payload carries an `animationId`
 *      (resolved against the static STORE_CATALOG)
 *    • increments a tiny unread-count badge on the Chat sidebar link when
 *      a `message-received` app event arrives
 *
 *  Falls back to polling /api/events?since=<lastTs> at 10s intervals when
 *  the stream errors or disconnects for >10s — matches the legacy refresh
 *  cadence so we never amplify Firestore reads beyond what the old
 *  HTMX polling cost. */

import { useEffect, useState, useRef } from "preact/hooks";
import { STORE_CATALOG } from "@gamification/domain/business/badge-system/mod.ts";

interface ToastItem {
  id: string;
  type: string;
  message: string;
  ts: number;
  triggerEmail?: string;
}

const TOAST_TTL_MS = 4_500;
const FALLBACK_POLL_MS = 10_000;
const RECONNECT_BACKOFF_MS = 3_000;

const TYPE_ACCENT: Record<string, string> = {
  badge_earned: "#f59e0b",
  perfect_score: "#22c55e",
  level_up: "#a855f7",
  streak_milestone: "#f97316",
  sale_completed: "#3b82f6",
  ten_audits_day: "#f97316",
  queue_cleared: "#22c55e",
  weekly_accuracy_100: "#22c55e",
};

const TYPE_ICON: Record<string, string> = {
  badge_earned: "🏅",
  perfect_score: "💯",
  level_up: "⬆️",
  streak_milestone: "🔥",
  sale_completed: "💰",
  ten_audits_day: "🔥",
  queue_cleared: "🗡️",
  weekly_accuracy_100: "🎯",
};

interface BroadcastPayload {
  id?: string;
  type?: string;
  triggerEmail?: string;
  displayName?: string;
  message?: string;
  animationId?: string | null;
  ts?: number;
}

function findStoreItem(id: string | null | undefined) {
  if (!id) return undefined;
  return STORE_CATALOG.find((i) => i.id === id);
}

function bumpChatBadge() {
  // Sidebar Chat link uses a constrained query — find the anchor by href.
  // Falls back silently if the badge container can't be found.
  const link = document.querySelector('a[href="/chat"]') as HTMLAnchorElement | null;
  if (!link) return;
  let badge = link.querySelector(".sb-chat-badge") as HTMLSpanElement | null;
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "sb-chat-badge";
    badge.style.cssText =
      "background:var(--cyan,#39d0d8);color:#fff;border-radius:9px;font-size:9px;font-weight:700;padding:1px 6px;margin-left:6px;";
    badge.textContent = "1";
    link.appendChild(badge);
    return;
  }
  const n = parseInt(badge.textContent ?? "0", 10) || 0;
  badge.textContent = String(n + 1);
}

export default function EventToaster() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sinceRef = useRef<number>(Date.now());

  function pushToast(t: ToastItem) {
    setToasts((prev) => [...prev, t]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== t.id));
    }, TOAST_TTL_MS);
  }

  function playForAnimation(animationId: string | null | undefined) {
    const item = findStoreItem(animationId);
    if (!item) return;
    // The STORE_CATALOG `animation` items don't carry a sound URL today —
    // play a short distinctive tone keyed off the animation rarity instead.
    // This keeps the feature working end-to-end without piping a fresh URL
    // through; a future enhancement attaches sound URLs to store items.
    const freq = item.rarity === "legendary" ? 1568 :
                 item.rarity === "epic" ? 1319 :
                 item.rarity === "rare" ? 1175 :
                 item.rarity === "uncommon" ? 988 : 880;
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
      const ctx = audioCtxRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    } catch { /* audio context not yet allowed */ }
  }

  useEffect(() => {
    let es: EventSource | null = null;
    let pollTimer: number | null = null;
    let reconnectTimer: number | null = null;

    function handleBroadcast(payload: BroadcastPayload) {
      if (!payload) return;
      pushToast({
        id: payload.id ?? `${payload.ts ?? Date.now()}-${Math.random()}`,
        type: payload.type ?? "event",
        message: payload.message ?? "",
        ts: payload.ts ?? Date.now(),
        triggerEmail: payload.triggerEmail,
      });
      playForAnimation(payload.animationId ?? null);
      sinceRef.current = Math.max(sinceRef.current, payload.ts ?? Date.now());
    }

    function handleAppEvent(type: string, _payload: unknown) {
      if (type === "message-received") bumpChatBadge();
    }

    async function pollOnce() {
      try {
        const r = await fetch(`/api/events?email=${encodeURIComponent(document.body.dataset.userEmail ?? "")}&since=${sinceRef.current}`, {
          headers: { "accept": "application/json" },
        });
        if (!r.ok) return;
        const j = await r.json() as { events?: { type: string; payload?: unknown; createdAt?: number }[]; broadcasts?: BroadcastPayload[] };
        for (const ev of j.broadcasts ?? []) handleBroadcast(ev);
        for (const ev of j.events ?? []) {
          handleAppEvent(ev.type, ev.payload);
          if (ev.createdAt) sinceRef.current = Math.max(sinceRef.current, ev.createdAt);
        }
      } catch { /* swallow — next tick will retry */ }
    }

    function startPolling() {
      if (pollTimer != null) return;
      pollTimer = setInterval(pollOnce, FALLBACK_POLL_MS) as unknown as number;
    }

    function stopPolling() {
      if (pollTimer != null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    function connect() {
      try {
        es = new EventSource("/api/events/stream");
        es.onopen = () => stopPolling();
        es.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data) as { channel: string; type: string; payload: unknown };
            if (msg.channel === "broadcast") handleBroadcast(msg.payload as BroadcastPayload);
            else if (msg.channel === "app") handleAppEvent(msg.type, msg.payload);
          } catch { /* ignore malformed frames */ }
        };
        es.onerror = () => {
          // EventSource auto-reconnects; engage polling as backup until the
          // next successful onopen.
          startPolling();
          if (reconnectTimer == null) {
            reconnectTimer = setTimeout(() => {
              reconnectTimer = null;
              if (es && es.readyState === EventSource.CLOSED) {
                try { es.close(); } catch { /* noop */ }
                es = null;
                connect();
              }
            }, RECONNECT_BACKOFF_MS) as unknown as number;
          }
        };
      } catch {
        startPolling();
      }
    }

    connect();

    return () => {
      try { es?.close(); } catch { /* noop */ }
      es = null;
      stopPolling();
      if (reconnectTimer != null) clearTimeout(reconnectTimer);
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      style="position:fixed;top:14px;right:14px;display:flex;flex-direction:column;gap:8px;z-index:9999;max-width:320px;pointer-events:none;"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          style={`pointer-events:auto;background:var(--bg-elev,#1a1d24);color:var(--text,#e6edf3);border-left:4px solid ${TYPE_ACCENT[t.type] ?? "var(--accent,#58a6ff)"};border-radius:6px;padding:10px 12px;box-shadow:0 4px 14px rgba(0,0,0,0.35);font-size:12px;display:flex;align-items:center;gap:10px;`}
        >
          <span style="font-size:20px;line-height:1;">{TYPE_ICON[t.type] ?? "✨"}</span>
          <span style="flex:1;line-height:1.3;">{t.message}</span>
        </div>
      ))}
    </div>
  );
}
