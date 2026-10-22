/** Appeal buttons — three side-by-side triggers, each opening its own modal
 *  (REQ-017). The single "File Appeal" button + choice card hid the new-audio
 *  paths, and agents filed judge appeals to say the audio cut out:
 *    · "Add Genie"       → genie modal (the audit's genies, add / replace / remove)
 *    · "Direct Upload"   → upload modal (file + optional trim)
 *    · "Appeal Decision" → judge modal (checkbox list + comment), which points
 *      missing-audio cases back at the other two (REQ-019)
 *  Using any path locks all three (REQ-020): a re-audit leaves one "View New
 *  Report" link, a judge appeal one "Appeal Filed" pill. */
import { useEffect, useRef, useState } from "preact/hooks";

export interface FailedQuestion {
  index: number;
  header: string;
  answer: string;
}

interface Props {
  findingId: string;
  auditorEmail: string;
  failedQuestions: FailedQuestion[];
  /** Every recording the audit used — the Add Genie modal starts
   *  with all of them so adding one appends instead of swapping (REQ-007). */
  originalGenieIds?: string[];
  /** Set when an appeal has already been filed for this finding —
   *  replaces the three buttons with a disabled "Appeal Filed" pill. */
  appealedAt?: number;
  /** Set when this finding has been re-audited (different / additional /
   *  upload recording) — replaces the three buttons with "Re-Audited". */
  reAuditedAt?: number;
  /** New finding ID that superseded this one. When present, the re-audited
   *  state is a "View New Report" link instead of a dead pill, so anyone
   *  landing on a stale report URL can jump to the live one in a click. */
  reAuditedTo?: string;
  /** The audit is queued for review and the review isn't finished — nothing
   *  can be appealed until a reviewer has decided every failed question. */
  awaitingReview?: boolean;
  /** How the TRIGGERS sit on the page — the overlays are unaffected.
   *  "block" (default) is the audit report's centred, vertically-spaced
   *  row. "inline" strips the spacing and shrinks them to btn-sm, for a
   *  toolbar row like the manager remediation topbar. */
  variant?: "block" | "inline";
}

type View =
  | "closed"
  | "genie"
  | "upload"
  | "appeal"
  | "submitting"
  | "appeal-done"
  | "reaudit-done";

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function AppealModal(props: Props) {
  const { findingId, auditorEmail, failedQuestions, originalGenieIds = [], appealedAt, reAuditedAt, reAuditedTo, awaitingReview, variant = "block" } = props;
  // Local lock — set after a successful submit so the button updates without
  // needing a page refresh. Server-side appealedAt/reAuditedAt cover the
  // post-refresh case.
  const [localLock, setLocalLock] = useState<"appeal" | "reaudit" | null>(null);
  const lockedLabel = reAuditedAt || localLock === "reaudit"
    ? "Re-Audited"
    : appealedAt || localLock === "appeal"
      ? "Appeal Filed"
      : awaitingReview
        ? "Awaiting Review"
        : null;

  const [view, setView] = useState<View>("closed");
  const [err, setErr] = useState<string | null>(null);

  // Appeal (judge) form
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [appealComment, setAppealComment] = useState("");

  // Add Genie
  const [genies, setGenies] = useState<string[]>(originalGenieIds.length ? [...originalGenieIds] : [""]);
  const [reauditComment, setReauditComment] = useState("");

  // Direct Upload
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadUrl, setUploadUrl] = useState<string | null>(null);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioCurrent, setAudioCurrent] = useState(0);
  const [snipStartSec, setSnipStartSec] = useState<number | null>(null);
  const [snipEndSec, setSnipEndSec] = useState<number | null>(null);
  const [uploadComment, setUploadComment] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Success-screen state
  const [reauditResult, setReauditResult] = useState<{ newFindingId: string; reportUrl: string; appealType: string } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && view !== "closed" && view !== "submitting") {
        setView("closed");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [view]);

  useEffect(() => {
    return () => { if (uploadUrl) URL.revokeObjectURL(uploadUrl); };
  }, [uploadUrl]);

  function resetAll() {
    setErr(null);
    setChecked(new Set());
    setAppealComment("");
    setGenies(originalGenieIds.length ? [...originalGenieIds] : [""]);
    setReauditComment("");
    if (uploadUrl) URL.revokeObjectURL(uploadUrl);
    setUploadFile(null);
    setUploadUrl(null);
    setAudioDuration(0);
    setAudioCurrent(0);
    setSnipStartSec(null);
    setSnipEndSec(null);
    setUploadComment("");
    setReauditResult(null);
  }

  function open(next: "genie" | "upload" | "appeal") {
    resetAll();
    setView(next);
  }

  /** Hop from one modal to another without closing first — the Appeal
   *  Decision modal's "Add Genie instead" / "Direct Upload instead". */
  function switchTo(next: "genie" | "upload" | "appeal") {
    setErr(null);
    setView(next);
  }

  // ── Appeal Decision (judge) ──
  function toggleChecked(idx: number) {
    const next = new Set(checked);
    if (next.has(idx)) next.delete(idx); else next.add(idx);
    setChecked(next);
  }

  async function submitAppeal() {
    if (!checked.size) { setErr("Select at least one question to appeal."); return; }
    // No auditorEmail gate. The audit-report page is public and reachable
    // via the audit-complete email link — anonymous customers MUST be able
    // to file appeals. The route handler provides a fallback chain so
    // auditorEmail is always non-empty by the time we get here. Auditor
    // field is informational only (appeal record, judge email, logs).
    setErr(null);
    setView("submitting");
    try {
      const res = await fetch("/api/audit/appeal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          findingId,
          auditor: auditorEmail,
          comment: appealComment.trim() || undefined,
          appealedQuestions: Array.from(checked),
        }),
      });
      const rawText = await res.text();
      let data: Record<string, unknown> = {};
      try { data = rawText ? JSON.parse(rawText) : {}; } catch { /* non-JSON body */ }
      if (data && (data as { error?: string }).error) {
        setErr(String((data as { error: string }).error));
        setView("appeal");
        return;
      }
      if (!res.ok) {
        console.error("[APPEAL-SUBMIT] non-ok response", { status: res.status, body: rawText });
        setErr(`HTTP ${res.status} — body: ${rawText.slice(0, 200) || "<empty>"}`);
        setView("appeal");
        return;
      }
      setLocalLock("appeal");
      setView("appeal-done");
    } catch (e) {
      setErr((e as Error).message);
      setView("appeal");
    }
  }

  // ── Add Genie ──
  function setGenie(i: number, v: string) {
    const next = [...genies];
    next[i] = v.replace(/\D/g, "").slice(0, 8);
    setGenies(next);
  }
  function addGenie() { if (genies.length < 5) setGenies([...genies, ""]); }
  function removeGenie(i: number) { if (genies.length > 1) setGenies(genies.filter((_, idx) => idx !== i)); }

  async function submitDifferentRecording() {
    const ids = genies.map((g) => g.trim()).filter(Boolean);
    if (!ids.length) { setErr("Enter at least one genie ID."); return; }
    for (const id of ids) {
      if (!/^\d{6,10}$/.test(id)) { setErr(`Invalid genie ID: ${id}`); return; }
    }
    setErr(null);
    setView("submitting");
    try {
      const res = await fetch("/api/audit/appeal/different-recording", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          findingId,
          recordingIds: ids,
          comment: reauditComment.trim() || undefined,
          agentEmail: auditorEmail,
        }),
      });
      const rawText = await res.text();
      let data: Record<string, unknown> = {};
      try { data = rawText ? JSON.parse(rawText) : {}; } catch { /* non-JSON body */ }
      const d = data as { error?: string; newFindingId?: string; reportUrl?: string; appealType?: string };
      if (d.error || !d.newFindingId) {
        console.error("[REAUDIT-SUBMIT] unexpected response", { status: res.status, body: rawText });
        const bodyHint = d.error ?? `HTTP ${res.status} — body: ${rawText.slice(0, 200) || "<empty>"}`;
        setErr(String(bodyHint));
        setView("genie");
        return;
      }
      setReauditResult({
        newFindingId: String(d.newFindingId),
        reportUrl: String(d.reportUrl ?? `/audit/report?id=${d.newFindingId}`),
        appealType: String(d.appealType ?? ""),
      });
      setLocalLock("reaudit");
      setView("reaudit-done");
    } catch (e) {
      setErr((e as Error).message);
      setView("genie");
    }
  }

  // ── Direct Upload ──
  const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;

  function pickFile(f: File | null) {
    setErr(null);
    if (uploadUrl) URL.revokeObjectURL(uploadUrl);
    if (!f) { setUploadFile(null); setUploadUrl(null); setAudioDuration(0); setSnipStartSec(null); setSnipEndSec(null); return; }
    if (f.size > MAX_UPLOAD_BYTES) { setErr(`File too large (max ${(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)}MB).`); return; }
    setUploadFile(f);
    setUploadUrl(URL.createObjectURL(f));
    setAudioDuration(0);
    setAudioCurrent(0);
    setSnipStartSec(null);
    setSnipEndSec(null);
  }

  function markStart() {
    const t = audioRef.current?.currentTime ?? 0;
    if (snipEndSec !== null && t >= snipEndSec) { setErr("Start must be before end."); return; }
    setSnipStartSec(t);
  }
  function markEnd() {
    const t = audioRef.current?.currentTime ?? 0;
    if (snipStartSec !== null && t <= snipStartSec) { setErr("End must be after start."); return; }
    setSnipEndSec(t);
  }
  function clearSnip() { setSnipStartSec(null); setSnipEndSec(null); setErr(null); }

  async function submitUpload() {
    if (!uploadFile) { setErr("Choose a file."); return; }
    if (snipStartSec !== null && snipEndSec !== null && snipEndSec <= snipStartSec) {
      setErr("End must be after start."); return;
    }
    setErr(null);
    setView("submitting");
    try {
      const fd = new FormData();
      fd.append("findingId", findingId);
      fd.append("file", uploadFile, uploadFile.name || "upload.mp3");
      if (snipStartSec !== null) fd.append("snipStart", String(Math.floor(snipStartSec * 1000)));
      if (snipEndSec !== null) fd.append("snipEnd", String(Math.floor(snipEndSec * 1000)));
      if (uploadComment.trim()) fd.append("comment", uploadComment.trim());
      fd.append("agentEmail", auditorEmail);
      const res = await fetch("/api/audit/appeal/upload-recording", {
        method: "POST", credentials: "include", body: fd,
      });
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      const d = data as { error?: string; newFindingId?: string; reportUrl?: string; appealType?: string };
      if (d.error || !d.newFindingId) {
        setErr(String(d.error ?? `HTTP ${res.status}`));
        setView("upload");
        return;
      }
      setReauditResult({
        newFindingId: String(d.newFindingId),
        reportUrl: String(d.reportUrl ?? `/audit/report?id=${d.newFindingId}`),
        appealType: String(d.appealType ?? "upload-recording"),
      });
      setLocalLock("reaudit");
      setView("reaudit-done");
    } catch (e) {
      setErr((e as Error).message);
      setView("upload");
    }
  }

  /** The re-audit's report once one exists — from the finding after a refresh,
   *  or from the submit's answer right after it. */
  const newReportUrl = reAuditedTo
    ? `/audit/report?id=${reAuditedTo}`
    : localLock === "reaudit" ? reauditResult?.reportUrl ?? null : null;

  /** Header shared by the three modals: title + close. */
  const modalHead = (title: string) => (
    <div class="appeal-reaudit-head">
      <div class="appeal-reaudit-title">{title}</div>
      <button type="button" class="appeal-reaudit-close" onClick={() => setView("closed")}>&times;</button>
    </div>
  );

  return (
    <>
      <div class={`appeal-trigger${variant === "inline" ? " appeal-trigger--inline" : ""}`}>
        {lockedLabel === "Re-Audited" && newReportUrl ? (
          // Stale-report shortcut: anyone landing on a re-audited finding gets
          // a one-click jump to the live new audit instead of a dead pill.
          <a
            href={newReportUrl}
            class="appeal-btn filed"
            style="text-decoration:none;display:inline-block;"
            title="View the re-audit that superseded this one"
          >View New Report</a>
        ) : lockedLabel ? (
          <button
            type="button"
            class="appeal-btn filed"
            disabled
            title={lockedLabel === "Awaiting Review" ? "An appeal can be filed once a reviewer has finished every failed question" : undefined}
          >{lockedLabel}</button>
        ) : (
          <>
            <button type="button" class="appeal-btn appeal-btn--audio" onClick={() => open("genie")}>Add Genie</button>
            <button type="button" class="appeal-btn appeal-btn--audio" onClick={() => open("upload")}>Direct Upload</button>
            <button type="button" class="appeal-btn" onClick={() => open("appeal")}>Appeal Decision</button>
          </>
        )}
      </div>

      {/* ── Appeal Decision (judge) ── */}
      {view === "appeal" && (
        <div class="appeal-overlay appeal-overlay--confirm" onClick={() => setView("closed")}>
          <div class="appeal-overlay-box appeal-overlay-box--confirm" onClick={(e) => e.stopPropagation()}>
            <div class="appeal-confirm-title">Appeal Decision</div>
            <div class="appeal-confirm-body">
              Use this when you think the audit answered a question wrong. A judge re-listens to
              this audit's recording and decides each question you select. The judge hears only
              the audio already on this audit — nothing new is added.
            </div>
            <div class="appeal-redirect">
              <div class="appeal-redirect-text">
                <strong>Audio cut out, or the call continued on another Genie?</strong>{" "}
                A judge can't hear audio that isn't there. Add the missing recording instead —
                that runs a new audit with the full call.
              </div>
              <div class="appeal-redirect-actions">
                <button type="button" class="appeal-redirect-btn" onClick={() => switchTo("genie")}>Add Genie instead</button>
                <button type="button" class="appeal-redirect-btn" onClick={() => switchTo("upload")}>Direct Upload instead</button>
              </div>
            </div>
            <div class="appeal-confirm-count">
              <span>{checked.size} of {failedQuestions.length} selected</span>
              <button type="button" class="appeal-link-btn" onClick={() => setChecked(new Set(failedQuestions.map((q) => q.index)))}>
                Select all
              </button>
            </div>
            <div class="appeal-confirm-list">
              {failedQuestions.map((q) => (
                <label key={q.index} class="appeal-confirm-row">
                  <input type="checkbox" checked={checked.has(q.index)} onChange={() => toggleChecked(q.index)} />
                  <span class="appeal-confirm-num">{q.index + 1}</span>
                  <span class="appeal-confirm-text">{q.header}</span>
                </label>
              ))}
            </div>
            <textarea
              class="appeal-comment"
              placeholder="Why the answer is wrong — what the judge should listen for (optional)..."
              value={appealComment}
              onInput={(e) => setAppealComment((e.target as HTMLTextAreaElement).value)}
            />
            <div class="appeal-note">
              One appeal per audit: filing this locks Add Genie and Direct Upload too.
            </div>
            {err && <div class="appeal-error">{err}</div>}
            <div class="appeal-confirm-actions">
              <button type="button" class="appeal-confirm-cancel" onClick={() => setView("closed")}>Cancel</button>
              <button type="button" class="appeal-confirm-submit" onClick={submitAppeal} disabled={!checked.size}>File Appeal</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Genie ── */}
      {view === "genie" && (
        <div class="appeal-overlay" onClick={() => setView("closed")}>
          <div class="appeal-overlay-box appeal-overlay-box--reaudit" onClick={(e) => e.stopPropagation()}>
            {modalHead("Add Genie")}
            <div class="appeal-reaudit-scroll">
              <div class="appeal-panel">
                <div class="appeal-fork">
                  <div class="appeal-explain">
                    <p>
                      Use this when the audio cut out, the call continued on a second Genie, or the
                      wrong Genie was audited. Submitting runs a <strong>new audit</strong> on the
                      Genies listed below, and this report is replaced by the new one.
                    </p>
                    <ul>
                      <li>
                        <strong>Add more:</strong> keep this audit's Genie and press{" "}
                        <strong>+ Add Another</strong>. Every Genie listed is joined, in order, and
                        audited as one call.
                      </li>
                      <li>
                        <strong>Wrong recording:</strong> overwrite the original Genie (or remove
                        it with &times;) to audit a different recording instead.
                      </li>
                    </ul>
                  </div>
                  <div class="fork-label">Genie IDs for the new audit — this audit's are filled in</div>
                  <div class="recording-inputs">
                    {genies.map((g, i) => (
                      <div class="recording-row" key={i}>
                        <input
                          type="text"
                          class="recording-input"
                          placeholder="8-digit Genie ID"
                          maxLength={8}
                          value={g}
                          inputMode="numeric"
                          onInput={(e) => setGenie(i, (e.target as HTMLInputElement).value)}
                        />
                        <button
                          type="button"
                          class="recording-remove"
                          onClick={() => removeGenie(i)}
                          disabled={genies.length <= 1}
                        >&times;</button>
                      </div>
                    ))}
                  </div>
                  <button type="button" class="fork-add-btn" onClick={addGenie} disabled={genies.length >= 5}>+ Add Another</button>
                  <textarea
                    class="appeal-comment"
                    placeholder="Optional comment for the judge..."
                    value={reauditComment}
                    onInput={(e) => setReauditComment((e.target as HTMLTextAreaElement).value)}
                  />
                  <div class="appeal-note">
                    Recording only exists as a file?{" "}
                    <button type="button" class="appeal-link-btn" onClick={() => switchTo("upload")}>Use Direct Upload</button>
                  </div>
                  {err && <div class="appeal-error">{err}</div>}
                  <button type="button" class="fork-submit" onClick={submitDifferentRecording}>Submit Re-Audit</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Direct Upload ── */}
      {view === "upload" && (
        <div class="appeal-overlay" onClick={() => setView("closed")}>
          <div class="appeal-overlay-box appeal-overlay-box--reaudit" onClick={(e) => e.stopPropagation()}>
            {modalHead("Direct Upload")}
            <div class="appeal-reaudit-scroll">
              <div class="appeal-panel">
                <div class="appeal-fork">
                  <div class="appeal-explain">
                    <p>
                      Use this when the recording isn't in Genie — upload the audio file yourself
                      (MP3 or other audio, up to 60MB). Submitting runs a <strong>new audit</strong> on
                      the uploaded file in place of this audit's recording, and this report is
                      replaced by the new one.
                    </p>
                    <p>
                      Optional: trim the file to just this call by setting a start and end below.
                      Leave it untrimmed to audit the whole file.
                    </p>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="audio/mpeg,audio/*,video/mp4"
                    style="display:none"
                    onChange={(e) => pickFile((e.target as HTMLInputElement).files?.[0] ?? null)}
                  />
                  {!uploadFile && (
                    <div class="upload-area" onClick={() => fileInputRef.current?.click()}>
                      <div class="upload-icon">⤒</div>
                      <div class="upload-text">Click to select an audio file</div>
                    </div>
                  )}
                  {uploadFile && uploadUrl && (
                    <>
                      <div class="file-info visible">
                        <div class="file-info-icon">🎵</div>
                        <span class="file-info-name">{uploadFile.name}</span>
                        <span class="file-info-size">{(uploadFile.size / 1024 / 1024).toFixed(1)}MB</span>
                        <button type="button" class="file-info-change" onClick={() => fileInputRef.current?.click()}>Change</button>
                      </div>
                      <audio
                        ref={audioRef}
                        src={uploadUrl}
                        controls
                        style="width:100%;margin:6px 0 4px;"
                        onLoadedMetadata={(e) => setAudioDuration((e.target as HTMLAudioElement).duration || 0)}
                        onTimeUpdate={(e) => setAudioCurrent((e.target as HTMLAudioElement).currentTime || 0)}
                      />
                      <div class="snip-editor visible">
                        <div class="snip-editor-label">Trim recording (optional)</div>
                        <div class="snip-actions">
                          <button type="button" class="snip-btn snip-btn--start" onClick={markStart}>Set Start @ {fmtTime(audioCurrent)}</button>
                          <button type="button" class="snip-btn snip-btn--end" onClick={markEnd}>Set End @ {fmtTime(audioCurrent)}</button>
                          <button type="button" class="snip-btn snip-btn--clear" onClick={clearSnip}>Clear</button>
                          <div class="snip-window">
                            <span class="snip-window-val snip-window-val--start">{snipStartSec !== null ? fmtTime(snipStartSec) : "--:--"}</span>
                            <span>→</span>
                            <span class="snip-window-val snip-window-val--end">{snipEndSec !== null ? fmtTime(snipEndSec) : "--:--"}</span>
                          </div>
                        </div>
                        <div class="snip-hint">
                          Seek to a position then click Set Start / Set End to define the window.
                          Total: {fmtTime(audioDuration)}. Leave unset to audit the full file.
                        </div>
                      </div>
                    </>
                  )}
                  <textarea
                    class="appeal-comment"
                    placeholder="Optional comment for the judge..."
                    value={uploadComment}
                    onInput={(e) => setUploadComment((e.target as HTMLTextAreaElement).value)}
                  />
                  <div class="appeal-note">
                    Recording is in Genie?{" "}
                    <button type="button" class="appeal-link-btn" onClick={() => switchTo("genie")}>Use Add Genie</button>
                  </div>
                  {err && <div class="appeal-error">{err}</div>}
                  <button type="button" class="fork-submit" onClick={submitUpload} disabled={!uploadFile}>Submit Re-Audit</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Submitting / Success overlays ── */}
      {view === "submitting" && (
        <div class="appeal-overlay">
          <div class="appeal-overlay-box appeal-overlay-box--success">
            <div class="appeal-success-emoji">⏳</div>
            <div class="appeal-success-title">Submitting…</div>
            <div class="appeal-success-body">Hang tight while we process your request.</div>
          </div>
        </div>
      )}

      {view === "appeal-done" && (
        <div class="appeal-overlay" onClick={() => setView("closed")}>
          <div class="appeal-overlay-box appeal-overlay-box--success" onClick={(e) => e.stopPropagation()}>
            <div class="appeal-success-emoji">✅</div>
            <div class="appeal-success-title">Appeal Submitted!</div>
            <div class="appeal-success-body">A judge will review your selected questions and make a final determination.</div>
            <div class="appeal-success-actions">
              <button type="button" class="appeal-cancel-btn" onClick={() => setView("closed")}>Close</button>
            </div>
          </div>
        </div>
      )}

      {view === "reaudit-done" && reauditResult && (
        <div class="appeal-overlay" onClick={() => setView("closed")}>
          <div class="appeal-overlay-box appeal-overlay-box--success" onClick={(e) => e.stopPropagation()}>
            <div class="appeal-success-emoji">☑️</div>
            <div class="appeal-success-title">Audit Re-submitted!</div>
            <div class="appeal-success-body">
              Your new audit is running. You'll receive an email when it completes.
              {reauditResult.appealType === "additional-recording" && " (Both recordings will be concatenated.)"}
              {reauditResult.appealType === "different-recording" && " (Original recording replaced.)"}
              {reauditResult.appealType === "upload-recording" && " (Uploaded recording queued.)"}
            </div>
            <div class="appeal-success-actions">
              <a href={reauditResult.reportUrl} class="appeal-cancel-btn" style="text-decoration:none;">View New Report</a>
              <button type="button" class="appeal-cancel-btn" onClick={() => setView("closed")}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
