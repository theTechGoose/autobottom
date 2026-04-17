/** File Appeal button + overlay modal for the audit report page.
 *  Mirrors prod's appeal-choice flow: user clicks "File Appeal" → choice overlay
 *  (Appeal Decision vs Re-Audit with New Recording) → form → submit.
 *
 *  Supports Judge Appeal (T) and Re-audit with genies (U). Upload Recording +
 *  snip (V) replaces the reaudit-form's placeholder tab. */
import { useEffect, useState } from "preact/hooks";

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
  | "submitting"
  | "judge-done"
  | "reaudit-done";

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
                    <span class="appeal-choice-label">Re-Audit with New Recording</span>
                    <span class="appeal-choice-desc">Add or replace genie IDs and re-run the audit.</span>
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
