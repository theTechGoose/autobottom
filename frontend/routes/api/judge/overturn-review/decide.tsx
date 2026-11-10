/** HTMX — the team's call on one overturned question (REQ-049). The caller is
 *  the signed-in judge, never a form field. Re-renders the panel: the same
 *  appeal while calls remain, the next one once the last call closed it. */
import { renderToString } from "preact-render-to-string";
import { define } from "../../../../lib/define.ts";
import { apiPost, parseHtmxBody } from "../../../../lib/api.ts";
import { canReviewOverturns, loadOverturnReview, OverturnReviewColumns } from "../../../../lib/overturn-review.tsx";

const html = (s: string, status = 200) => new Response(s, { status, headers: { "content-type": "text/html" } });

export const handler = define.handlers({
  async POST(ctx) {
    const user = ctx.state.user!;
    if (!canReviewOverturns(user)) return html(`<div id="ovr-panel" class="ovr-banner err">Judges only.</div>`, 403);
    const body = await parseHtmxBody(ctx.req);
    const findingId = String(body.findingId ?? "");
    const r = await apiPost<{ ok: boolean; finalized?: boolean; error?: string }>(
      "/judge/api/overturn-review/decide", ctx.req,
      { findingId, questionIndex: Number(body.questionIndex), verdict: String(body.verdict ?? ""), note: String(body.note ?? ""), by: user.email },
    ).catch((e) => ({ ok: false, finalized: false, error: String(e) }));
    const data = await loadOverturnReview(ctx.req, r.finalized ? undefined : findingId);
    return html(renderToString(
      <OverturnReviewColumns data={data} user={user} oob error={r.ok ? undefined : r.error} finalizedId={r.finalized ? findingId : undefined} />,
    ));
  },
});
