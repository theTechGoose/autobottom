/** HTMX handler — close a queue row out with no write-up.
 *
 *  Mirrors remediate.ts, minus the notes: the point of Skip is that it is one
 *  click. Same same-origin returnTo guard, so a crafted form can't turn the
 *  HX-Redirect into an open redirect. */
import { define } from "../../../lib/define.ts";
import { apiPost } from "../../../lib/api.ts";

export const handler = define.handlers({
  async POST(ctx) {
    try {
      const form = await ctx.req.formData();
      const findingId = form.get("findingId")?.toString() ?? "";
      const username = form.get("username")?.toString() ?? "";
      if (!findingId || !username) {
        return new Response(`<span class="error-text">Finding ID and user required</span>`, { headers: { "content-type": "text/html" } });
      }
      await apiPost("/manager/api/skip", ctx.req, { findingId, username });
      const returnTo = form.get("returnTo")?.toString() ?? "";
      const safeReturn = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/manager";
      return new Response(null, { status: 200, headers: { "HX-Redirect": safeReturn } });
    } catch (e) {
      return new Response(`<span class="error-text">${e}</span>`, { headers: { "content-type": "text/html" } });
    }
  },
});
