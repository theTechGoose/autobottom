/** HTMX handler — delete a user. */
import { define } from "../../../lib/define.ts";
import { apiPost, parseHtmxBody } from "../../../lib/api.ts";

export const handler = define.handlers({
  async POST(ctx) {
    try {
      const body = await parseHtmxBody(ctx.req);
      await apiPost("/admin/users/delete", ctx.req, { email: body.email });
      return new Response(null, { status: 200, headers: { "HX-Redirect": "/admin/users" } });
    } catch (e) {
      return new Response(String(e), { status: 500 });
    }
  },
});
