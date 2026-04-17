/** Island: modal + polish layer for review/judge queue pages.
 *  Three features:
 *    1. Confirmation overlay for the LAST undecided question in an audit —
 *       forces typing "YES" to submit, mirrors prod's showConfirmModal.
 *    2. Audit completion overlay + confetti burst when the audit is
 *       finished (detected by watching htmx:afterSwap for an empty queue).
 *    3. Keyboard cheat sheet (opened with `?`).
 *  Listens for custom events so it stays decoupled from VerdictPanel:
 *    - queue:cheat-sheet-toggle (fired by HotkeyHandler on `?`)
 *    - queue:confirm-last (when VerdictPanel detects isLast + user clicked
 *      confirm/flip — we intercept clicks on the last-item chip pulse) */
import { useEffect, useRef, useState } from "preact/hooks";

export default function QueueModals() {
  const [cheatOpen, setCheatOpen] = useState(false);
  const confirmOverlayRef = useRef<HTMLDivElement>(null);
  const completionOverlayRef = useRef<HTMLDivElement>(null);
  const confettiCanvasRef = useRef<HTMLCanvasElement>(null);
  const confirmInputRef = useRef<HTMLInputElement>(null);
  const pendingDecisionRef = useRef<{ button: HTMLButtonElement | null }>({ button: null });

  useEffect(() => {
    // ── Cheat sheet toggle ──
    const onCheat = () => setCheatOpen((v) => !v);
    document.addEventListener("queue:cheat-sheet-toggle", onCheat);

    // ── Confetti ──
    function spawnConfetti() {
      const canvas = confettiCanvasRef.current;
      if (!canvas) return;
      const W = canvas.width = globalThis.innerWidth;
      const H = canvas.height = globalThis.innerHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvas.style.display = "block";
      const colors = ["#8b5cf6", "#1f6feb", "#58a6ff", "#bc8cff", "#d29922"];
      const particles: Array<{ x: number; y: number; vx: number; vy: number; r: number; c: string; a: number }> = [];
      for (let i = 0; i < 120; i++) {
        particles.push({
          x: W / 2 + (Math.random() - 0.5) * 200,
          y: H / 3,
          vx: (Math.random() - 0.5) * 8,
          vy: Math.random() * -12 - 4,
          r: 3 + Math.random() * 5,
          c: colors[Math.floor(Math.random() * colors.length)],
          a: Math.random() * Math.PI * 2,
        });
      }
      const start = performance.now();
      function tick(now: number) {
        const t = (now - start) / 1500;
        if (t >= 1) {
          canvas!.style.display = "none";
          return;
        }
        ctx!.clearRect(0, 0, W, H);
        for (const p of particles) {
          p.vy += 0.35; // gravity
          p.x += p.vx;
          p.y += p.vy;
          p.a += 0.2;
          ctx!.save();
          ctx!.translate(p.x, p.y);
          ctx!.rotate(p.a);
          ctx!.fillStyle = p.c;
          ctx!.fillRect(-p.r, -p.r / 2, p.r * 2, p.r);
          ctx!.restore();
        }
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }

    // ── Confirm-last overlay ──
    // Intercept confirm/flip clicks when the "Final for audit/appeal" pulse
    // chip is present — that signals this is the last undecided question.
    function isLastForAudit(): boolean {
      return !!document.querySelector(".verdict-meta-chip.pulse");
    }

    // One-shot bypass. Submit re-dispatches the original click via
    // `btn.dispatchEvent(...)` — without this flag the capture-phase
    // interceptor below would re-catch that synthetic click (isLastForAudit
    // is still true since DOM hasn't swapped) and reopen the modal forever.
    let bypassNextVerdictClick = false;

    function onVerdictClick(e: Event) {
      if (bypassNextVerdictClick) { bypassNextVerdictClick = false; return; }
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const btn = target.closest<HTMLButtonElement>(".verdict-btn.confirm, .verdict-btn.flip, .verdict-btn.uphold, .verdict-btn.overturn");
      if (!btn) return;
      if (!isLastForAudit()) return;
      // Hold the click — show confirm overlay first
      e.preventDefault();
      e.stopImmediatePropagation();
      pendingDecisionRef.current.button = btn;
      if (confirmOverlayRef.current) {
        confirmOverlayRef.current.style.display = "flex";
        if (confirmInputRef.current) {
          confirmInputRef.current.value = "";
          setTimeout(() => confirmInputRef.current?.focus(), 40);
        }
      }
    }

    function cancelConfirm() {
      if (confirmOverlayRef.current) confirmOverlayRef.current.style.display = "none";
      pendingDecisionRef.current.button = null;
    }

    function submitConfirm() {
      const typed = (confirmInputRef.current?.value ?? "").trim().toUpperCase();
      if (typed !== "YES") return;
      const btn = pendingDecisionRef.current.button;
      cancelConfirm();
      if (btn) {
        // Flip bypass BEFORE dispatching so our own interceptor lets this
        // click pass through to HTMX's handler.
        bypassNextVerdictClick = true;
        btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true, detail: 1, relatedTarget: null }));
      }
    }

    // Expose bypass flag to the inline Submit onClick below.
    (confirmOverlayRef as unknown as { _setBypass?: () => void })._setBypass = () => { bypassNextVerdictClick = true; };

    // Use capture phase so we intercept BEFORE HTMX's click handler fires.
    document.addEventListener("click", onVerdictClick, true);

    // ── Audit completion overlay ──
    // Detected when an HTMX swap results in an empty queue (no .verdict-panel
    // or empty state rendered). Celebrate once per session to avoid loops.
    let justDecided = false;
    const onDecideClick = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest(".verdict-btn")) justDecided = true;
    };
    document.addEventListener("click", onDecideClick);

    const onSwap = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.target?.id !== "queue-content") return;
      if (!justDecided) return;
      justDecided = false;
      // Empty state renders with .verdict-empty — treat that as completion
      const empty = document.querySelector(".verdict-empty");
      if (empty && completionOverlayRef.current) {
        completionOverlayRef.current.style.display = "flex";
        spawnConfetti();
        setTimeout(() => {
          if (completionOverlayRef.current) completionOverlayRef.current.style.display = "none";
        }, 4000);
      }
    };
    document.addEventListener("htmx:afterSwap", onSwap);

    // Escape closes everything
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (cheatOpen) { setCheatOpen(false); return; }
      if (confirmOverlayRef.current?.style.display === "flex") { cancelConfirm(); return; }
      if (completionOverlayRef.current?.style.display === "flex") {
        completionOverlayRef.current.style.display = "none";
      }
    };
    document.addEventListener("keydown", onKey);

    // Wire confirm input Enter key
    const confirmInput = confirmInputRef.current;
    const onConfirmKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") { e.preventDefault(); submitConfirm(); }
    };
    confirmInput?.addEventListener("keydown", onConfirmKey);

    return () => {
      document.removeEventListener("queue:cheat-sheet-toggle", onCheat);
      document.removeEventListener("click", onVerdictClick, true);
      document.removeEventListener("click", onDecideClick);
      document.removeEventListener("htmx:afterSwap", onSwap);
      document.removeEventListener("keydown", onKey);
      confirmInput?.removeEventListener("keydown", onConfirmKey);
    };
  }, [cheatOpen]);

  return (
    <>
      {/* Confirmation overlay */}
      <div ref={confirmOverlayRef} class="queue-overlay" style="display:none">
        <div class="queue-overlay-box">
          <div class="queue-overlay-title">Final Question for This Audit</div>
          <div class="queue-overlay-body">
            This is the last item for this audit. Submitting will finalize the
            review. Type <strong>YES</strong> to confirm.
          </div>
          <input
            ref={confirmInputRef}
            type="text"
            class="queue-overlay-input"
            placeholder="type YES"
            autoComplete="off"
          />
          <div class="queue-overlay-actions">
            <button
              type="button"
              class="queue-overlay-btn"
              onClick={() => {
                if (confirmOverlayRef.current) confirmOverlayRef.current.style.display = "none";
                pendingDecisionRef.current.button = null;
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              class="queue-overlay-btn primary"
              onClick={() => {
                const typed = (confirmInputRef.current?.value ?? "").trim().toUpperCase();
                if (typed !== "YES") return;
                const btn = pendingDecisionRef.current.button;
                if (confirmOverlayRef.current) confirmOverlayRef.current.style.display = "none";
                pendingDecisionRef.current.button = null;
                // Signal the capture-phase interceptor to let this synthetic
                // click through; otherwise it re-opens the modal and nothing
                // ever posts to the decide endpoint.
                const setBypass = (confirmOverlayRef as unknown as { _setBypass?: () => void })._setBypass;
                setBypass?.();
                if (btn) btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true, detail: 1, relatedTarget: null }));
              }}
            >
              Submit
            </button>
          </div>
        </div>
      </div>

      {/* Audit completion overlay */}
      <div ref={completionOverlayRef} class="queue-overlay completion" style="display:none">
        <div class="queue-overlay-box">
          <div style="font-size:48px;margin-bottom:8px">🎉</div>
          <div class="queue-overlay-title">Audit Complete</div>
          <div class="queue-overlay-body">Great work! Next audit loading…</div>
        </div>
      </div>

      {/* Confetti canvas */}
      <canvas
        ref={confettiCanvasRef}
        class="queue-confetti"
        style="display:none"
      />

      {/* Cheat sheet */}
      {cheatOpen && (
        <div class="queue-cheat-sheet" onClick={() => setCheatOpen(false)}>
          <div class="queue-cheat-box" onClick={(e) => e.stopPropagation()}>
            <div class="queue-cheat-title">Keyboard Shortcuts</div>
            <div class="queue-cheat-grid">
              <div class="queue-cheat-section">
                <div class="queue-cheat-label">Decide</div>
                <div><kbd>Y</kbd> Confirm / Uphold</div>
                <div><kbd>N</kbd> Flip (review)</div>
                <div><kbd>A</kbd>/<kbd>S</kbd>/<kbd>D</kbd>/<kbd>F</kbd> Overturn reason (judge)</div>
                <div><kbd>B</kbd> Undo last</div>
              </div>
              <div class="queue-cheat-section">
                <div class="queue-cheat-label">Audio</div>
                <div><kbd>Space</kbd> or <kbd>P</kbd> Play / pause</div>
                <div><kbd>←</kbd>/<kbd>→</kbd> Seek ±5s</div>
                <div><kbd>↑</kbd>/<kbd>↓</kbd> Speed ±0.5×</div>
              </div>
              <div class="queue-cheat-section">
                <div class="queue-cheat-label">Transcript</div>
                <div><kbd>/</kbd> Search</div>
                <div><kbd>;</kbd> Next match</div>
                <div><kbd>H</kbd>/<kbd>J</kbd> Prev column</div>
                <div><kbd>K</kbd>/<kbd>L</kbd> Next column</div>
              </div>
              <div class="queue-cheat-section">
                <div class="queue-cheat-label">Other</div>
                <div><kbd>D</kbd> Toggle bot reasoning</div>
                <div><kbd>?</kbd> This sheet</div>
                <div><kbd>Esc</kbd> Close modal</div>
              </div>
            </div>
            <div class="queue-cheat-foot">click anywhere or press Esc to close</div>
          </div>
        </div>
      )}
    </>
  );
}
