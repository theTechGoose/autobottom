/** ReviewTiming — flags idle questions so the server can discard them.
 *
 *  Durations are measured server-side (gap between consecutive decisions); this
 *  island only reports how much IDLE time accrued on the current question — the
 *  tab being hidden, or >60s with no mouse/hover/key/scroll activity. The server
 *  discards a question from handle-time stats once idleMs ≥ 60s, so someone who
 *  parks an audit and walks away (under the 15-min break clamp) is still excluded.
 *
 *  Injects `idleMs` into the /api/review/decide request (htmx:configRequest, which
 *  fires for button clicks AND the y/n hotkey path). The deferred final-question
 *  commit in QueueModals reads globalThis.__reviewTiming(). Must live in the
 *  /review page SSR so Fresh hydrates it (gotcha #1). */
import { useEffect } from "preact/hooks";

const IDLE_GRACE_MS = 60_000;
const TICK_MS = 1_000;

export default function ReviewTiming() {
  useEffect(() => {
    const cur = { key: "", idleMs: 0, lastActivityAt: Date.now() };

    const readKey = (): string => {
      const fid = (document.getElementById("hx-findingId") as HTMLInputElement | null)?.value ?? "";
      const qi = (document.getElementById("hx-questionIndex") as HTMLInputElement | null)?.value ?? "";
      return fid && qi !== "" ? `${fid}:${qi}` : "";
    };
    const resetTo = (key: string) => { cur.key = key; cur.idleMs = 0; cur.lastActivityAt = Date.now(); };
    resetTo(readKey());

    const bump = () => { cur.lastActivityAt = Date.now(); };
    const activityEvents = ["mousemove", "pointermove", "mousedown", "keydown", "scroll", "wheel", "touchstart"];
    activityEvents.forEach((ev) => globalThis.addEventListener(ev, bump, { passive: true, capture: true }));

    let lastTick = Date.now();
    const tick = () => {
      const now = Date.now();
      const dt = now - lastTick;
      lastTick = now;
      // Accrue idle when the tab is hidden or there's been no activity past the grace.
      if (document.hidden || (now - cur.lastActivityAt > IDLE_GRACE_MS)) cur.idleMs += dt;
    };
    const tickHandle = setInterval(tick, TICK_MS);

    const onSwap = () => {
      const key = readKey();
      if (key && key !== cur.key) resetTo(key);
    };
    document.addEventListener("htmx:afterSwap", onSwap);

    const onConfig = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { path?: string; parameters?: Record<string, unknown>; requestConfig?: { path?: string } }
        | undefined;
      if (!detail?.parameters) return;
      const path = String(detail.path ?? detail.requestConfig?.path ?? "");
      if (!path.startsWith("/api/review/decide")) return;
      tick();
      detail.parameters.idleMs = String(Math.round(cur.idleMs));
    };
    document.addEventListener("htmx:configRequest", onConfig);

    (globalThis as unknown as { __reviewTiming?: () => { idleMs: number } }).__reviewTiming = () => {
      tick();
      return { idleMs: Math.round(cur.idleMs) };
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
