/** File Appeal button + overlay modal for the audit report page.
 *  Mirrors prod's appeal-choice flow: user clicks "File Appeal" → choice overlay
 *  (Appeal Decision vs Re-Audit with New Recording) → form → submit.
 *
 *  Supports Judge Appeal (T) and Re-audit with genies (U). Upload Recording +
 *  snip (V) replaces the reaudit-form's placeholder tab. */
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
  | "judge-form"
  | "reaudit-form"
  | "upload-form"
  | "submitting"
  | "judge-done"
  | "reaudit-done";

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function AppealModal(props: Props) {
  const { findingId, auditorEmail, failedQuestions, originalGenieId = "" } = props;
  const [view, setView] = useState<View>("closed");
  const [err, setErr] = useState<string | null>(null);

  // Judge-appeal form state
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [comment, setComment] = useState("");
  const [queued, setQueued] = useState(0);

  // Re-audit form state
  const initialGenies = originalGenieId ? [originalGenieId] : [""];
  const [genies, setGenies] = useState<string[]>(initialGenies);
  const [reauditComment, setReauditComment] = useState("");
  const [reauditResult, setReauditResult] = useState<{ newFindingId: string; reportUrl: string; appealType: string } | null>(null);

  // Upload form state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadUrl, setUploadUrl] = useState<string | null>(null);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioCurrent, setAudioCurrent] = useState(0);
  const [snipStartSec, setSnipStartSec] = useState<number | null>(null);
  const [snipEndSec, setSnipEndSec] = useState<number | null>(null);
  const [uploadComment, setUploadComment] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      if (uploadUrl) URL.revokeObjectURL(uploadUrl);
    };
  }, [uploadUrl]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && view !== "closed" && view !== "submitting") {
        setView("closed");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [view]);

  function resetAll() {
    setErr(null);
    setChecked(new Set());
    setComment("");
    setGenies(originalGenieId ? [originalGenieId] : [""]);
    setReauditComment("");
    setReauditResult(null);
    if (uploadUrl) URL.revokeObjectURL(uploadUrl);
    setUploadFile(null);
    setUploadUrl(null);
    setAudioDuration(0);
    setAudioCurrent(0);
    setSnipStartSec(null);
    setSnipEndSec(null);
    setUploadComment("");
  }

  function openChoice() {
    resetAll();
    setView("choice");
  }

  function toggleChecked(idx: number) {
    const next = new Set(checked);
    if (next.has(idx)) next.delete(idx); else next.add(idx);
    setChecked(next);
  }

  function selectAll() {
    setChecked(new Set(failedQuestions.map((q) => q.index)));
  }

  async function submitJudgeAppeal() {
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
          comment: comment.trim() || undefined,
          appealedQuestions: Array.from(checked),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setErr(String(data.error ?? `HTTP ${res.status}`));
        setView("judge-form");
        return;
      }
      setQueued(Number(data.queued ?? checked.size));
      setView("judge-done");
    } catch (e) {
      setErr((e as Error).message);
      setView("judge-form");
    }
  }

  function updateGenie(i: number, v: string) {
    const next = [...genies];
    next[i] = v.replace(/\D/g, "");
    setGenies(next);
  }

  function addGenie() {
    if (genies.length >= 5) return;
    setGenies([...genies, ""]);
  }

  function removeGenie(i: number) {
    if (genies.length <= 1) return;
    setGenies(genies.filter((_, idx) => idx !== i));
  }

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
    setSnipStartSec(t);
    if (snipEndSec !== null && t >= snipEndSec) setSnipEndSec(null);
  }

  function markEnd() {
    const t = audioRef.current?.currentTime ?? 0;
    if (snipStartSec !== null && t <= snipStartSec) { setErr("End must be after start."); return; }
    setSnipEndSec(t);
  }

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
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error || !data.newFindingId) {
        setErr(String(data.error ?? `HTTP ${res.status}`));
        setView("upload-form");
        return;
      }
      setReauditResult({
        newFindingId: String(data.newFindingId),
        reportUrl: String(data.reportUrl ?? `/audit/report?id=${data.newFindingId}`),
        appealType: String(data.appealType ?? "upload-recording"),
      });
      setView("reaudit-done");
    } catch (e) {
      setErr((e as Error).message);
      setView("upload-form");
    }
  }

  async function submitReaudit() {
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
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error || !data.newFindingId) {
        setErr(String(data.error ?? `HTTP ${res.status}`));
        setView("reaudit-form");
        return;
      }
      setReauditResult({
        newFindingId: String(data.newFindingId),
        reportUrl: String(data.reportUrl ?? `/audit/report?id=${data.newFindingId}`),
        appealType: String(data.appealType ?? ""),
      });
      setView("reaudit-done");
    } catch (e) {
      setErr((e as Error).message);
      setView("reaudit-form");
    }
  }

  return (
    <>
      <div style="margin:14px 0 6px;text-align:center;">
        <button
          type="button"
          class="sf-btn primary"
          onClick={openChoice}
          title="File an appeal for this audit"
        >
          File Appeal
        </button>
      </div>

      {view !== "closed" && (
        <div class="appeal-overlay" onClick={() => view !== "submitting" && setView("closed")}>
          <div class="appeal-box" onClick={(e) => e.stopPropagation()}>
            {view === "choice" && (
              <>
                <div class="appeal-title">File Appeal</div>
                <div class="appeal-body">Choose how you'd like to dispute this audit.</div>
                <div class="appeal-choices">
                  <button
                    type="button"
                    class="appeal-choice-btn"
                    onClick={() => setView("judge-form")}
                    disabled={!failedQuestions.length}
                    title={!failedQuestions.length ? "No failed questions to appeal" : ""}
                  >
                    <span class="appeal-choice-label">Appeal Decision</span>
                    <span class="appeal-choice-desc">Flag specific failed questions for judge review.</span>
                  </button>
                  <button type="button" class="appeal-choice-btn" onClick={() => setView("reaudit-form")}>
                    <span class="appeal-choice-label">Re-Audit with Different Genies</span>
                    <span class="appeal-choice-desc">Add or replace genie IDs and re-run the audit.</span>
                  </button>
                  <button type="button" class="appeal-choice-btn" onClick={() => setView("upload-form")}>
                    <span class="appeal-choice-label">Upload a Recording</span>
                    <span class="appeal-choice-desc">Upload an mp3 and optionally trim start/end.</span>
                  </button>
                </div>
                <div class="appeal-actions">
                  <button type="button" class="sf-btn ghost" onClick={() => setView("closed")}>Cancel</button>
                </div>
              </>
            )}

            {view === "judge-form" && (
              <>
                <div class="appeal-title">Appeal Decision</div>
                <div class="appeal-body">
                  Check each failed question you want sent to a judge. Add an optional comment with context.
                </div>
                <div class="appeal-qlist-head">
                  <span>{checked.size} of {failedQuestions.length} selected</span>
                  <button type="button" class="appeal-link-btn" onClick={selectAll}>Select all</button>
                </div>
                <div class="appeal-qlist">
                  {failedQuestions.map((q) => (
                    <label key={q.index} class="appeal-check-row">
                      <input
                        type="checkbox"
                        checked={checked.has(q.index)}
                        onChange={() => toggleChecked(q.index)}
                      />
                      <span class="appeal-check-num">{q.index + 1}</span>
                      <span class="appeal-check-text">{q.header}</span>
                    </label>
                  ))}
                </div>
                <textarea
                  class="appeal-note"
                  placeholder="Optional: add context for the judge"
                  value={comment}
                  onInput={(e) => setComment((e.target as HTMLTextAreaElement).value)}
                  rows={3}
                />
                {err && <div class="appeal-error">{err}</div>}
                <div class="appeal-actions">
                  <button type="button" class="sf-btn ghost" onClick={() => setView("choice")}>Back</button>
                  <button type="button" class="sf-btn primary" onClick={submitJudgeAppeal}>Submit Appeal</button>
                </div>
              </>
            )}

            {view === "reaudit-form" && (
              <>
                <div class="appeal-title">Re-Audit with New Recording</div>
                <div class="appeal-body">
                  Enter 8-digit genie IDs. Keep the original to <strong>add</strong> a second
                  recording (concat &amp; re-audit as one call). Remove it to <strong>replace</strong>
                  with only the new recording.
                </div>
                <div class="appeal-genie-list">
                  {genies.map((g, i) => (
                    <div class="appeal-genie-row" key={i}>
                      <input
                        type="text"
                        class="appeal-genie-input"
                        placeholder="e.g. 27485612"
                        value={g}
                        inputMode="numeric"
                        maxLength={10}
                        onInput={(e) => updateGenie(i, (e.target as HTMLInputElement).value)}
                      />
                      <button
                        type="button"
                        class="appeal-genie-rm"
                        onClick={() => removeGenie(i)}
                        disabled={genies.length <= 1}
                        title="Remove"
                      >&times;</button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  class="appeal-genie-add"
                  onClick={addGenie}
                  disabled={genies.length >= 5}
                >
                  + Add Genie
                </button>
                <textarea
                  class="appeal-note"
                  placeholder="Optional: reason for the re-audit"
                  value={reauditComment}
                  onInput={(e) => setReauditComment((e.target as HTMLTextAreaElement).value)}
                  rows={3}
                />
                {err && <div class="appeal-error">{err}</div>}
                <div class="appeal-actions">
                  <button type="button" class="sf-btn ghost" onClick={() => setView("choice")}>Back</button>
                  <button type="button" class="sf-btn primary" onClick={submitReaudit}>Start Re-Audit</button>
                </div>
              </>
            )}

            {view === "upload-form" && (
              <>
                <div class="appeal-title">Upload a Recording</div>
                <div class="appeal-body">
                  Upload an audio file (mp3/mp4/wav). Play it below and mark start/end points
                  to trim before audit. Leave both unset to transcribe the full file.
                </div>
                {!uploadFile && (
                  <label class="appeal-upload-drop">
                    <input
                      type="file"
                      accept="audio/*,video/mp4"
                      style="display:none"
                      onChange={(e) => pickFile((e.target as HTMLInputElement).files?.[0] ?? null)}
                    />
                    <div class="appeal-upload-icon">⤒</div>
                    <div class="appeal-upload-text">Click to choose audio file</div>
                    <div class="appeal-upload-hint">max 60MB, mp3/wav/mp4</div>
                  </label>
                )}
                {uploadFile && uploadUrl && (
                  <>
                    <div class="appeal-upload-info">
                      <span class="appeal-upload-name">{uploadFile.name}</span>
                      <span class="appeal-upload-size">{(uploadFile.size / 1024 / 1024).toFixed(1)}MB</span>
                      <button type="button" class="appeal-link-btn" onClick={() => pickFile(null)}>Change</button>
                    </div>
                    <audio
                      ref={audioRef}
                      src={uploadUrl}
                      controls
                      style="width:100%;margin-bottom:10px;"
                      onLoadedMetadata={(e) => setAudioDuration((e.target as HTMLAudioElement).duration || 0)}
                      onTimeUpdate={(e) => setAudioCurrent((e.target as HTMLAudioElement).currentTime || 0)}
                    />
                    <div class="appeal-snip-row">
                      <button type="button" class="sf-btn ghost" onClick={markStart}>
                        Set Start @ {fmtTime(audioCurrent)}
                      </button>
                      <button type="button" class="sf-btn ghost" onClick={markEnd}>
                        Set End @ {fmtTime(audioCurrent)}
                      </button>
                      {(snipStartSec !== null || snipEndSec !== null) && (
                        <button type="button" class="appeal-link-btn" onClick={() => { setSnipStartSec(null); setSnipEndSec(null); }}>Clear snip</button>
                      )}
                    </div>
                    <div class="appeal-snip-summary">
                      {snipStartSec === null && snipEndSec === null
                        ? <span style="color:var(--text-dim);">No trim — full file will be transcribed ({fmtTime(audioDuration)})</span>
                        : <span>
                            Trim: <strong>{fmtTime(snipStartSec ?? 0)}</strong> →
                            <strong> {fmtTime(snipEndSec ?? audioDuration)}</strong>
                            {" "}(<em>{fmtTime((snipEndSec ?? audioDuration) - (snipStartSec ?? 0))}</em>)
                          </span>
                      }
                    </div>
                  </>
                )}
                <textarea
                  class="appeal-note"
                  placeholder="Optional: reason for the re-audit"
                  value={uploadComment}
                  onInput={(e) => setUploadComment((e.target as HTMLTextAreaElement).value)}
                  rows={3}
                />
                {err && <div class="appeal-error">{err}</div>}
                <div class="appeal-actions">
                  <button type="button" class="sf-btn ghost" onClick={() => setView("choice")}>Back</button>
                  <button type="button" class="sf-btn primary" onClick={submitUpload} disabled={!uploadFile}>Start Re-Audit</button>
                </div>
              </>
            )}

            {view === "submitting" && (
              <>
                <div class="appeal-title">Submitting…</div>
                <div class="appeal-body">Processing your request.</div>
              </>
            )}

            {view === "judge-done" && (
              <>
                <div class="appeal-title" style="color:var(--green);">Appeal Filed</div>
                <div class="appeal-body">
                  {queued} question{queued === 1 ? "" : "s"} sent to the judge queue. The
                  excellence team has been emailed.
                </div>
                <div class="appeal-actions">
                  <a href="/judge" class="sf-btn primary" style="text-decoration:none;">Open Judge Panel</a>
                  <button type="button" class="sf-btn ghost" onClick={() => setView("closed")}>Close</button>
                </div>
              </>
            )}

            {view === "reaudit-done" && reauditResult && (
              <>
                <div class="appeal-title" style="color:var(--green);">Re-Audit Queued</div>
                <div class="appeal-body">
                  Your new audit is running. You'll receive an email when it completes.
                  {reauditResult.appealType === "additional-recording" && " (Both recordings will be concatenated.)"}
                  {reauditResult.appealType === "different-recording" && " (Original recording replaced.)"}
                </div>
                <div class="appeal-actions">
                  <a href={reauditResult.reportUrl} class="sf-btn primary" style="text-decoration:none;">View New Report</a>
                  <button type="button" class="sf-btn ghost" onClick={() => setView("closed")}>Close</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
