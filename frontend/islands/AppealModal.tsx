/** File Appeal button + overlay modal for the audit report page.
 *  Mirrors prod's appeal-choice flow: user clicks "File Appeal" → choice overlay
 *  (Judge Appeal vs Re-audit with new recording) → form → submit.
 *
 *  Commit T ships only the Judge Appeal option. The Re-audit / Upload Recording
 *  tabs land in Commits U and V and replace the "Coming soon" placeholder. */
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
}

type View = "closed" | "choice" | "judge-form" | "reaudit-placeholder" | "submitting" | "done";

export default function AppealModal({ findingId, auditorEmail, failedQuestions }: Props) {
  const [view, setView] = useState<View>("closed");
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [comment, setComment] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [queued, setQueued] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && view !== "closed" && view !== "submitting") {
        setView("closed");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [view]);

  function toggle(idx: number) {
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
      setView("done");
    } catch (e) {
      setErr((e as Error).message);
      setView("judge-form");
    }
  }

  return (
    <>
      <div style="margin:14px 0 6px;text-align:center;">
        <button
          type="button"
          class="sf-btn primary"
          onClick={() => { setErr(null); setView("choice"); }}
          disabled={!failedQuestions.length}
          title={!failedQuestions.length ? "No failed questions to appeal" : "File an appeal for this audit"}
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
                  <button type="button" class="appeal-choice-btn" onClick={() => { setView("judge-form"); }}>
                    <span class="appeal-choice-label">Appeal Decision</span>
                    <span class="appeal-choice-desc">Flag specific failed questions for judge review.</span>
                  </button>
                  <button type="button" class="appeal-choice-btn" onClick={() => setView("reaudit-placeholder")}>
                    <span class="appeal-choice-label">Re-Audit with New Recording</span>
                    <span class="appeal-choice-desc">Add / replace genies, or upload a recording.</span>
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
                        onChange={() => toggle(q.index)}
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

            {view === "reaudit-placeholder" && (
              <>
                <div class="appeal-title">Re-Audit with New Recording</div>
                <div class="appeal-body">
                  This option will let you re-audit with different or additional genie IDs,
                  or upload a recording and trim it. Coming in the next update.
                </div>
                <div class="appeal-actions">
                  <button type="button" class="sf-btn ghost" onClick={() => setView("choice")}>Back</button>
                </div>
              </>
            )}

            {view === "submitting" && (
              <>
                <div class="appeal-title">Submitting…</div>
                <div class="appeal-body">Queueing your appeal for judge review.</div>
              </>
            )}

            {view === "done" && (
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
          </div>
        </div>
      )}
    </>
  );
}
