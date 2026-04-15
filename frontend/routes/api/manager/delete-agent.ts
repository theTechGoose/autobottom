/** HTMX handler — delete agent account. */
import { define } from "../../../lib/define.ts";
import { apiPost } from "../../../lib/api.ts";

export const handler = define.handlers({
  async POST(ctx) {
    try {
      const body = await ctx.req.json();
      await apiPost("/manager/api/agents/delete", ctx.req, { email: body.email });
      return new Response(null, { status: 303, headers: { location: "/manager", "HX-Redirect": "/manager" } });
    } catch (e) {
      return new Response(String(e), { status: 500 });
    }
  },
});
