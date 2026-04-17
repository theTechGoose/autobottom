/** Proxy to backend /review/api/finalize — applies flips, recomputes score,
 *  fires the terminate webhook (email). Called by the confirm-audit modal
 *  after the user types YES. Returns JSON so the island can react. */
import { define } from "../../../lib/define.ts";
import { apiPost, parseHtmxBody } from "../../../lib/api.ts";

export const handler = define.handlers({
  async POST(ctx) {
    try {
      const body = await parseHtmxBody(ctx.req);
      const result = await apiPost<{ ok?: boolean; error?: string }>(
        "/review/api/finalize", ctx.req, body,
      );
      return Response.json(result);
    } catch (e) {
      return Response.json({ ok: false, error: String(e) }, { status: 500 });
    }
  },
});
