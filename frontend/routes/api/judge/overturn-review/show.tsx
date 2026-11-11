/** HTMX — show one question of a held appeal (the Appealed Questions list). */
import { renderToString } from "preact-render-to-string";
import { define } from "../../../../lib/define.ts";
import { canReviewOverturns, htmlResponse, loadOverturnReview, OverturnReviewColumns } from "../../../../lib/overturn-review.tsx";

export const handler = define.handlers({
  async GET(ctx) {
    if (!canReviewOverturns(ctx.state.user)) return htmlResponse(`<div class="ovr-banner err">Judges only.</div>`, 403);
    const url = new URL(ctx.req.url);
    const q = url.searchParams.get("q");
    const data = await loadOverturnReview(ctx.req, url.searchParams.get("findingId") ?? undefined);
    return htmlResponse(renderToString(<OverturnReviewColumns data={data} questionIndex={q === null ? undefined : Number(q)} />));
  },
});
