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
      if (rvWrap) {
        const rvLink = target.closest(".sb-rv-wrap > .sb-link");
        if (rvLink) {
          e.preventDefault();
          e.stopPropagation();
          const flyout = rvWrap.querySelector(".sb-rv-flyout");
          if (flyout) {
            const isOpen = flyout.classList.contains("open");
            closeAllFlyouts();
            if (!isOpen) flyout.classList.add("open");
          }
          return;
        }
        // Click inside the flyout panel (on a link) — let it through
        return;
      }

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

    // Escape key closes modals and flyouts
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeAllModals();
        closeAllFlyouts();
      }
    });

    // Expose globally for HTMX fragments
    (globalThis as any).__openModal = openModal;
    (globalThis as any).__closeModal = closeModal;
  }, []);

  return <div style="display:none" data-modal-controller></div>;
}
