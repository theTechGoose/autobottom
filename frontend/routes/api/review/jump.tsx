/** HTMX fragment — switch to a specific failed question on the current
 *  audit. Wired to the clickable pills in the Failed Questions accordion
 *  of VerdictPanel. Re-renders #queue-content with the chosen question
 *  as the current verdict subject. Re-deciding an already-decided
 *  question is allowed — the underlying recordDecision overwrites the
 *  prior review-decided record. */
import { define } from "../../../lib/define.ts";
import { apiFetch } from "../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import { VerdictPanel } from "../../../components/VerdictPanel.tsx";
import { TranscriptPanel } from "../../../components/TranscriptPanel.tsx";
import type { ReviewItem } from "../../../components/VerdictPanel.tsx";

export const handler = define.handlers({
  async GET(ctx) {
    try {
      const url = new URL(ctx.req.url);
      const findingId = url.searchParams.get("findingId") ?? "";
      const questionIndex = url.searchParams.get("questionIndex") ?? "";
      const reviewer = url.searchParams.get("reviewer") ?? "";
      const typesCsv = url.searchParams.get("types") ?? "";
      if (!findingId || !reviewer || questionIndex === "") {
        return new Response(
          `<div class="placeholder-card">Jump failed: missing findingId/questionIndex/reviewer</div>`,
          { headers: { "content-type": "text/html" } },
        );
      }
      const result = await apiFetch<{
        buffer?: ReviewItem[];
        remaining?: number;
        fullBuffer?: ReviewItem[];
        decisions?: Record<string, "confirm" | "flip">;
        error?: string;
      }>(
        `/review/api/jump?findingId=${encodeURIComponent(findingId)}&questionIndex=${encodeURIComponent(questionIndex)}&reviewer=${encodeURIComponent(reviewer)}`,
        ctx.req,
      );
      if (result.error) {
        return new Response(
          `<div class="placeholder-card">Jump failed: ${result.error}</div>`,
          { headers: { "content-type": "text/html" } },
        );
      }
      const buffer = result.buffer ?? [];
      const item = buffer[0] ?? null;
      const fullBuffer = result.fullBuffer ?? [];
      const decisions = result.decisions ?? {};
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
              remaining={result.remaining ?? 0}
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
      console.warn(`[REVIEW] jump fragment failed:`, e);
      return new Response(
        `<div class="placeholder-card">Jump failed: ${e}</div>`,
        { headers: { "content-type": "text/html" } },
      );
    }
  },
});
