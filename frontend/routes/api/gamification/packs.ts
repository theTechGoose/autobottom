import { define } from "../../../lib/define.ts";
import { apiFetch } from "../../../lib/api.ts";
export const handler = define.handlers({
  async GET(ctx) {
    try { return Response.json(await apiFetch<Record<string, unknown>>("/gamification/api/packs", ctx.req)); }
    catch (e) { return Response.json({ error: String(e) }, { status: 500 }); }
  },
});
