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

    const showAuditComplete = (c: number, f: number) => {
      const total = c + f;
      const rate = total > 0 ? Math.round((f / total) * 100) : 0;
      let overlay = document.getElementById("audit-complete-overlay");
      if (overlay) overlay.remove();
      overlay = document.createElement("div");
      overlay.id = "audit-complete-overlay";
      overlay.className = "open";
      overlay.innerHTML = `
        <div class="aco-box">
          <h2 style="font-size:18px;color:#e6edf3;margin-bottom:14px;">Audit reviewed 🎉</h2>
          <div class="aco-stats">
            <div><strong>${c}</strong> confirmed</div>
            <div><strong>${f}</strong> flipped</div>
            <div><strong>${rate}%</strong> flip rate</div>
          </div>
          <button class="aco-next">Next audit</button>
        </div>
      `;
      document.body.appendChild(overlay);
      overlay.querySelector<HTMLButtonElement>(".aco-next")?.addEventListener("click", () => {
        overlay!.remove();
        // Reset per-audit counts so the next audit's overlay is accurate.
        confirms = 0; flips = 0;
      });
    };

    const onSwap = (e: Event) => {
      const marker = document.getElementById("decide-effect-marker");
      if (!marker) return;
      const decision = marker.dataset.decision ?? "";
      const xp = Number(marker.dataset.xpGained ?? "0");
      const auditComplete = marker.dataset.auditComplete === "true";

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

      if (auditComplete) {
        showAuditComplete(confirms, flips);
      }

      // One-shot marker — remove so a future swap without a decide body
      // (e.g. undo) doesn't re-fire.
      marker.remove();
    };
    document.addEventListener("htmx:afterSwap", onSwap);

    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("htmx:afterSwap", onSwap);
      if (comboTimeout) clearTimeout(comboTimeout);
    };
  }, []);

  return null;
}
