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
    try {
      const next = await apiFetch<{ buffer: ReviewItem[]; remaining: number }>(
        `/review/api/next?reviewer=${encodeURIComponent(reviewer)}&types=`, ctx.req,
      );
      const buffer = next.buffer ?? [];
      const item = buffer[0] ?? null;
      const html = renderToString(
        <>
          <div class="queue-left">
            <VerdictPanel
              item={item}
              buffer={buffer}
              currentIndex={0}
              mode="review"
              remaining={next.remaining}
              email={reviewer}
              combo={0}
            />
          </div>
          <div class="queue-right">
            <TranscriptPanel transcript={item?.transcript} snippet={item?.snippet} />
          </div>
        </>,
      );
      return new Response(html, { headers: { "content-type": "text/html" } });
    } catch (e) {
      return new Response(`<div class="placeholder-card">Error: ${e}</div>`, { headers: { "content-type": "text/html" } });
    }
  },
});
