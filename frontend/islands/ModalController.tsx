/** Island: Modal controller — opens/closes modals triggered from sidebar.
 *  Listens for [data-modal] clicks, manages .modal-overlay visibility,
 *  handles backdrop click to close. */
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

    // Sidebar items with data-modal attribute open modals
    document.addEventListener("click", (e) => {
      const trigger = (e.target as HTMLElement).closest("[data-modal]");
      if (trigger) {
        const modalId = trigger.getAttribute("data-modal");
        if (modalId) openModal(modalId);
        return;
      }

      // Backdrop click closes modal
      const overlay = (e.target as HTMLElement);
      if (overlay.classList.contains("modal-overlay") && overlay.classList.contains("open")) {
        overlay.classList.remove("open");
        return;
      }

      // Close button inside modal
      const closeBtn = (e.target as HTMLElement).closest("[data-close-modal]");
      if (closeBtn) {
        const modalId = closeBtn.getAttribute("data-close-modal");
        if (modalId) closeModal(modalId);
        else closeAllModals();
      }
    });

    // Escape key closes modals
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeAllModals();
    });

    // Expose globally for HTMX fragments
    (globalThis as any).__openModal = openModal;
    (globalThis as any).__closeModal = closeModal;
  }, []);

  return <div style="display:none" data-modal-controller></div>;
}
