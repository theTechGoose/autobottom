import { define } from "../../../lib/define.ts";
import { apiFetch, apiPost, parseHtmxBody } from "../../../lib/api.ts";
export const handler = define.handlers({
  async GET(ctx) {
    try { return Response.json(await apiFetch<Record<string, unknown>>("/gamification/api/settings", ctx.req)); }
    catch (e) { return Response.json({ error: String(e) }, { status: 500 }); }
  },
  async POST(ctx) {
    try {
      const body = await parseHtmxBody(ctx.req);
      return Response.json(await apiPost<Record<string, unknown>>("/gamification/api/settings", ctx.req, body));
    } catch (e) { return Response.json({ error: String(e) }, { status: 500 }); }
  },
});
