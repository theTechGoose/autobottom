import { define } from "../../../lib/define.ts";
import { apiPost } from "../../../lib/api.ts";
export const handler = define.handlers({
  async POST(ctx) {
    try { return Response.json(await apiPost<Record<string, unknown>>("/gamification/api/seed", ctx.req, {})); }
    catch (e) { return Response.json({ error: String(e) }, { status: 500 }); }
  },
});
