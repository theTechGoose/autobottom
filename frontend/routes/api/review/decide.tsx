/** HTMX handler — record review decision, return next queue fragment. */
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
      const decideResult = await apiPost<{ ok: boolean; remaining: number; auditComplete: boolean; xpGained: number; newBadges: string[] }>(
        "/review/api/decide", ctx.req, body,
      );
      const next = await apiFetch<{ buffer: ReviewItem[]; remaining: number }>(
        `/review/api/next?reviewer=${encodeURIComponent(String(body.reviewer ?? ""))}&types=`, ctx.req,
      );
      const buffer = next.buffer ?? [];
      const currentIndex = 0;
      const item = buffer[currentIndex] ?? null;
      const html = renderToString(
        <>
          <div
            id="decide-effect-marker"
            data-audit-complete={String(decideResult.auditComplete ?? false)}
            data-xp-gained={String(decideResult.xpGained ?? 0)}
            data-decision={String(body.decision ?? "")}
            data-mode="review"
            data-finding-id={String(body.findingId ?? "")}
            data-reviewer={String(body.reviewer ?? "")}
            style="display:none"
          />
          <div class="queue-left">
            <VerdictPanel
              item={item}
              buffer={buffer}
              currentIndex={currentIndex}
              mode="review"
              remaining={next.remaining}
              email={String(body.reviewer ?? "")}
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
