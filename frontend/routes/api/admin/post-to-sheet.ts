/** JSON proxy — forwards post-to-sheet to the backend. */
import { define } from "../../../lib/define.ts";
import { apiPost, parseHtmxBody } from "../../../lib/api.ts";

export const handler = define.handlers({
  async POST(ctx) {
    try {
      const body = await parseHtmxBody(ctx.req);
      const data = await apiPost<Record<string, unknown>>(`/admin/post-to-sheet`, ctx.req, body);
      return Response.json(data);
    } catch (e) {
      return Response.json({ error: String(e) }, { status: 500 });
    }
  },
});
