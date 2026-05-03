/** Subscribes to htmx:afterSwap and spawns visual effects when a decide
 *  response lands a #decide-effect-marker in the DOM. Mirrors prod's
 *  post-decision UX: decision toast, floating +N XP text, streak banner
 *  on combo milestones, and an audit-complete overlay with summary stats
 *  when all items for an audit are decided. */
import { useEffect } from "preact/hooks";

export default function DecideEffects() {
  useEffect(() => {
    let combo = 0;
    let comboTimeout: number | undefined;
    let confirms = 0;
    let flips = 0;

    // Last-seen decision coordinates — captured on click so we know where
    // to spawn the floating XP number. HTMX swap happens after the click.
    let lastClickX: number | null = null;
    let lastClickY: number | null = null;

    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const btn = target.closest<HTMLElement>(".verdict-btn");
      if (btn) {
        lastClickX = e.clientX;
        lastClickY = e.clientY;
      }
    };
    document.addEventListener("click", onClick);

    const toast = (msg: string, cls: string) => {
      let container = document.getElementById("toast-container");
      if (!container) {
        container = document.createElement("div");
        container.id = "toast-container";
        document.body.appendChild(container);
      }
      const t = document.createElement("div");
      t.className = `toast ${cls}`;
      t.textContent = msg;
      container.appendChild(t);
      setTimeout(() => t.remove(), 1600);
    };

    const floatXp = (amount: number) => {
      if (amount <= 0) return;
      const el = document.createElement("div");
      el.className = "float-xp";
      el.textContent = `+${amount} XP`;
      const x = lastClickX ?? (window.innerWidth / 2);
      const y = lastClickY ?? (window.innerHeight / 2);
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 600);
    };

    const streakBanner = (text: string, cls: string) => {
      const el = document.createElement("div");
      el.className = `streak-banner ${cls}`;
      el.textContent = text;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 1300);
    };

    const onSwap = (_e: Event) => {
      const marker = document.getElementById("decide-effect-marker");
      if (!marker) return;
      const decision = marker.dataset.decision ?? "";
      const xp = Number(marker.dataset.xpGained ?? "0");
      const auditComplete = marker.dataset.auditComplete === "true";
      const findingId = marker.dataset.findingId ?? "";
      const reviewer = marker.dataset.reviewer ?? "";

      // Toast per decision type
      if (decision === "confirm") { toast("Confirmed fail", "toast-confirm"); confirms++; }
      else if (decision === "flip") { toast("Flipped to pass", "toast-flip"); flips++; }
      else if (decision === "uphold") { toast("Upheld", "toast-confirm"); confirms++; }
      else if (decision === "overturn") { toast("Overturned", "toast-flip"); flips++; }

      if (xp > 0) floatXp(xp);

      // Combo tracking — resets after 5s of inactivity.
      combo++;
      if (comboTimeout) clearTimeout(comboTimeout);
      comboTimeout = setTimeout(() => { combo = 0; }, 5000);
      if (combo === 5) streakBanner("Double Strike", "s-double");
      else if (combo === 10) streakBanner("Triple Strike", "s-triple");
      else if (combo === 15) streakBanner("MEGA", "s-mega");
      else if (combo === 20) streakBanner("ULTRA", "s-ultra");
      else if (combo === 25) streakBanner("RAMPAGE", "s-rampage");

      if (auditComplete && findingId && reviewer) {
        // Hand off to QueueModals, which shows the "type YES" confirm
        // modal and posts /api/review/finalize when the user accepts.
        document.dispatchEvent(new CustomEvent("queue:audit-complete", {
          detail: { findingId, reviewer, confirms, flips },
        }));
        // Reset per-audit counts for the next audit.
        confirms = 0; flips = 0;
      }

      // One-shot marker — remove so a future swap without a decide body
      // (e.g. undo) doesn't re-fire.
      marker.remove();
    };
    document.addEventListener("htmx:afterSwap", onSwap);

    // Bug 4 — flip data-busy on the Y/N container while a decide POST is
    // in flight, so CSS shows the "Processing…" overlay over the buttons.
    const isDecidePath = (e: Event) => {
      const detail = (e as CustomEvent).detail as { pathInfo?: { requestPath?: string }; requestConfig?: { path?: string } } | undefined;
      const path = detail?.pathInfo?.requestPath ?? detail?.requestConfig?.path ?? "";
      return path.startsWith("/api/review/") || path.startsWith("/api/judge/");
    };
    const onBefore = (e: Event) => {
      if (!isDecidePath(e)) return;
      const el = document.getElementById("decide-buttons");
      if (el) el.setAttribute("data-busy", "true");
    };
    const onAfter = (e: Event) => {
      if (!isDecidePath(e)) return;
      const el = document.getElementById("decide-buttons");
      if (el) el.removeAttribute("data-busy");
    };
    document.addEventListener("htmx:beforeRequest", onBefore);
    document.addEventListener("htmx:afterRequest", onAfter);

    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("htmx:afterSwap", onSwap);
      document.removeEventListener("htmx:beforeRequest", onBefore);
      document.removeEventListener("htmx:afterRequest", onAfter);
      if (comboTimeout) clearTimeout(comboTimeout);
    };
  }, []);

  return null;
}
