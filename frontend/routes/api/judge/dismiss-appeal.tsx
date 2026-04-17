/** HTMX handler — dismiss an appeal (judge-only) then return the next queue
 *  fragment. Thin proxy to backend /judge/api/dismiss-appeal. */
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
      if (!body.findingId) {
        return new Response(`<div class="placeholder-card">findingId required</div>`, { headers: { "content-type": "text/html" } });
      }
      await apiPost("/judge/api/dismiss-appeal", ctx.req, { findingId: body.findingId });
      const next = await apiFetch<{ buffer: ReviewItem[]; remaining: number }>(
        `/judge/api/next?judge=${encodeURIComponent(String(body.judge ?? ""))}`, ctx.req,
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
              mode="judge"
              remaining={next.remaining}
              email={String(body.judge ?? "")}
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
