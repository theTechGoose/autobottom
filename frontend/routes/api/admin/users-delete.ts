/** HTMX handler — delete a user. */
import { define } from "../../../lib/define.ts";
import { apiPost } from "../../../lib/api.ts";

export const handler = define.handlers({
  async POST(ctx) {
    try {
      const body = await ctx.req.json();
      await apiPost("/admin/users/delete", ctx.req, { email: body.email });
      return new Response(null, { status: 303, headers: { location: "/admin/users", "hx-redirect": "/admin/users" } });
    } catch (e) {
      return new Response(String(e), { status: 500 });
    }
  },
});
