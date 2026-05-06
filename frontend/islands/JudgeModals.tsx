/** Island: judge-only modals.
 *  Currently: Dismiss Appeal. (Re-audit / Add Genie modal deferred — backend
 *  pipeline for appealSourceFindingId new-finding isn't ported to this branch.)
 *
 *  Listens for `queue:dismiss-appeal-open` (fired when the Dismiss button in
 *  VerdictPanel is clicked). Reads hx-findingId and hx-email to submit.
 */
import { useEffect, useRef, useState } from "preact/hooks";

export default function JudgeModals() {
  const [open, setOpen] = useState(false);
  const [findingId, setFindingId] = useState<string>("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const openModalWithFid = (fidArg?: string | null) => {
      const fid = fidArg
        || (document.getElementById("hx-findingId") as HTMLInputElement | null)?.value
        || "";
      setFindingId(fid);
      setOpen(true);
      setTimeout(() => textareaRef.current?.focus(), 40);
    };

    // The Dismiss Appeal button in VerdictPanel is server-rendered; its onClick
    // never hydrates because VerdictPanel isn't an island. Listen via document-
    // level click delegation against the data-action attribute instead — the
    // listener survives every HTMX swap because it's anchored on `document`.
    const onDismissBtnClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const btn = target?.closest<HTMLElement>('[data-action="dismiss-appeal"]');
      if (!btn) return;
      e.preventDefault();
      openModalWithFid(btn.dataset.findingId);
    };

    // Defensive — anything still firing the legacy CustomEvent path keeps working.
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent).detail as { findingId?: string } | undefined;
      openModalWithFid(detail?.findingId);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        e.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener("click", onDismissBtnClick);
    document.addEventListener("queue:dismiss-appeal-open", onOpen);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDismissBtnClick);
      document.removeEventListener("queue:dismiss-appeal-open", onOpen);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!open) return null;

  const judgeEmail = (document.getElementById("hx-email") as HTMLInputElement | null)?.value ?? "";

  function submit() {
    const reason = (textareaRef.current?.value ?? "").trim();
    // Backend expects `dismissalReason` (matches prod) — empty string means
    // dismiss without firing the email webhook.
    const payload: Record<string, string> = { findingId, judge: judgeEmail };
    if (reason) payload.dismissalReason = reason;
    // @ts-ignore - htmx global
    if (typeof htmx !== "undefined") {
      // @ts-ignore
      htmx.ajax("POST", "/api/judge/dismiss-appeal", {
        target: "#queue-content",
        swap: "innerHTML",
        values: payload,
      });
    }
    setOpen(false);
  }

  return (
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
          <button type="button" class="queue-overlay-btn primary" onClick={submit}>Dismiss</button>
        </div>
      </div>
    </div>
  );
}
