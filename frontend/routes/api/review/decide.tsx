/** HTMX handler — record review decision, return next queue fragment.
 *
 *  When `auditComplete` is true, we deliberately DO NOT load the next
 *  finding — instead we re-render the current finding's panel with a
 *  "locked" overlay state. The QueueModals island sees the audit-complete
 *  marker and shows the type-YES modal. Only after the user types YES and
 *  finalize succeeds does the next finding get loaded (via /api/review/next-fragment).
 *  This fixes the race where the next audit's content appeared behind the
 *  finalize modal and Cancel left the user stranded on the wrong audit. */
import { define } from "../../../lib/define.ts";
import { apiPost, apiFetch, parseHtmxBody } from "../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import { VerdictPanel } from "../../../components/VerdictPanel.tsx";
import { TranscriptPanel } from "../../../components/TranscriptPanel.tsx";
import type { ReviewItem } from "../../../components/VerdictPanel.tsx";

export const handler = define.handlers({
  async POST(ctx) {
    try {
      const body = await parseHtmxBody(ctx.req);
      const decideResult = await apiPost<{
        ok: boolean;
        remaining: number;
        auditComplete: boolean;
        xpGained: number;
        newBadges: string[];
        fullBuffer?: ReviewItem[];
        decisions?: Record<string, "confirm" | "flip">;
      }>("/review/api/decide", ctx.req, body);
      const reviewer = String(body.reviewer ?? "");
      const findingId = String(body.findingId ?? "");

      let buffer: ReviewItem[] = [];
      let remaining = decideResult.remaining;
      // Full failed-questions list + decisions — keeps the pill list intact across
      // decisions so each question shows a status dot instead of disappearing.
      const fullBuffer: ReviewItem[] = decideResult.fullBuffer ?? [];
      const decisions: Record<string, "confirm" | "flip"> = decideResult.decisions ?? {};

      if (!decideResult.auditComplete) {
        // Normal path — load the next question's fragment.
        const next = await apiFetch<{ buffer: ReviewItem[]; remaining: number }>(
          `/review/api/next?reviewer=${encodeURIComponent(reviewer)}&types=`, ctx.req,
        );
        buffer = next.buffer ?? [];
        remaining = next.remaining;
      }
      // Audit-complete path: leave buffer empty. The marker fires the modal;
      // QueueModals re-fetches next via /api/review/next-fragment after YES.

      const item = buffer[0] ?? null;
      // Pill list shows fullBuffer when available; otherwise falls back to active buffer.
      const pillBuffer = fullBuffer.length > 0 ? fullBuffer : buffer;
      const pillCurrentIndex = item
        ? Math.max(0, pillBuffer.findIndex((b) => b.questionIndex === item.questionIndex))
        : 0;
      const html = renderToString(
        <>
          <div
            id="decide-effect-marker"
            data-audit-complete={String(decideResult.auditComplete ?? false)}
            data-xp-gained={String(decideResult.xpGained ?? 0)}
            data-decision={String(body.decision ?? "")}
            data-mode="review"
            data-finding-id={findingId}
            data-reviewer={reviewer}
            style="display:none"
          />
          {decideResult.auditComplete ? (
            <div class="queue-finalize-pending">
              <div class="queue-finalize-pending-inner">
                <div style="font-size:36px;margin-bottom:10px;">✅</div>
                <div style="font-size:16px;font-weight:700;color:var(--text-bright);margin-bottom:6px;">All questions decided</div>
                <div style="font-size:13px;color:var(--text-muted);">Type <strong>YES</strong> in the modal to finalize this audit.</div>
              </div>
            </div>
          ) : (
            <>
              <div class="queue-left">
                <VerdictPanel
                  item={item}
                  buffer={pillBuffer}
                  currentIndex={pillCurrentIndex}
                  mode="review"
                  remaining={remaining}
                  email={reviewer}
                  combo={0}
                  decisions={decisions}
                />
              </div>
              <div class="queue-right">
                <TranscriptPanel transcript={item?.transcript} snippet={item?.snippet} />
              </div>
            </>
          )}
        </>,
      );
      return new Response(html, { headers: { "content-type": "text/html" } });
    } catch (e) {
      return new Response(`<div class="placeholder-card">Error: ${e}</div>`, { headers: { "content-type": "text/html" } });
    }
  },
});
