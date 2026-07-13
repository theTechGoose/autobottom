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
  // Screenshots pasted (Ctrl/Cmd+V) into the modal — previewed inline, uploaded
  // to S3 on submit, then embedded in the appeal-result email.
  const [upShots, setUpShots] = useState<Array<{ id: string; dataUrl: string; file: File }>>([]);
  const [upBusy, setUpBusy] = useState(false);
  const [upError, setUpError] = useState<string>("");
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
      setUpShots([]);
      setUpError("");
      setUpBusy(false);
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
    // Paste-to-attach: while the uphold modal is open, Ctrl/Cmd+V of an image
    // adds it as an inline preview. Text paste (no image in the clipboard) is
    // left alone so the reason textarea keeps working normally.
    const onPaste = (e: ClipboardEvent) => {
      if (!upOpen) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      const images: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.kind === "file" && it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) images.push(f);
        }
      }
      if (!images.length) return;
      e.preventDefault();
      for (const f of images) {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = String(reader.result ?? "");
          if (dataUrl) setUpShots((prev) => [...prev, { id: crypto.randomUUID(), dataUrl, file: f }]);
        };
        reader.readAsDataURL(f);
      }
    };
    document.addEventListener("click", onBtnClick);
    document.addEventListener("queue:dismiss-appeal-open", onOpen);
    document.addEventListener("keydown", onKey);
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("click", onBtnClick);
      document.removeEventListener("queue:dismiss-appeal-open", onOpen);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("paste", onPaste);
    };
  }, [open, upOpen]);

  // Read the hidden email field lazily, inside the click handlers — they only
  // run in the browser. Reading it at render time crashes SSR (`document` is
  // undefined on the server → the whole /judge page 500s).
  const getJudgeEmail = () =>
    (document.getElementById("hx-email") as HTMLInputElement | null)?.value ?? "";

  function submitDismiss() {
    const reason = (textareaRef.current?.value ?? "").trim();
    const payload: Record<string, string> = { findingId, judge: getJudgeEmail() };
    if (reason) payload.dismissalReason = reason;
    // @ts-ignore - htmx global
    if (typeof htmx !== "undefined") {
      // @ts-ignore
      htmx.ajax("POST", "/api/judge/dismiss-appeal", { target: "#queue-content", swap: "innerHTML", values: payload });
    }
    setOpen(false);
  }

  const removeShot = (id: string) => setUpShots((prev) => prev.filter((s) => s.id !== id));

  async function submitUphold() {
    const reason = upReason.trim();
    if (!reason || upBusy) return; // block on empty / double-submit — nothing committed
    setUpBusy(true);
    setUpError("");

    // Upload each pasted screenshot to S3 first; collect the returned keys.
    const keys: string[] = [];
    try {
      for (const shot of upShots) {
        const fd = new FormData();
        fd.append("file", shot.file, `screenshot.${(shot.file.type.split("/")[1] || "png")}`);
        fd.append("findingId", upFid);
        fd.append("questionIndex", upQidx);
        const res = await fetch("/judge/api/upload-screenshot", { method: "POST", body: fd });
        if (!res.ok) throw new Error(`upload failed (${res.status})`);
        const json = await res.json();
        if (!json?.key) throw new Error("upload returned no key");
        keys.push(json.key);
      }
    } catch (err) {
      console.error("[JUDGE] screenshot upload failed", err);
      setUpBusy(false);
      setUpError("Couldn't upload a screenshot. Remove it or try again.");
      return;
    }

    // @ts-ignore - htmx global
    if (typeof htmx !== "undefined") {
      // @ts-ignore
      htmx.ajax("POST", "/api/judge/decide", {
        target: "#queue-content",
        swap: "innerHTML",
        values: {
          findingId: upFid,
          questionIndex: upQidx,
          decision: "uphold",
          judge: getJudgeEmail(),
          reason,
          ...(keys.length ? { screenshotKeys: JSON.stringify(keys) } : {}),
        },
      });
    }
    setUpBusy(false);
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
              appeal-result email. Paste a screenshot (Ctrl/Cmd+V) to include it.
            </div>
            <textarea
              ref={upInputRef}
              class="queue-overlay-input"
              rows={5}
              value={upReason}
              onInput={(e) => setUpReason((e.target as HTMLTextAreaElement).value)}
              placeholder="Explain why this question did not pass…  (paste a screenshot with Ctrl/Cmd+V)"
              style="text-align:left; font-family:inherit; resize:vertical; min-height:96px"
            />
            {upShots.length > 0 && (
              <div style="margin-top:10px; display:flex; flex-direction:column; gap:10px; max-height:45vh; overflow-y:auto;">
                {upShots.map((shot) => (
                  <div key={shot.id} style="position:relative;">
                    <img
                      src={shot.dataUrl}
                      alt="Pasted screenshot"
                      style="display:block; width:100%; max-height:40vh; object-fit:contain; border:1px solid #1e2d45; border-radius:8px; background:#0a0f18;"
                    />
                    <button
                      type="button"
                      onClick={() => removeShot(shot.id)}
                      title="Remove screenshot"
                      style="position:absolute; top:6px; right:6px; width:26px; height:26px; border-radius:50%; border:1px solid #30363d; background:rgba(13,21,32,0.9); color:#e6edf3; font-size:14px; line-height:1; cursor:pointer;"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            {upError && (
              <div style="margin-top:10px; font-size:12px; color:#f85149; text-align:left;">{upError}</div>
            )}
            <div class="queue-overlay-actions">
              <button type="button" class="queue-overlay-btn" onClick={() => setUpOpen(false)} disabled={upBusy}>Go Back</button>
              <button
                type="button"
                class="queue-overlay-btn primary"
                disabled={!upReason.trim() || upBusy}
                onClick={submitUphold}
              >
                {upBusy ? "Uploading…" : "Submit & Uphold"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
