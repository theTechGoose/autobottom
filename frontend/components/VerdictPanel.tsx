/** Left panel — question header, answer, thinking/defense, decision buttons. */
import type { ComponentChildren } from "preact";

export interface ReviewItem {
  findingId: string;
  questionIndex: number;
  header: string;
  question: string;
  answer: string;
  thinking: string;
  defense: string;
  snippet: string;
  auditType?: string;
  appealType?: string;
  appealComment?: string;
  isLastForAudit?: boolean;
}

interface VerdictPanelProps {
  item: ReviewItem | null;
  mode: "review" | "judge";
  remaining: number;
  email: string;
  combo: number;
}

export function VerdictPanel({ item, mode, remaining, email, combo }: VerdictPanelProps) {
  const isReview = mode === "review";

  if (!item) {
    return (
      <div class="verdict-panel">
        <div class="verdict-empty">
          <div style="font-size:48px;opacity:0.3;margin-bottom:16px;">{isReview ? "👀" : "⚖️"}</div>
          <div style="font-size:14px;color:var(--text-muted);">
            {isReview ? "No items pending review. Check back later." : "No items pending judge review. Check back later."}
          </div>
        </div>
      </div>
    );
  }

  const answerLower = item.answer?.toLowerCase() ?? "";
  const isYes = answerLower === "yes" || answerLower === "true";

  return (
    <div class="verdict-panel">
      {/* Hidden inputs for HTMX */}
      <input type="hidden" id="hx-findingId" value={item.findingId} />
      <input type="hidden" id="hx-questionIndex" value={String(item.questionIndex)} />
      <input type="hidden" id="hx-email" value={email} />
      <input type="hidden" id="hx-mode" value={mode} />

      {/* Header */}
      <div class="verdict-header">
        <span class="verdict-remaining">{remaining} remaining</span>
        {combo > 1 && <span class="verdict-combo">🔥 {combo}x combo</span>}
      </div>

      {/* Verdict badge */}
      <div class={`verdict-badge ${isYes ? "badge-yes" : "badge-no"}`}>
        {isReview ? "Bot answered NO" : `Current Answer: ${isYes ? "YES" : "NO"}`}
      </div>

      {/* Appeal info (judge only) */}
      {!isReview && item.appealType && (
        <div class="appeal-info">
          <span class="appeal-badge">{item.appealType}</span>
          {item.appealComment && <div class="appeal-comment">{item.appealComment}</div>}
        </div>
      )}

      {/* Question */}
      <div class="verdict-question">
        <div class="verdict-question-header">{item.header}</div>
        <div class="verdict-question-text">{item.question}</div>
      </div>

      {/* Answer */}
      <div class="verdict-answer">
        <div class="verdict-section-label">Answer</div>
        <div class="verdict-answer-text">{item.answer}</div>
      </div>

      {/* Thinking (collapsible) */}
      <details class="verdict-details">
        <summary class="verdict-section-label" style="cursor:pointer;">Thinking & Defense</summary>
        <div class="verdict-thinking">{item.thinking}</div>
        <div class="verdict-defense">{item.defense}</div>
      </details>

      {/* Decision buttons */}
      <div class="verdict-actions">
        {isReview ? (
          <>
            <button
              class="verdict-btn confirm"
              hx-post="/api/review/decide"
              hx-vals={JSON.stringify({ findingId: item.findingId, questionIndex: item.questionIndex, decision: "confirm", reviewer: email })}
              hx-target="#queue-content"
              hx-swap="innerHTML"
            >
              <kbd>Y</kbd> Confirm
            </button>
            <button
              class="verdict-btn flip"
              hx-post="/api/review/decide"
              hx-vals={JSON.stringify({ findingId: item.findingId, questionIndex: item.questionIndex, decision: "flip", reviewer: email })}
              hx-target="#queue-content"
              hx-swap="innerHTML"
            >
              <kbd>N</kbd> Flip
            </button>
          </>
        ) : (
          <>
            <button
              class="verdict-btn uphold"
              hx-post="/api/judge/decide"
              hx-vals={JSON.stringify({ findingId: item.findingId, questionIndex: item.questionIndex, decision: "uphold", judge: email })}
              hx-target="#queue-content"
              hx-swap="innerHTML"
            >
              <kbd>Y</kbd> Uphold
            </button>
            <div class="verdict-overturn-group">
              <span class="verdict-overturn-label">Overturn:</span>
              {[["A", "error"], ["S", "logic"], ["D", "fragment"], ["F", "transcript"]].map(([key, reason]) => (
                <button
                  key={reason}
                  class="verdict-btn overturn"
                  hx-post="/api/judge/decide"
                  hx-vals={JSON.stringify({ findingId: item.findingId, questionIndex: item.questionIndex, decision: "overturn", reason, judge: email })}
                  hx-target="#queue-content"
                  hx-swap="innerHTML"
                >
                  <kbd>{key}</kbd> {reason}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Undo */}
      <button
        class="verdict-undo"
        hx-post={`/api/${mode}/back`}
        hx-vals={JSON.stringify({ findingId: item.findingId, questionIndex: item.questionIndex, reviewer: email, judge: email })}
        hx-target="#queue-content"
        hx-swap="innerHTML"
      >
        <kbd>B</kbd> Undo
      </button>
    </div>
  );
}
