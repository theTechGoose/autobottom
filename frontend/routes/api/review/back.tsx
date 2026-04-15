/** HTMX handler — undo last review decision, return previous item. */
import { define } from "../../../lib/define.ts";
import { apiPost } from "../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import { VerdictPanel } from "../../../components/VerdictPanel.tsx";
import { TranscriptPanel } from "../../../components/TranscriptPanel.tsx";
import type { ReviewItem } from "../../../components/VerdictPanel.tsx";

export const handler = define.handlers({
  async POST(ctx) {
    try {
      const body = await ctx.req.json();
      const result = await apiPost<{ buffer: ReviewItem[]; remaining: number }>(
        "/review/api/back", ctx.req, body,
      );
      const item = result.buffer?.[0] ?? null;
      const html = renderToString(
        <>
          <div class="queue-left">
            <VerdictPanel item={item} mode="review" remaining={result.remaining} email={body.reviewer} combo={0} />
          </div>
          <div class="queue-right">
            <TranscriptPanel snippet={item?.snippet ?? ""} />
          </div>
        </>
      );
      return new Response(html, { headers: { "content-type": "text/html" } });
    } catch (e) {
      return new Response(`<div class="placeholder-card">Error: ${e}</div>`, { headers: { "content-type": "text/html" } });
    }
  },
});
