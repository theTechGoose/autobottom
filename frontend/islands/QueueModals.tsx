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
  const pendingFinalizeRef = useRef<{ findingId: string; reviewer: string; confirms: number; flips: number }>({ findingId: "", reviewer: "", confirms: 0, flips: 0 });
  // The final-question answer the reviewer chose but hasn't committed yet.
  // Cleared on Back-to-Audit (and on successful finalize). Persisted only when
  // the user types YES; until then, NOTHING is recorded server-side.
  const pendingFinalAnswerRef = useRef<{ findingId: string; questionIndex: number; decision: "confirm" | "flip"; reviewer: string } | null>(null);
  const completionStatsRef = useRef<HTMLDivElement>(null);

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

    function openConfirmOverlay() {
      if (!confirmOverlayRef.current) return;
      confirmOverlayRef.current.style.display = "flex";
      if (confirmInputRef.current) {
        confirmInputRef.current.value = "";
        setTimeout(() => confirmInputRef.current?.focus(), 40);
      }
    }

    function onAuditComplete(e: Event) {
      const detail = (e as CustomEvent).detail as { findingId?: string; reviewer?: string; confirms?: number; flips?: number } | undefined;
      if (!detail?.findingId || !detail?.reviewer) return;
      pendingFinalizeRef.current = {
        findingId: detail.findingId,
        reviewer: detail.reviewer,
        confirms: detail.confirms ?? 0,
        flips: detail.flips ?? 0,
      };
      openConfirmOverlay();
    }
    document.addEventListener("queue:audit-complete", onAuditComplete);

    // Intercept clicks on the final-question answer buttons. These render
    // WITHOUT hx-post (see VerdictPanel.tsx isLastForAudit branch), so we
    // open the YES-confirm modal here without recording anything yet. The
    // decision is committed only after the user types YES (see submitConfirm).
    function onFinalAnswerClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      const btn = target?.closest<HTMLElement>(".verdict-final-answer-btn");
      if (!btn) return;
      e.preventDefault();
      const findingId = btn.dataset.findingId ?? "";
      const reviewer = btn.dataset.reviewer ?? "";
      const decision = btn.dataset.finalDecision === "flip" ? "flip" : "confirm";
      const questionIndex = Number(btn.dataset.questionIndex ?? "0");
      const priorConfirms = Number(btn.dataset.priorConfirms ?? "0");
      const priorFlips = Number(btn.dataset.priorFlips ?? "0");
      if (!findingId || !reviewer) return;
      pendingFinalAnswerRef.current = { findingId, questionIndex, decision, reviewer };
      pendingFinalizeRef.current = {
        findingId,
        reviewer,
        confirms: priorConfirms + (decision === "confirm" ? 1 : 0),
        flips: priorFlips + (decision === "flip" ? 1 : 0),
      };
      openConfirmOverlay();
    }
    document.addEventListener("click", onFinalAnswerClick);

    function cancelConfirm() {
      if (confirmOverlayRef.current) confirmOverlayRef.current.style.display = "none";
      pendingFinalizeRef.current = { findingId: "", reviewer: "", confirms: 0, flips: 0 };
      pendingFinalAnswerRef.current = null;
    }

    async function submitConfirm() {
      const typed = (confirmInputRef.current?.value ?? "").trim().toUpperCase();
      if (typed !== "YES") return;
      const { findingId, reviewer, confirms, flips } = pendingFinalizeRef.current;
      if (!findingId || !reviewer) { cancelConfirm(); return; }
      // Show "Submitting..." in the modal so user knows finalize is in flight
      const submitBtn = document.getElementById("queue-confirm-submit-btn") as HTMLButtonElement | null;
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Submitting..."; }
      let scorePct = 0;
      try {
        // 1. Commit the held final-question decision (if any). For audits that
        //    reached this modal via the deferred-commit path, the last decision
        //    has NOT been written to review-decided yet — do it now. For audits
        //    that reached via the legacy path (htmx swap with auditComplete=true,
        //    e.g. server-driven finalize), pendingFinalAnswerRef is null and we
        //    skip directly to finalize.
        const finalAnswer = pendingFinalAnswerRef.current;
        if (finalAnswer) {
          const fd = new URLSearchParams({
            findingId: finalAnswer.findingId,
            questionIndex: String(finalAnswer.questionIndex),
            decision: finalAnswer.decision,
            reviewer: finalAnswer.reviewer,
          });
          const decideRes = await fetch("/api/review/decide", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            credentials: "include",
            body: fd.toString(),
          });
          if (!decideRes.ok) throw new Error(`decide failed: ${decideRes.status}`);
        }
        // 2. Finalize.
        const res = await fetch("/api/review/finalize", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ findingId, reviewer }),
        });
        const json = await res.json().catch(() => ({} as Record<string, unknown>));
        if (typeof json.score === "number") scorePct = Math.round(json.score);
      } catch (err) {
        console.error("[FINALIZE] sequence failed:", err);
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Submit & Finalize"; }
        return; // keep modal open so the user can retry
      }
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Submit & Finalize"; }
      cancelConfirm();
      // Audit Reviewed completion modal — match prod (✓ icon + counts + score + Next Audit btn)
      if (completionOverlayRef.current && completionStatsRef.current) {
        completionStatsRef.current.innerHTML =
          `<div class="queue-completion-counts"><span><strong>${confirms}</strong> confirmed</span><span class="queue-completion-sep">/</span><span><strong>${flips}</strong> flipped</span></div>` +
          `<div class="queue-completion-score">Score: <strong>${scorePct}%</strong></div>`;
        completionOverlayRef.current.style.display = "flex";
        spawnConfetti();
      }
    }

    // "Next Audit" button on completion modal → loads next finding via fragment
    function nextAudit() {
      if (completionOverlayRef.current) completionOverlayRef.current.style.display = "none";
      const reviewer = pendingFinalizeRef.current.reviewer
        || (document.getElementById("hx-email") as HTMLInputElement | null)?.value
        || "";
      // Pull the saved type filter the page rendered server-side. Empty
      // string = no filter (matches today's behaviour for unscoped reviewers).
      const typesCsv = (document.querySelector("[data-allowed-types]") as HTMLElement | null)
        ?.dataset.allowedTypes ?? "";
      const htmxAny = (globalThis as Record<string, unknown>).htmx as { ajax?: (verb: string, path: string, opts: unknown) => void } | undefined;
      if (htmxAny?.ajax) {
        htmxAny.ajax("GET", `/api/review/next-fragment?reviewer=${encodeURIComponent(reviewer)}&types=${encodeURIComponent(typesCsv)}`, {
          target: "#queue-content",
          swap: "innerHTML",
        });
      } else {
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
    const onNextAudit = () => nextAudit();
    document.addEventListener("queue:next-audit", onNextAudit);

    return () => {
      document.removeEventListener("queue:cheat-sheet-toggle", onCheat);
      document.removeEventListener("queue:audit-complete", onAuditComplete);
      document.removeEventListener("click", onFinalAnswerClick);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("queue:finalize-submit", onFinalizeSubmit);
      document.removeEventListener("queue:next-audit", onNextAudit);
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
                // Clear the held final-question decision so the user can pick
                // a different answer (or the same one) on the live final question.
                // Nothing was persisted server-side — the question is still open.
                pendingFinalAnswerRef.current = null;
                pendingFinalizeRef.current = { findingId: "", reviewer: "", confirms: 0, flips: 0 };
              }}
            >
              Back to Audit
            </button>
            <button
              id="queue-confirm-submit-btn"
              type="button"
              class="queue-overlay-btn primary"
              onClick={() => {
                document.dispatchEvent(new CustomEvent("queue:finalize-submit"));
              }}
            >
              Submit &amp; Finalize
            </button>
          </div>
          <div class="queue-overlay-discard">
            <button
              type="button"
              class="queue-overlay-discard-link"
              onClick={async () => {
                const { findingId, reviewer } = pendingFinalizeRef.current;
                if (!findingId || !reviewer) {
                  if (confirmOverlayRef.current) confirmOverlayRef.current.style.display = "none";
                  return;
                }
                if (!globalThis.confirm("Discard this audit? All decisions you've recorded will be cleared and the audit returns to the queue.")) return;
                try {
                  const fd = new FormData();
                  fd.append("findingId", findingId);
                  fd.append("reviewer", reviewer);
                  await fetch("/api/review/discard", { method: "POST", credentials: "include", body: fd });
                } catch (err) {
                  console.error("[DISCARD] call failed:", err);
                }
                globalThis.location.href = "/review/dashboard";
              }}
            >
              Discard This Audit
            </button>
          </div>
        </div>
      </div>

      {/* Audit completion overlay — matches prod's "Audit Reviewed" card */}
      <div ref={completionOverlayRef} class="queue-overlay completion" style="display:none">
        <div class="queue-overlay-box queue-completion-box">
          <div class="queue-completion-check">
            <svg viewBox="0 0 24 24" width="32" height="32" aria-hidden="true">
              <circle cx="12" cy="12" r="11" fill="#22c55e" />
              <path d="M7 12l4 4 7-8" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </div>
          <h3 class="queue-overlay-title">Audit Reviewed</h3>
          <div ref={completionStatsRef} class="queue-completion-stats" />
          <button
            type="button"
            class="queue-overlay-btn primary queue-completion-next"
            onClick={() => document.dispatchEvent(new CustomEvent("queue:next-audit"))}
          >Next Audit</button>
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
