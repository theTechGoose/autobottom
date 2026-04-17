/** HTMX handler — record judge decision, return next queue fragment. */
import { define } from "../../../lib/define.ts";
import { apiPost, apiFetch } from "../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import { VerdictPanel } from "../../../components/VerdictPanel.tsx";
import { TranscriptPanel } from "../../../components/TranscriptPanel.tsx";
import type { ReviewItem } from "../../../components/VerdictPanel.tsx";

export const handler = define.handlers({
  async POST(ctx) {
    try {
      const body = await ctx.req.json();
      await apiPost("/judge/api/decide", ctx.req, body);
      const next = await apiFetch<{ buffer: ReviewItem[]; remaining: number }>(
        `/judge/api/next?judge=${encodeURIComponent(body.judge)}`, ctx.req,
      );
      const buffer = next.buffer ?? [];
      const currentIndex = 0;
      const item = buffer[currentIndex] ?? null;
      const html = renderToString(
        <>
          <div class="queue-left">
            <VerdictPanel
              item={item}
              buffer={buffer}
              currentIndex={currentIndex}
              mode="judge"
              remaining={next.remaining}
              email={body.judge}
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
