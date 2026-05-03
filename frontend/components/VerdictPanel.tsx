/** Left panel — verdict pane for review/judge queue.
 *  Ported from main:shared/queue-page.ts sections. Server-rendered only —
 *  interactivity layers (audio player, transcript search, modals, gamification)
 *  come in later islands. */

const QB_DATE_URL = "https://monsterrg.quickbase.com/db/bpb28qsnn?a=dr&rid=";
const QB_PKG_URL = "https://monsterrg.quickbase.com/db/bttffb64u?a=dr&rid=";

/** Matches the backend BufferItem shape returned by /review/api/next and /judge/api/next. */
export interface ReviewItem {
  findingId: string;
  questionIndex: number;
  reviewIndex?: number;
  totalForFinding?: number;
  header: string;
  populated?: string;
  thinking: string;
  defense: string;
  answer: string;
  completedAt?: number;
  recordingIdField?: string;
  recordId?: string;
  recordMeta?: Record<string, string | undefined>;
  auditRemaining?: number;
  transcript?: { raw: string; diarized: string; utteranceTimes?: number[] } | null;

  // Judge-only fields (present on JudgeBufferItem)
  appealType?: string;
  appealComment?: string;
  reviewedBy?: string;

  // Legacy fields tolerated from older responses (not currently populated)
  question?: string;
  snippet?: string;
  auditType?: string;
  isLastForAudit?: boolean;
}

interface VerdictPanelProps {
  item: ReviewItem | null;
  buffer: ReviewItem[];
  currentIndex: number;
  mode: "review" | "judge";
  remaining: number;
  email: string;
  combo: number;
}

function qbUrl(recordId: string | undefined, isPackage: boolean): string | null {
  if (!recordId) return null;
  return (isPackage ? QB_PKG_URL : QB_DATE_URL) + encodeURIComponent(recordId);
}

function truncate(s: string | undefined, n: number): string {
  if (!s) return "";
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function RecordDetails({ item, isPackage }: { item: ReviewItem; isPackage: boolean }) {
  const meta = item.recordMeta ?? {};
  const chk = (v: string | undefined) =>
    v && String(v) !== "0" && String(v).toLowerCase() !== "false" ? "☑" : "☐";

  const cells: Array<[string, string]> = isPackage
    ? [
      ["Guest Name", meta.guestName ?? "—"],
      ["Marital Status", meta.maritalStatus ?? "—"],
      ["Office", meta.officeName ?? "—"],
      ["Total Amount", meta.totalAmountPaid ? `$${meta.totalAmountPaid}` : "—"],
      ["MCC / MSP", `${chk(meta.hasMCC)} MCC  ${chk(meta.mspSubscription)} MSP`],
    ]
    : [
      ["Guest Name", meta.guestName ?? "—"],
      ["Spouse Name", meta.spouseName ?? "—"],
      ["Marital Status", meta.maritalStatus ?? "—"],
      ["Destination", meta.destination ?? "—"],
      ["Arrival", meta.arrivalDate ?? "—"],
      ["Departure", meta.departureDate ?? "—"],
      ["Room / Occupancy", meta.roomTypeMaxOccupancy ?? "—"],
      ["WGS / MCC", `${chk(meta.totalWGS)} WGS  ${chk(meta.totalMCC)} MCC`],
    ];

  return (
    <div class="verdict-record-grid">
      {cells.map(([label, value]) => (
        <div key={label} class="verdict-record-cell">
          <div class="verdict-record-label">{label}</div>
          <div class="verdict-record-value">{value}</div>
        </div>
      ))}
    </div>
  );
}

export function VerdictPanel({ item, buffer, currentIndex, mode, remaining, email, combo }: VerdictPanelProps) {
  const isReview = mode === "review";

  if (!item) {
    // Match prod's "All caught up" empty state — large heading, subtle
    // empty-text, single ← Dashboard back button. No XP / combo stats.
    const dashHref = isReview ? "/review/dashboard" : "/judge/dashboard";
    const emptyText = isReview ? "No items pending review. Check back later." : "No items pending judge review. Check back later.";
    return (
      <div class="verdict-panel">
        <div class="verdict-caught-up">
          <h2>All caught up</h2>
          <p>{emptyText}</p>
          <a href={dashHref} class="verdict-caught-up-link">&larr; Dashboard</a>
        </div>
      </div>
    );
  }

  const isPackage = item.recordingIdField === "GenieNumber";
  const typeLabel = isPackage ? "PARTNER" : "INTERNAL";
  const auditRemaining = item.auditRemaining ?? buffer.length - currentIndex;
  const totalForFinding = item.totalForFinding ?? buffer.length;
  const isLastForAudit = auditRemaining <= 1;
  const qbHref = qbUrl(item.recordId, isPackage);
  const reportHref = `/audit/report?id=${encodeURIComponent(item.findingId)}`;

  const meta = item.recordMeta ?? {};
  const guestDisplay = meta.guestName ?? "—";
  const voDisplay = meta.voName ?? item.reviewedBy ?? (!isReview ? item.reviewedBy : null);

  return (
    <div class="verdict-panel">
      {/* Hidden inputs for HTMX */}
      <input type="hidden" id="hx-findingId" value={item.findingId} />
      <input type="hidden" id="hx-questionIndex" value={String(item.questionIndex)} />
      <input type="hidden" id="hx-email" value={email} />
      <input type="hidden" id="hx-mode" value={mode} />

      {/* Scrollable content above the pinned footer */}
      <div class="verdict-scroll">

      {/* Audit header — review mode shows guest/TM/record/type/failed-count */}
      {isReview && (
        <div class="verdict-audit-header">
          <div class="verdict-audit-row">
            <span class="verdict-audit-label">Guest</span>
            <span class="verdict-audit-value">{guestDisplay}</span>
          </div>
          {voDisplay && (
            <div class="verdict-audit-row">
              <span class="verdict-audit-label">TM</span>
              <span class="verdict-audit-value">{voDisplay}</span>
            </div>
          )}
          <div class="verdict-audit-row">
            <span class="verdict-audit-label">Record</span>
            <span class="verdict-audit-value mono">{item.recordId ?? "—"}</span>
          </div>
          <div class="verdict-audit-badges">
            <span class={`verdict-type-pill ${isPackage ? "pkg" : "intl"}`}>{typeLabel}</span>
            <span class="verdict-failed-count">{totalForFinding} FAILED</span>
          </div>
        </div>
      )}

      {/* Remaining + combo */}
      <div class="verdict-header">
        <span class="verdict-remaining">{auditRemaining} remaining</span>
        {combo > 1 && <span class="verdict-combo">🔥 {combo}× combo</span>}
      </div>

      {/* Appeal info — judge only */}
      {!isReview && item.appealType && (
        <div class="appeal-info">
          <span class="appeal-badge">{item.appealType}</span>
          {item.appealComment && <div class="appeal-comment">{item.appealComment}</div>}
        </div>
      )}

      {/* Verdict badge */}
      <div class={`verdict-badge ${isReview ? "badge-no" : (item.answer?.toLowerCase().startsWith("y") ? "badge-yes" : "badge-no")}`}>
        {isReview ? "BOT ANSWERED NO" : `CURRENT ANSWER: ${item.answer?.toUpperCase() ?? ""}`}
      </div>

      {/* Question header */}
      <div class="verdict-question">
        <div class="verdict-section-label">Question</div>
        <div class="verdict-question-header">{item.header}</div>
      </div>

      {/* Defense */}
      {item.defense && (
        <div class="verdict-defense-block">
          <div class="verdict-section-label">Defense</div>
          <div class="verdict-defense-quote">{item.defense}</div>
        </div>
      )}

      {/* Bot reasoning accordion */}
      {item.thinking && (
        <details class="verdict-accordion">
          <summary>
            <span>Bot reasoning</span>
            <kbd class="verdict-hotkey">D</kbd>
          </summary>
          <div class="verdict-accordion-body">{item.thinking}</div>
        </details>
      )}

      {/* Question prompt accordion */}
      {item.populated && (
        <details class="verdict-accordion">
          <summary>Question prompt</summary>
          <pre class="verdict-accordion-body mono">{item.populated}</pre>
        </details>
      )}

      {/* Record Details accordion */}
      {item.recordMeta && Object.keys(item.recordMeta).length > 0 && (
        <details class="verdict-accordion">
          <summary>Record Details</summary>
          <RecordDetails item={item} isPackage={isPackage} />
        </details>
      )}

      {/* Failed Questions pill list (review only, audit has more than one item) */}
      {isReview && buffer.length > 1 && (
        <details class="verdict-accordion" open>
          <summary>Failed Questions <span class="verdict-failed-counter">0/{buffer.length}</span></summary>
          <ul class="failed-q-list">
            {buffer.map((bi, idx) => (
              <li
                key={`${bi.findingId}-${bi.questionIndex}`}
                class={`failed-q-pill ${idx === currentIndex ? "current" : ""}`}
              >
                <span class="failed-q-num">{idx + 1}</span>
                <span class="failed-q-dot" />
                <span class="failed-q-name">{truncate(bi.header, 40)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Meta chips */}
      <div class="verdict-meta-row">
        <a class="verdict-meta-chip" href={reportHref} target="_blank" rel="noopener">
          Audit <strong class="mono verdict-chip-finding">{item.findingId}</strong>
        </a>
        {qbHref && (
          <a class="verdict-meta-chip" href={qbHref} target="_blank" rel="noopener">
            Record <strong class="mono verdict-chip-record">{item.recordId}</strong>
          </a>
        )}
        <button class="verdict-meta-chip" type="button" data-action="jump-to-audio">
          Jump to Audio
        </button>
        {!isReview && item.reviewedBy && (
          <span class="verdict-meta-chip" title="Reviewed by">
            Reviewer <span class="mono">{item.reviewedBy}</span>
          </span>
        )}
        {isLastForAudit && (
          <span class="verdict-meta-chip pulse">{isReview ? "Final for audit" : "Final for appeal"}</span>
        )}
      </div>

      </div>
      {/* End .verdict-scroll */}

      {/* Pinned footer — decision buttons + undo/dismiss */}
      <div class="verdict-footer">
      {/* Decision buttons (id used by DecideEffects to flip data-busy) */}
      <div class="verdict-actions" id="decide-buttons">
      <div class="verdict-actions-overlay">
        <span class="verdict-actions-spinner" />
        <span>Processing…</span>
      </div>
        {isReview ? (
          <>
            <button
              class="verdict-btn confirm"
              hx-post="/api/review/decide"
              hx-vals={JSON.stringify({ findingId: item.findingId, questionIndex: item.questionIndex, decision: "confirm", reviewer: email })}
              hx-target="#queue-content"
              hx-swap="innerHTML"
            >
              <kbd>Y</kbd> Confirm No
            </button>
            <button
              class="verdict-btn flip"
              hx-post="/api/review/decide"
              hx-vals={JSON.stringify({ findingId: item.findingId, questionIndex: item.questionIndex, decision: "flip", reviewer: email })}
              hx-target="#queue-content"
              hx-swap="innerHTML"
            >
              <kbd>N</kbd> Flip to Yes
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

      {/* Undo + (judge only) Dismiss Appeal */}
      <div class="verdict-footer-actions">
        <button
          class="verdict-undo"
          hx-post={`/api/${mode}/back`}
          hx-vals={JSON.stringify({ findingId: item.findingId, questionIndex: item.questionIndex, reviewer: email, judge: email })}
          hx-target="#queue-content"
          hx-swap="innerHTML"
        >
          <kbd>B</kbd> Undo
        </button>
        {!isReview && (
          <button
            class="verdict-dismiss"
            type="button"
            onClick={() => document.dispatchEvent(new CustomEvent("queue:dismiss-appeal-open", { detail: { findingId: item.findingId } }))}
          >
            Dismiss Appeal
          </button>
        )}
      </div>
      </div>
      {/* End .verdict-footer */}
    </div>
  );
}
