/** File Appeal — mirrors prod's controller.ts appeal UX exactly:
 *    appeal-btn (red glow) → choice overlay with 2 side-by-side cards:
 *      [Add 2nd Genie / Different Recording]  [Appeal Decision]
 *    · "Appeal Decision"  → appeal-confirm-overlay (checkbox list + comment + File Appeal)
 *    · "Different Recording" → reaudit-overlay (tabs: Different Recording / Upload Recording)
 *    · success overlays for each path */
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
  originalGenieId?: string;
}

type View =
  | "closed"
  | "choice"
  | "appeal"
  | "reaudit"
  | "submitting"
  | "appeal-done"
  | "reaudit-done";

type ReauditTab = "recording" | "upload";

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function AppealModal(props: Props) {
  const { findingId, auditorEmail, failedQuestions, originalGenieId = "" } = props;

  const [view, setView] = useState<View>("closed");
  const [tab, setTab] = useState<ReauditTab>("recording");
  const [err, setErr] = useState<string | null>(null);

  // Appeal (judge) form
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [appealComment, setAppealComment] = useState("");

  // Re-audit — different recording tab
  const [genies, setGenies] = useState<string[]>(originalGenieId ? [originalGenieId] : [""]);
  const [reauditComment, setReauditComment] = useState("");

  // Re-audit — upload tab
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
    setGenies(originalGenieId ? [originalGenieId] : [""]);
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
    setTab("recording");
  }

  function openChoice() {
    resetAll();
    setView("choice");
  }

  // ── Appeal Decision (judge) ──
  function toggleChecked(idx: number) {
    const next = new Set(checked);
    if (next.has(idx)) next.delete(idx); else next.add(idx);
    setChecked(next);
  }

  async function submitAppeal() {
    if (!checked.size) { setErr("Select at least one question to appeal."); return; }
    if (!auditorEmail) { setErr("Not signed in."); return; }
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
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      if (data && (data as { error?: string }).error) {
        setErr(String((data as { error: string }).error));
        setView("appeal");
        return;
      }
      if (!res.ok) {
        setErr(`HTTP ${res.status}`);
        setView("appeal");
        return;
      }
      setView("appeal-done");
    } catch (e) {
      setErr((e as Error).message);
      setView("appeal");
    }
  }

  // ── Re-audit — Different Recording tab ──
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
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      const d = data as { error?: string; newFindingId?: string; reportUrl?: string; appealType?: string };
      if (d.error || !d.newFindingId) {
        setErr(String(d.error ?? `HTTP ${res.status}`));
        setView("reaudit");
        return;
      }
      setReauditResult({
        newFindingId: String(d.newFindingId),
        reportUrl: String(d.reportUrl ?? `/audit/report?id=${d.newFindingId}`),
        appealType: String(d.appealType ?? ""),
      });
      setView("reaudit-done");
    } catch (e) {
      setErr((e as Error).message);
      setView("reaudit");
    }
  }

  // ── Re-audit — Upload Recording tab ──
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
        setView("reaudit");
        return;
      }
      setReauditResult({
        newFindingId: String(d.newFindingId),
        reportUrl: String(d.reportUrl ?? `/audit/report?id=${d.newFindingId}`),
        appealType: String(d.appealType ?? "upload-recording"),
      });
      setView("reaudit-done");
    } catch (e) {
      setErr((e as Error).message);
      setView("reaudit");
    }
  }

  return (
    <>
      <div style="margin:14px 0 6px;text-align:center;">
        <button type="button" class="appeal-btn" onClick={openChoice}>File Appeal</button>
      </div>

      {/* ── Choice overlay ── */}
      {view === "choice" && (
        <div class="appeal-overlay" onClick={() => setView("closed")}>
          <div class="appeal-overlay-box appeal-overlay-box--choice" onClick={(e) => e.stopPropagation()}>
            <div class="appeal-choice-title">What would you like to do?</div>
            <div class="appeal-choice-sub">Choose how you'd like to address this audit result.</div>
            <div class="appeal-choice-row">
              <button type="button" class="appeal-choice-card is-reaudit" onClick={() => setView("reaudit")}>
                <div class="appeal-choice-label is-reaudit">Add 2nd Genie / Different Recording</div>
                <div class="appeal-choice-desc">Run the audit again using a different or additional recording</div>
              </button>
              {failedQuestions.length > 0 && (
                <button
                  type="button"
                  class="appeal-choice-card is-appeal"
                  onClick={() => setView("appeal")}
                >
                  <div class="appeal-choice-label is-appeal">Appeal Decision</div>
                  <div class="appeal-choice-desc">Submit for a human to review the flagged questions</div>
                </button>
              )}
            </div>
            <div class="appeal-cancel-row">
              <button type="button" class="appeal-cancel-btn" onClick={() => setView("closed")}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Appeal Decision (judge) overlay ── */}
      {view === "appeal" && (
        <div class="appeal-overlay appeal-overlay--confirm" onClick={() => setView("closed")}>
          <div class="appeal-overlay-box appeal-overlay-box--confirm" onClick={(e) => e.stopPropagation()}>
            <div class="appeal-confirm-title">File an Appeal?</div>
            <div class="appeal-confirm-body">
              Select the questions you believe were incorrectly assessed. A judge will review those decisions.
              Only one appeal can be filed per record.
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
              placeholder="Additional context for the judge (optional)..."
              value={appealComment}
              onInput={(e) => setAppealComment((e.target as HTMLTextAreaElement).value)}
            />
            {err && <div class="appeal-error">{err}</div>}
            <div class="appeal-confirm-actions">
              <button type="button" class="appeal-confirm-cancel" onClick={() => setView("choice")}>Cancel</button>
              <button type="button" class="appeal-confirm-submit" onClick={submitAppeal} disabled={!checked.size}>File Appeal</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Re-audit overlay (tabs) ── */}
      {view === "reaudit" && (
        <div class="appeal-overlay" onClick={() => setView("closed")}>
          <div class="appeal-overlay-box appeal-overlay-box--reaudit" onClick={(e) => e.stopPropagation()}>
            <div class="appeal-reaudit-head">
              <div class="appeal-reaudit-title">Re-Audit Recording</div>
              <button type="button" class="appeal-reaudit-close" onClick={() => setView("closed")}>&times;</button>
            </div>
            <div class="appeal-reaudit-scroll">
              <div class="appeal-panel">
                <div class="appeal-tabs">
                  <button type="button" class={`appeal-tab ${tab === "recording" ? "active" : ""}`} onClick={() => { setErr(null); setTab("recording"); }}>Different Recording</button>
                  <button type="button" class={`appeal-tab ${tab === "upload" ? "active" : ""}`} onClick={() => { setErr(null); setTab("upload"); }}>Upload Recording</button>
                </div>

                {tab === "recording" && (
                  <div class="appeal-fork">
                    <div class="fork-label">Provide corrected or additional Recording IDs</div>
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
                    {err && <div class="appeal-error">{err}</div>}
                    <button type="button" class="fork-submit" onClick={submitDifferentRecording}>Submit Re-Audit</button>
                  </div>
                )}

                {tab === "upload" && (
                  <div class="appeal-fork">
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
                    {err && <div class="appeal-error">{err}</div>}
                    <button type="button" class="fork-submit" onClick={submitUpload} disabled={!uploadFile}>Submit Re-Audit</button>
                  </div>
                )}
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
