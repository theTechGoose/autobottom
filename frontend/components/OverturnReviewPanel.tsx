/** Overturn Review panel (REQ-047..049) — the reviewer queue's verdict panel,
 *  one held appeal at a time, one question at a time. The appeal's questions
 *  list overturned first (the ones that take a call), then the judge's upholds
 *  as context. Each overturn gets two buttons: Keep Overturn, or Reverse
 *  Overturn — which opens the comment modal (OverturnReverseModal island). */
import { questionLabel, shortQuestionLabel } from "@core/business/question-labels/mod.ts";
import type { OverturnReviewItem } from "@judge/domain/business/overturn-review/mod.ts";
import { RecordDetails } from "./VerdictPanel.tsx";

export type { OverturnReviewItem };

export interface OverturnReviewWaiting { findingId: string; heldAt: number; judge: string }

interface Props {
  item: OverturnReviewItem | null;
  remaining: number;
  enabled: boolean;
  waiting: OverturnReviewWaiting[];
  /** The question to show; defaults to the first overturn without a call. */
  questionIndex?: number;
  /** A refused call, shown above the question. */
  error?: string;
  /** Set after the team's last call closed an appeal. */
  finalizedId?: string;
}

const fmt = (ms?: number) =>
  ms ? new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }) : "—";

const panelHref = (findingId: string, q?: number) =>
  `/api/judge/overturn-review/show?findingId=${encodeURIComponent(findingId)}${q === undefined ? "" : `&q=${q}`}`;

export function OverturnReviewPanel({ item, remaining, enabled, waiting, questionIndex, error, finalizedId }: Props) {
  const banners = (
    <>
      {!enabled && (
        <div class="ovr-banner warn">
          Overturn Review is off — a judge's overturn closes the appeal and emails right away. Appeals already here still wait for a call.
        </div>
      )}
      {finalizedId && <div class="ovr-banner ok">Appeal {finalizedId} is final — the appeal result email has been sent.</div>}
      {error && <div class="ovr-banner err">{error}</div>}
    </>
  );

  if (!item) {
    return (
      <div class="verdict-panel" id="ovr-panel">
        {banners}
        <div class="verdict-caught-up">
          <h2>All caught up</h2>
          <p>No overturned appeals are waiting.</p>
          <div class="verdict-caught-up-actions">
            <a href="/judge/dashboard" class="verdict-caught-up-link">&larr; Dashboard</a>
          </div>
        </div>
        <style>{CSS}</style>
      </div>
    );
  }

  const q = item.questions.find((x) => x.questionIndex === questionIndex)
    ?? item.questions.find((x) => x.decision === "overturn" && !x.verdict)
    ?? item.questions[0];
  const overturns = item.questions.filter((x) => x.decision === "overturn");
  const called = overturns.filter((x) => x.verdict).length;
  const isPackage = item.recordingIdField === "GenieNumber";
  const meta = item.recordMeta ?? {};

  return (
    <div class="verdict-panel" id="ovr-panel">
      <div class="verdict-scroll">
        <div class="verdict-header">
          <span class="verdict-remaining">
            <span class="verdict-remaining-count">{remaining}</span> {remaining === 1 ? "appeal" : "appeals"} waiting for the team
          </span>
        </div>

        <div class="verdict-audit-header">
          <div class="verdict-audit-row">
            <span class="verdict-audit-label">Guest</span>
            <span class="verdict-audit-value">{meta.guestName ?? "—"}</span>
          </div>
          <div class="verdict-audit-row">
            <span class="verdict-audit-label">TM</span>
            <span class="verdict-audit-value">{meta.voName ?? item.auditor ?? "—"}</span>
          </div>
          <div class="verdict-audit-row">
            <span class="verdict-audit-label">Record</span>
            <span class="verdict-audit-value mono">{item.recordId ?? "—"}</span>
          </div>
          <div class="verdict-audit-badges">
            <span class={`verdict-type-pill ${isPackage ? "pkg" : "intl"}`}>{isPackage ? "PARTNER" : "INTERNAL"}</span>
            <span class="verdict-failed-count">{overturns.length} OVERTURNED</span>
          </div>
        </div>

        {banners}

        {item.appealComment && (
          <div class="appeal-info">
            <span class="appeal-badge">Appeal comment</span>
            <div class="appeal-comment">{item.appealComment}</div>
          </div>
        )}

        <div class={`verdict-badge ${q.decision === "overturn" ? "badge-yes" : "badge-no"}`}>
          {q.decision === "overturn" ? "BOT NO · JUDGE OVERTURNED" : "BOT NO · JUDGE UPHELD"}
        </div>

        <div class="verdict-question">
          <div class="verdict-section-label">Question</div>
          <div class="verdict-question-header">{questionLabel({ header: q.header })}</div>
        </div>

        {q.defense && (
          <div class="verdict-defense-block">
            <div class="verdict-section-label">Defense</div>
            <div class="verdict-defense-quote">{q.defense}</div>
          </div>
        )}

        {q.thinking && (
          <details class="verdict-accordion">
            <summary><span>Bot reasoning</span></summary>
            <div class="verdict-accordion-body">{q.thinking}</div>
          </details>
        )}

        {q.populated && (
          <details class="verdict-accordion">
            <summary>Question prompt</summary>
            <pre class="verdict-accordion-body mono">{q.populated}</pre>
          </details>
        )}

        {Object.keys(meta).length > 0 && (
          <details class="verdict-accordion">
            <summary>Record Details</summary>
            <RecordDetails meta={meta} isPackage={isPackage} />
          </details>
        )}

        <details class="verdict-accordion" open>
          <summary>Appealed Questions <span class="verdict-failed-counter">{called}/{overturns.length}</span></summary>
          <ul class="failed-q-list">
            {item.questions.map((x, idx) => {
              const isCurrent = x.questionIndex === q.questionIndex;
              const dot = isCurrent
                ? "failed-q-dot current"
                : x.decision === "uphold"
                ? "failed-q-dot"
                : x.verdict?.verdict === "confirm"
                ? "failed-q-dot flipped"
                : x.verdict?.verdict === "reverse"
                ? "failed-q-dot confirmed"
                : "failed-q-dot";
              return (
                <li class={`failed-q-pill ${isCurrent ? "current" : ""}`} data-qi={String(x.questionIndex)}>
                  <button
                    type="button"
                    class="failed-q-pill-btn"
                    hx-get={panelHref(item.findingId, x.questionIndex)}
                    hx-target="#ovr-content"
                    hx-swap="innerHTML"
                    disabled={isCurrent}
                  >
                    <span class="failed-q-num">{idx + 1}</span>
                    <span class={dot} />
                    <span class="failed-q-name">{shortQuestionLabel(x.header)}</span>
                    <span class={`ovr-pill-tag ${x.decision}`}>{x.decision === "overturn" ? "Overturned" : "Upheld"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </details>

        {waiting.length > 1 && (
          <details class="verdict-accordion">
            <summary>Waiting Appeals <span class="verdict-failed-counter">{waiting.length}</span></summary>
            <ul class="failed-q-list">
              {waiting.map((w) => (
                <li class={`failed-q-pill ${w.findingId === item.findingId ? "current" : ""}`}>
                  <a class="failed-q-pill-btn ovr-chip" href={`/judge/overturn-review?findingId=${encodeURIComponent(w.findingId)}`}>
                    <span class="failed-q-name mono">{w.findingId}</span>
                    <span class="ovr-pill-when">{fmt(w.heldAt)}</span>
                  </a>
                </li>
              ))}
            </ul>
          </details>
        )}

        <div class="verdict-meta-row">
          <a class="verdict-meta-chip" href={`/audit/report?id=${encodeURIComponent(item.findingId)}`} target="_blank" rel="noopener">
            Audit <strong class="mono">{item.findingId}</strong>
          </a>
          <span class="verdict-meta-chip" title="The reviewer who confirmed the fail">
            Reviewer <span class="mono">{q.reviewer ?? "not recorded"}</span>
          </span>
          <span class="verdict-meta-chip" title="The judge who decided this question">
            Judge <span class="mono">{q.judge}</span>
          </span>
          <span class="verdict-meta-chip">Held <span class="mono">{fmt(item.heldAt)}</span></span>
        </div>
      </div>

      <div class="verdict-footer">
        <div class="verdict-actions ovr-actions">
          {q.decision === "uphold" ? (
            <div class="ovr-verdict">Upheld by the judge — nothing to decide here.</div>
          ) : q.verdict ? (
            <div class={`ovr-verdict ${q.verdict.verdict}`}>
              {q.verdict.verdict === "confirm"
                ? <>Overturn kept by {q.verdict.by}</>
                : <>Overturn reversed by {q.verdict.by}: {q.verdict.note}</>}
            </div>
          ) : (
            <>
              <button
                type="button"
                class="verdict-btn flip ovr-keep"
                hx-post="/api/judge/overturn-review/decide"
                hx-vals={JSON.stringify({ findingId: item.findingId, questionIndex: q.questionIndex, verdict: "confirm" })}
                hx-target="#ovr-content"
                hx-swap="innerHTML"
              >
                Keep Overturn
              </button>
              <button
                type="button"
                class="verdict-btn confirm ovr-reverse"
                data-action="overturn-reverse"
                data-finding-id={item.findingId}
                data-question-index={String(q.questionIndex)}
                data-question-name={shortQuestionLabel(q.header)}
              >
                Reverse Overturn
              </button>
            </>
          )}
        </div>
      </div>
      <style>{CSS}</style>
    </div>
  );
}

const CSS = `
.ovr-banner { padding:8px 12px; border-radius:6px; font-size:12px; margin:8px 0; }
.ovr-banner.warn { background:var(--yellow-bg); color:var(--yellow); }
.ovr-banner.ok { background:var(--green-bg); color:var(--green); }
.ovr-banner.err { background:var(--red-bg); color:var(--red); }
.ovr-pill-tag { margin-left:auto; font-size:10px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; padding:1px 6px; border-radius:4px; }
.ovr-pill-tag.overturn { color:#14b8a6; background:rgba(20,184,166,0.12); }
.ovr-pill-tag.uphold { color:var(--text-dim); background:var(--bg-surface); }
.ovr-pill-when { margin-left:auto; font-size:11px; color:var(--text-dim); }
a.ovr-chip { text-decoration:none; }
.ovr-actions .ovr-verdict { flex:1; text-align:center; font-size:13px; padding:12px; border-radius:8px; color:var(--text-muted); background:var(--bg-surface); }
.ovr-verdict.confirm { color:var(--green); background:var(--green-bg); }
.ovr-verdict.reverse { color:var(--red); background:var(--red-bg); }
`;
