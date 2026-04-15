/** HTMX handler — record review decision, return next item fragment. */
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
      // Record the decision
      await apiPost("/review/api/decide", ctx.req, body);
      // Fetch next item
      const next = await apiFetch<{ buffer: ReviewItem[]; remaining: number }>(
        `/review/api/next?reviewer=${encodeURIComponent(body.reviewer)}&types=`, ctx.req,
      );
      const item = next.buffer?.[0] ?? null;
      const html = renderToString(
        <>
          <div class="queue-left">
            <VerdictPanel item={item} mode="review" remaining={next.remaining} email={body.reviewer} combo={0} />
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
