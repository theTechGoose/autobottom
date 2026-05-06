/** Island: Modal controller — opens/closes modals triggered from sidebar.
 *  Listens for [data-modal] clicks, manages .modal-overlay visibility,
 *  handles backdrop click to close, Role Views flyout toggle, stepper buttons. */
import { useEffect } from "preact/hooks";

export default function ModalController() {
  useEffect(() => {
    function openModal(id: string) {
      const el = document.getElementById(id);
      if (el) {
        el.classList.add("open");
        // Load content via HTMX if modal has hx-trigger="modal-open"
        const content = el.querySelector("[hx-trigger='modal-open']");
        if (content) {
          // @ts-ignore — htmx loaded via CDN
          if (typeof htmx !== "undefined") htmx.trigger(content, "modal-open");
        }
      }
    }

    function closeModal(id: string) {
      document.getElementById(id)?.classList.remove("open");
    }

    function closeAllModals() {
      document.querySelectorAll(".modal-overlay.open").forEach(el => el.classList.remove("open"));
    }

    // Close any open flyouts
    function closeAllFlyouts() {
      document.querySelectorAll(".sb-rv-flyout.open").forEach(el => el.classList.remove("open"));
    }

    // Sidebar items with data-modal attribute open modals
    document.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const trigger = target.closest("[data-modal]");
      if (trigger) {
        const modalId = trigger.getAttribute("data-modal");
        if (modalId) openModal(modalId);
        return;
      }

      // Role Views flyout toggle on click
      const rvWrap = target.closest(".sb-rv-wrap");
      if (rvWrap && !target.closest(".sb-rv-flyout")) {
        e.preventDefault();
        e.stopPropagation();
        const flyout = rvWrap.querySelector(".sb-rv-flyout") as HTMLElement | null;
        if (flyout) {
          const isOpen = flyout.classList.contains("open");
          closeAllFlyouts();
          if (!isOpen) {
            // Position fixed flyout relative to the trigger
            const rect = rvWrap.getBoundingClientRect();
            flyout.style.left = `${rect.right + 8}px`;
            flyout.style.top = `${rect.top + rect.height / 2}px`;
            flyout.style.transform = "translateY(-50%)";
            flyout.classList.add("open");
          }
        }
        return;
      }
      // Click inside flyout panel (on a link) — let it navigate
      if (target.closest(".sb-rv-flyout")) return;

      // Click outside flyout closes it
      if (!target.closest(".sb-rv-flyout")) {
        closeAllFlyouts();
      }

      // Backdrop click closes modal
      const overlay = target;
      if (overlay.classList.contains("modal-overlay") && overlay.classList.contains("open")) {
        overlay.classList.remove("open");
        return;
      }

      // Close button inside modal
      const closeBtn = target.closest("[data-close-modal]");
      if (closeBtn) {
        const modalId = closeBtn.getAttribute("data-close-modal");
        if (modalId) closeModal(modalId);
        else closeAllModals();
      }
    });

    // Stepper buttons: [data-step] with data-target and data-dir
    document.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest("[data-step]") as HTMLElement | null;
      if (!btn) return;
      const targetId = btn.getAttribute("data-target");
      const dir = parseInt(btn.getAttribute("data-dir") ?? "1", 10);
      if (!targetId) return;
      const input = document.getElementById(targetId) as HTMLInputElement | null;
      if (!input) return;
      const min = parseInt(input.getAttribute("min") ?? "0", 10);
      const max = parseInt(input.getAttribute("max") ?? "999", 10);
      const current = parseInt(input.value, 10) || 0;
      const next = Math.max(min, Math.min(max, current + dir));
      input.value = String(next);
    });

    // Copy-to-clipboard buttons: [data-copy="<text>"]
    document.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest("[data-copy]") as HTMLElement | null;
      if (!btn) return;
      const text = btn.getAttribute("data-copy") ?? "";
      if (!text) return;
      navigator.clipboard.writeText(text).then(() => {
        const original = btn.textContent;
        btn.textContent = "Copied!";
        setTimeout(() => { btn.textContent = original; }, 1000);
      }).catch(() => { /* clipboard blocked */ });
    });

    // Escape key closes modals and flyouts
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeAllModals();
        closeAllFlyouts();
      }
    });

    // Refresh countdown indicator in the sidebar — shows next auto-refresh time.
    // Watches for HTMX swaps on any [hx-trigger*="every"] element and resets from
    // the interval declared in the trigger (falls back to 10s).
    const countdownEl = document.getElementById("refresh-countdown");
    if (countdownEl) {
      let secondsLeft = 10;
      const tick = () => {
        secondsLeft -= 1;
        if (secondsLeft <= 0) secondsLeft = 10;
        countdownEl.textContent = `Refresh in ${secondsLeft}s`;
      };
      const timer = setInterval(tick, 1000);
      // Reset countdown after any HTMX swap triggered by a recurring interval
      document.addEventListener("htmx:afterSwap", (evt) => {
        const target = (evt as CustomEvent).detail?.elt as HTMLElement | undefined;
        const trigger = target?.getAttribute("hx-trigger") ?? "";
        const match = trigger.match(/every\s+(\d+)s/);
        if (match) {
          secondsLeft = parseInt(match[1], 10);
          countdownEl.textContent = `Refresh in ${secondsLeft}s`;
        }
      });
      // Cleanup if island unmounts (shouldn't in practice but defensive)
      return () => clearInterval(timer);
    }

    // Expose globally for HTMX fragments
    (globalThis as any).__openModal = openModal;
    (globalThis as any).__closeModal = closeModal;
  }, []);

  return <div style="display:none" data-modal-controller></div>;
}
