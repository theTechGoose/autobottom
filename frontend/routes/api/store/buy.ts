/** HTMX handler — purchase store item. */
import { define } from "../../../lib/define.ts";
import { apiPost, parseHtmxBody } from "../../../lib/api.ts";

export const handler = define.handlers({
  async POST(ctx) {
    try {
      const body = await parseHtmxBody(ctx.req);
      await apiPost("/api/store/buy", ctx.req, body);
      return new Response(null, { status: 200, headers: { "HX-Redirect": "/store" } });
    } catch (e) {
      return Response.json({ error: String(e) }, { status: 500 });
    }
  },
});
