import { define } from "../../../../lib/define.ts";
import { apiPost, parseHtmxBody } from "../../../../lib/api.ts";
export const handler = define.handlers({
  async POST(ctx) {
    try {
      const body = await parseHtmxBody(ctx.req);
      return Response.json(await apiPost<Record<string, unknown>>("/gamification/api/pack/delete", ctx.req, body));
    } catch (e) { return Response.json({ error: String(e) }, { status: 500 }); }
  },
});
