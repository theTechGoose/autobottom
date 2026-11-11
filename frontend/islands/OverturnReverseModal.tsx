/** Island: the Reverse Overturn comment modal (REQ-049). Reversing an
 *  overturn upholds the original fail, so it needs the judge's comment — the
 *  same "reason required" modal the judge queue's Uphold uses. Nothing is
 *  recorded until Submit; Go Back cancels.
 *
 *  The button lives in the server-rendered OverturnReviewPanel, so its click is
 *  caught by document-level delegation on data-action="overturn-reverse",
 *  which survives every HTMX swap. */
import { useEffect, useRef, useState } from "preact/hooks";

export default function OverturnReverseModal() {
  const [open, setOpen] = useState(false);
  const [fid, setFid] = useState("");
  const [qidx, setQidx] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-action="overturn-reverse"]');
      if (!btn) return;
      e.preventDefault();
      setFid(btn.dataset.findingId ?? "");
      setQidx(btn.dataset.questionIndex ?? "");
      setName(btn.dataset.questionName || "this question");
      setNote("");
      setOpen(true);
      setTimeout(() => inputRef.current?.focus(), 40);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  function submit() {
    const text = note.trim();
    if (!text) return;
    // @ts-ignore - htmx global
    if (typeof htmx !== "undefined") {
      // @ts-ignore
      htmx.ajax("POST", "/api/judge/overturn-review/decide", {
        target: "#ovr-content",
        swap: "innerHTML",
        values: { findingId: fid, questionIndex: qidx, verdict: "reverse", note: text },
      });
    }
    setOpen(false);
  }

  if (!open) return null;
  return (
    <div class="queue-overlay" onClick={() => setOpen(false)}>
      <div class="queue-overlay-box ovr-reverse-modal" onClick={(e) => e.stopPropagation()} style="max-width:560px">
        <div class="queue-overlay-title">Reverse Overturn — Comment Required</div>
        <div class="queue-overlay-body" style="text-align:left">
          Reversing upholds the original fail on <strong>{name}</strong>. Tell the team member why it
          failed — this is sent to them in the appeal result email.
        </div>
        <textarea
          ref={inputRef}
          class="queue-overlay-input"
          rows={5}
          value={note}
          onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
          placeholder="Explain why this question did not pass…"
          style="text-align:left; font-family:inherit; resize:vertical; min-height:96px"
        />
        <div class="queue-overlay-actions">
          <button type="button" class="queue-overlay-btn" onClick={() => setOpen(false)}>Go Back</button>
          <button type="button" class="queue-overlay-btn primary" disabled={!note.trim()} onClick={submit}>
            Submit &amp; Reverse
          </button>
        </div>
      </div>
    </div>
  );
}
