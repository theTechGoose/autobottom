/** HTMX — admin turns the Overturn Review queue on or off (REQ-051). */
import { renderToString } from "preact-render-to-string";
import { define } from "../../../../lib/define.ts";
import { apiPost, parseHtmxBody } from "../../../../lib/api.ts";
import { loadOverturnReview, OverturnReviewColumns } from "../../../../lib/overturn-review.tsx";

const html = (s: string, status = 200) => new Response(s, { status, headers: { "content-type": "text/html" } });

export const handler = define.handlers({
  async POST(ctx) {
    const user = ctx.state.user!;
    const realRole = ctx.state.impersonatedBy ? "admin" : user.role;
    if (realRole !== "admin") return html(`<div id="ovr-panel" class="ovr-banner err">Admins only.</div>`, 403);
    const body = await parseHtmxBody(ctx.req);
    const r = await apiPost<{ ok: boolean; error?: string }>(
      "/judge/api/overturn-review/config", ctx.req, { enabled: String(body.enabled) === "true" },
    ).catch((e) => ({ ok: false, error: String(e) }));
    const data = await loadOverturnReview(ctx.req, String(body.findingId ?? "") || undefined);
    return html(renderToString(<OverturnReviewColumns data={data} user={{ ...user, role: "admin" }} oob error={r.ok ? undefined : r.error} />));
  },
});
