/** HTMX fragment — load the next finding's queue panel.
 *  Used by QueueModals after a successful finalize, to swap the
 *  "All questions decided" pending screen with the next audit
 *  (or the empty-state if none left). */
import { define } from "../../../lib/define.ts";
import { apiFetch } from "../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import { VerdictPanel } from "../../../components/VerdictPanel.tsx";
import { TranscriptPanel } from "../../../components/TranscriptPanel.tsx";
import type { ReviewItem } from "../../../components/VerdictPanel.tsx";

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const reviewer = url.searchParams.get("reviewer") ?? "";
    // Prefer caller-supplied types (used by QueueModals/Refresh button which
    // already have the reviewer's preference in the DOM). Fall back to looking
    // it up directly so any direct hit still respects the saved filter.
    let typesCsv = url.searchParams.get("types") ?? "";
    if (typesCsv === "" && reviewer) {
      try {
        const cfg = await apiFetch<{ allowedTypes?: ("date-leg" | "package")[] }>(
          `/review/api/settings?email=${encodeURIComponent(reviewer)}`, ctx.req,
        );
        const at = cfg?.allowedTypes ?? [];
        if (at.length > 0 && at.length < 2) typesCsv = at.join(",");
      } catch { /* fall through with empty types */ }
    }
    try {
      const next = await apiFetch<{
        buffer: ReviewItem[];
        remaining: number;
        fullBuffer?: ReviewItem[];
        decisions?: Record<string, "confirm" | "flip">;
      }>(`/review/api/next?reviewer=${encodeURIComponent(reviewer)}&types=${encodeURIComponent(typesCsv)}`, ctx.req);
      const buffer = next.buffer ?? [];
      const item = buffer[0] ?? null;
      const fullBuffer = next.fullBuffer ?? [];
      const decisions = next.decisions ?? {};
      const pillBuffer = fullBuffer.length > 0 ? fullBuffer : buffer;
      const pillCurrentIndex = item
        ? Math.max(0, pillBuffer.findIndex((b) => b.questionIndex === item.questionIndex))
        : 0;
      const html = renderToString(
        <>
          <div class="queue-left">
            <VerdictPanel
              item={item}
              buffer={pillBuffer}
              currentIndex={pillCurrentIndex}
              mode="review"
              remaining={next.remaining}
              email={reviewer}
              combo={0}
              decisions={decisions}
              allowedTypesCsv={typesCsv}
            />
          </div>
          <div class="queue-right">
            <TranscriptPanel transcript={item?.transcript} snippet={item?.snippet} />
          </div>
        </>,
      );
      return new Response(html, { headers: { "content-type": "text/html" } });
    } catch (e) {
      // Bounded backoff retry. Without a cap, every stuck reviewer fires
      // a fresh claim every 3s into a foreground pool that's already
      // saturated — the retries themselves keep the wedge alive. Each
      // retry doubles the delay (3s, 6s, 12s, 24s, 30s) and after 5
      // attempts we stop polling and require a click. By then either
      // the system has drained or the reviewer takes over.
      console.warn(`[REVIEW] next-fragment fell through to retry:`, e);
      const retry = Math.max(0, Number(url.searchParams.get("retry") ?? "0") | 0);
      const qsBase = `reviewer=${encodeURIComponent(reviewer)}&types=${encodeURIComponent(typesCsv)}`;
      if (retry >= 5) {
        const retryUrl = `/api/review/next-fragment?${qsBase}&retry=0`;
        return new Response(
          `<div class="queue-left"
                style="padding:24px;text-align:center;color:var(--text-dim);font-size:12px;">
             <div style="margin-bottom:12px;">Server is busy. The queue couldn't claim a new audit after several retries.</div>
             <button hx-get="${retryUrl}"
                     hx-target="#queue-content"
                     hx-swap="innerHTML"
                     style="padding:8px 16px;background:var(--accent);color:#000;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;">
               Retry now
             </button>
           </div>
           <div class="queue-right"></div>`,
          { headers: { "content-type": "text/html" } },
        );
      }
      const delaySec = Math.min(3 * Math.pow(2, retry), 30);
      const nextRetry = retry + 1;
      return new Response(
        `<div class="queue-left"
              hx-get="/api/review/next-fragment?${qsBase}&retry=${nextRetry}"
              hx-trigger="load delay:${delaySec}s"
              hx-target="#queue-content"
              hx-swap="innerHTML"
              style="padding:24px;text-align:center;color:var(--text-dim);font-size:12px;">
           Loading next… (server is busy, retrying in ${delaySec}s — attempt ${nextRetry}/5)
         </div>
         <div class="queue-right"></div>`,
        { headers: { "content-type": "text/html" } },
      );
    }
  },
});
