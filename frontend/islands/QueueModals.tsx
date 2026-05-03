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
  const pendingFinalizeRef = useRef<{ findingId: string; reviewer: string }>({ findingId: "", reviewer: "" });

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

    // ── Confirm-then-finalize overlay ──
    // Listen for the audit-complete signal fired by DecideEffects AFTER the
    // final decision has been recorded. User types YES, we call /api/review/finalize
    // which applies flips, recomputes score, fires the terminate webhook (email).

    function onAuditComplete(e: Event) {
      const detail = (e as CustomEvent).detail as { findingId?: string; reviewer?: string } | undefined;
      if (!detail?.findingId || !detail?.reviewer) return;
      pendingFinalizeRef.current = { findingId: detail.findingId, reviewer: detail.reviewer };
      if (confirmOverlayRef.current) {
        confirmOverlayRef.current.style.display = "flex";
        if (confirmInputRef.current) {
          confirmInputRef.current.value = "";
          setTimeout(() => confirmInputRef.current?.focus(), 40);
        }
      }
    }
    document.addEventListener("queue:audit-complete", onAuditComplete);

    function cancelConfirm() {
      if (confirmOverlayRef.current) confirmOverlayRef.current.style.display = "none";
      pendingFinalizeRef.current = { findingId: "", reviewer: "" };
    }

    async function submitConfirm() {
      const typed = (confirmInputRef.current?.value ?? "").trim().toUpperCase();
      if (typed !== "YES") return;
      const { findingId, reviewer } = pendingFinalizeRef.current;
      if (!findingId || !reviewer) { cancelConfirm(); return; }
      // Show "Submitting..." in the modal so user knows finalize is in flight
      const submitBtn = document.getElementById("queue-confirm-submit-btn") as HTMLButtonElement | null;
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Submitting..."; }
      try {
        await fetch("/api/review/finalize", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ findingId, reviewer }),
        });
      } catch (err) {
        console.error("[FINALIZE] call failed:", err);
      }
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Submit"; }
      cancelConfirm();
      // Completion celebration — confetti
      if (completionOverlayRef.current) {
        completionOverlayRef.current.style.display = "flex";
        spawnConfetti();
        setTimeout(() => {
          if (completionOverlayRef.current) completionOverlayRef.current.style.display = "none";
        }, 4000);
      }
      // Now load the next finding into the queue panel.
      // The decide handler returned a "pending" placeholder when auditComplete;
      // this swap replaces that placeholder with the next audit (or empty state).
      const htmxAny = (globalThis as Record<string, unknown>).htmx as { ajax?: (verb: string, path: string, opts: unknown) => void } | undefined;
      if (htmxAny?.ajax) {
        htmxAny.ajax("GET", `/api/review/next-fragment?reviewer=${encodeURIComponent(reviewer)}`, {
          target: "#queue-content",
          swap: "innerHTML",
        });
      } else {
        // Fallback if htmx isn't on globalThis: hard-reload the queue page
        globalThis.location.reload();
      }
    }

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
      if (e.key === "Enter") { e.preventDefault(); void submitConfirm(); }
    };
    confirmInput?.addEventListener("keydown", onConfirmKey);

    // Submit click → fires custom event from JSX onClick → handle here
    const onFinalizeSubmit = () => { void submitConfirm(); };
    document.addEventListener("queue:finalize-submit", onFinalizeSubmit);

    return () => {
      document.removeEventListener("queue:cheat-sheet-toggle", onCheat);
      document.removeEventListener("queue:audit-complete", onAuditComplete);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("queue:finalize-submit", onFinalizeSubmit);
      confirmInput?.removeEventListener("keydown", onConfirmKey);
    };
  }, [cheatOpen]);

  return (
    <>
      {/* Confirmation overlay — port of prod's main:shared/queue-page.ts:1075 */}
      <div ref={confirmOverlayRef} class="queue-overlay" style="display:none">
        <div class="queue-overlay-box">
          <h3 class="queue-overlay-title">Final Question for This Audit</h3>
          <p class="queue-overlay-body">
            This is the last item for this audit. Submitting will finalize the review.
          </p>
          <div class="queue-overlay-label">Type YES to proceed</div>
          <input
            ref={confirmInputRef}
            type="text"
            class="queue-overlay-input"
            autoComplete="off"
            spellcheck={false}
          />
          <div class="queue-overlay-actions">
            <button
              type="button"
              class="queue-overlay-btn"
              onClick={() => {
                if (confirmOverlayRef.current) confirmOverlayRef.current.style.display = "none";
                pendingFinalizeRef.current = { findingId: "", reviewer: "" };
              }}
            >
              Cancel
            </button>
            <button
              id="queue-confirm-submit-btn"
              type="button"
              class="queue-overlay-btn primary"
              onClick={() => {
                document.dispatchEvent(new CustomEvent("queue:finalize-submit"));
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
