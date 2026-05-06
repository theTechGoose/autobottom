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
      return new Response(`<div class="placeholder-card">Error: ${e}</div>`, { headers: { "content-type": "text/html" } });
    }
  },
});
