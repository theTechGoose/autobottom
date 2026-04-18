/** Proxy — POST /admin/wipe-kv. Body must include confirm:"YES". */
import { define } from "../../../lib/define.ts";
import { apiPost, parseHtmxBody } from "../../../lib/api.ts";

export const handler = define.handlers({
  async POST(ctx) {
    try {
      const body = await parseHtmxBody(ctx.req);
      const data = await apiPost<Record<string, unknown>>("/admin/wipe-kv", ctx.req, body);
      return Response.json(data);
    } catch (e) {
      return Response.json({ error: String(e) }, { status: 500 });
    }
  },
});
