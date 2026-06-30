/** Island: judge-only modals.
 *    1. Dismiss Appeal — removes the finding from the queue (optional reason).
 *    2. Uphold — REQUIRES the judge to type why the team member failed this
 *       question. Nothing is committed until Submit; "Go Back" cancels with no
 *       decision recorded. The typed reason flows to the appeal-result email's
 *       "Failed Questions" section.
 *
 *  Both buttons in VerdictPanel are server-rendered (the panel isn't an island),
 *  so their clicks are caught via document-level delegation on the data-action
 *  attribute — the listeners survive every HTMX swap because they're anchored on
 *  `document`.
 */
import { useEffect, useRef, useState } from "preact/hooks";

export default function JudgeModals() {
  // Dismiss-appeal modal
  const [open, setOpen] = useState(false);
  const [findingId, setFindingId] = useState<string>("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Uphold modal
  const [upOpen, setUpOpen] = useState(false);
  const [upFid, setUpFid] = useState<string>("");
  const [upQidx, setUpQidx] = useState<string>("");
  const [upName, setUpName] = useState<string>("");
  const [upReason, setUpReason] = useState<string>("");
  const upInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const openDismiss = (fidArg?: string | null) => {
      const fid = fidArg
        || (document.getElementById("hx-findingId") as HTMLInputElement | null)?.value
        || "";
      setFindingId(fid);
      setOpen(true);
      setTimeout(() => textareaRef.current?.focus(), 40);
    };

    const openUphold = (btn: HTMLElement) => {
      setUpFid(btn.dataset.findingId
        || (document.getElementById("hx-findingId") as HTMLInputElement | null)?.value
        || "");
      setUpQidx(btn.dataset.questionIndex
        || (document.getElementById("hx-questionIndex") as HTMLInputElement | null)?.value
        || "0");
      setUpName(btn.dataset.questionName || "this question");
      setUpReason("");
      setUpOpen(true);
      setTimeout(() => upInputRef.current?.focus(), 40);
    };

    const onBtnClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const dismissBtn = target?.closest<HTMLElement>('[data-action="dismiss-appeal"]');
      if (dismissBtn) { e.preventDefault(); openDismiss(dismissBtn.dataset.findingId); return; }
      const upholdBtn = target?.closest<HTMLElement>('[data-action="judge-uphold"]');
      if (upholdBtn) { e.preventDefault(); openUphold(upholdBtn); return; }
    };

    // Defensive — legacy CustomEvent path keeps working.
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent).detail as { findingId?: string } | undefined;
      openDismiss(detail?.findingId);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (upOpen) { e.preventDefault(); setUpOpen(false); }
        else if (open) { e.preventDefault(); setOpen(false); }
      }
    };
    document.addEventListener("click", onBtnClick);
    document.addEventListener("queue:dismiss-appeal-open", onOpen);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onBtnClick);
      document.removeEventListener("queue:dismiss-appeal-open", onOpen);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, upOpen]);

  const judgeEmail = (document.getElementById("hx-email") as HTMLInputElement | null)?.value ?? "";

  function submitDismiss() {
    const reason = (textareaRef.current?.value ?? "").trim();
    const payload: Record<string, string> = { findingId, judge: judgeEmail };
    if (reason) payload.dismissalReason = reason;
    // @ts-ignore - htmx global
    if (typeof htmx !== "undefined") {
      // @ts-ignore
      htmx.ajax("POST", "/api/judge/dismiss-appeal", { target: "#queue-content", swap: "innerHTML", values: payload });
    }
    setOpen(false);
  }

  function submitUphold() {
    const reason = upReason.trim();
    if (!reason) return; // block on empty — nothing committed
    // @ts-ignore - htmx global
    if (typeof htmx !== "undefined") {
      // @ts-ignore
      htmx.ajax("POST", "/api/judge/decide", {
        target: "#queue-content",
        swap: "innerHTML",
        values: { findingId: upFid, questionIndex: upQidx, decision: "uphold", judge: judgeEmail, reason },
      });
    }
    setUpOpen(false);
  }

  return (
    <>
      {open && (
        <div class="queue-overlay" onClick={() => setOpen(false)}>
          <div class="queue-overlay-box" onClick={(e) => e.stopPropagation()} style="max-width:520px">
            <div class="queue-overlay-title">Dismiss Appeal</div>
            <div class="queue-overlay-body" style="text-align:left">
              This removes the finding from the judge queue without overturning
              any question. The reason below is recorded for audit.
            </div>
            <textarea
              ref={textareaRef}
              class="queue-overlay-input"
              rows={4}
              placeholder="Reason for dismissal (optional)…"
              style="text-align:left; font-family:inherit; resize:vertical; min-height:80px"
            />
            <div class="queue-overlay-actions">
              <button type="button" class="queue-overlay-btn" onClick={() => setOpen(false)}>Cancel</button>
              <button type="button" class="queue-overlay-btn primary" onClick={submitDismiss}>Dismiss</button>
            </div>
          </div>
        </div>
      )}

      {upOpen && (
        <div class="queue-overlay" onClick={() => setUpOpen(false)}>
          <div class="queue-overlay-box" onClick={(e) => e.stopPropagation()} style="max-width:560px">
            <div class="queue-overlay-title">Uphold — Reason Required</div>
            <div class="queue-overlay-body" style="text-align:left">
              Tell the team member why they failed the{" "}
              <strong>{upName}</strong> question. This is sent to them in the
              appeal-result email.
            </div>
            <textarea
              ref={upInputRef}
              class="queue-overlay-input"
              rows={5}
              value={upReason}
              onInput={(e) => setUpReason((e.target as HTMLTextAreaElement).value)}
              placeholder="Explain why this question did not pass…"
              style="text-align:left; font-family:inherit; resize:vertical; min-height:96px"
            />
            <div class="queue-overlay-actions">
              <button type="button" class="queue-overlay-btn" onClick={() => setUpOpen(false)}>Go Back</button>
              <button
                type="button"
                class="queue-overlay-btn primary"
                disabled={!upReason.trim()}
                onClick={submitUphold}
              >
                Submit &amp; Uphold
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
