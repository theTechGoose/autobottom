/** HTMX handler — create agent account. */
import { define } from "../../../lib/define.ts";
import { apiPost } from "../../../lib/api.ts";

export const handler = define.handlers({
  async POST(ctx) {
    try {
      const form = await ctx.req.formData();
      const email = form.get("email")?.toString() ?? "";
      const password = form.get("password")?.toString() ?? "";
      const supervisor = form.get("supervisor")?.toString() || undefined;
      if (!email || !password) {
        return new Response(`<span class="error-text">Email and password required</span>`, { headers: { "content-type": "text/html" } });
      }
      await apiPost("/manager/api/agents", ctx.req, { email, password, supervisor });
      return new Response(null, { status: 303, headers: { location: "/manager", "hx-redirect": "/manager" } });
    } catch (e) {
      return new Response(`<span class="error-text">${e}</span>`, { headers: { "content-type": "text/html" } });
    }
  },
});
