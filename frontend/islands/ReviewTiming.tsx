/** ReviewTiming — measures how long a reviewer actively spends on each question.
 *
 *  The review UI shows one question at a time; this island accumulates the
 *  ACTIVE (non-idle) time for the current question and the IDLE time, then
 *  injects them into the `/api/review/decide` request (handleMs / idleMs) via
 *  htmx:configRequest. The backend discards a question from handle-time stats
 *  once idleMs ≥ 60s (someone walked away), so lunch breaks don't skew averages.
 *
 *  Idle = the tab is hidden (pauses immediately) OR no activity
 *  (mousemove/hover/key/scroll/touch) for IDLE_GRACE_MS while visible.
 *
 *  Must live in the /review page SSR so Fresh hydrates it (gotcha #1). The
 *  deferred final-question path in QueueModals reads globalThis.__reviewTiming(). */
import { useEffect } from "preact/hooks";

const IDLE_GRACE_MS = 60_000; // stillness past this (while visible) counts as idle
const TICK_MS = 1_000;

export default function ReviewTiming() {
  useEffect(() => {
    const cur = { key: "", activeMs: 0, idleMs: 0, lastActivityAt: Date.now() };

    const readKey = (): string => {
      const fid = (document.getElementById("hx-findingId") as HTMLInputElement | null)?.value ?? "";
      const qi = (document.getElementById("hx-questionIndex") as HTMLInputElement | null)?.value ?? "";
      return fid && qi !== "" ? `${fid}:${qi}` : "";
    };

    const resetTo = (key: string) => {
      cur.key = key;
      cur.activeMs = 0;
      cur.idleMs = 0;
      cur.lastActivityAt = Date.now();
    };

    // Initialise for the question already in the SSR'd page.
    resetTo(readKey());

    const bump = () => { cur.lastActivityAt = Date.now(); };
    const activityEvents = ["mousemove", "pointermove", "mousedown", "keydown", "scroll", "wheel", "touchstart"];
    activityEvents.forEach((ev) => globalThis.addEventListener(ev, bump, { passive: true, capture: true }));

    let lastTick = Date.now();
    const tick = () => {
      const now = Date.now();
      const dt = now - lastTick;
      lastTick = now;
      if (!cur.key) return;
      const idle = document.hidden || (now - cur.lastActivityAt > IDLE_GRACE_MS);
      if (idle) cur.idleMs += dt; else cur.activeMs += dt;
    };
    const tickHandle = setInterval(tick, TICK_MS);

    // New question swapped in (decide response, jump, or next) → start fresh.
    const onSwap = () => {
      const key = readKey();
      if (key && key !== cur.key) resetTo(key);
    };
    document.addEventListener("htmx:afterSwap", onSwap);

    // Inject the current question's timing into the decide request. Fires for
    // both button clicks and the y/n hotkey path (both go through HTMX).
    const onConfig = (e: Event) => {
      const detail = (e as CustomEvent).detail as { path?: string; parameters?: Record<string, unknown> } | undefined;
      if (!detail?.parameters) return;
      const path = String(detail.path ?? "");
      if (!path.startsWith("/api/review/decide")) return;
      tick(); // settle accumulators up to this instant
      detail.parameters.handleMs = String(Math.round(cur.activeMs));
      detail.parameters.idleMs = String(Math.round(cur.idleMs));
    };
    document.addEventListener("htmx:configRequest", onConfig);

    // For the deferred final-question commit (QueueModals does a manual fetch).
    (globalThis as unknown as { __reviewTiming?: () => { handleMs: number; idleMs: number } }).__reviewTiming = () => {
      tick();
      return { handleMs: Math.round(cur.activeMs), idleMs: Math.round(cur.idleMs) };
    };

    return () => {
      clearInterval(tickHandle);
      activityEvents.forEach((ev) => globalThis.removeEventListener(ev, bump, { capture: true } as EventListenerOptions));
      document.removeEventListener("htmx:afterSwap", onSwap);
      document.removeEventListener("htmx:configRequest", onConfig);
      delete (globalThis as unknown as { __reviewTiming?: unknown }).__reviewTiming;
    };
  }, []);

  return null;
}
