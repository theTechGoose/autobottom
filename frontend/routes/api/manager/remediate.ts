/** HTMX handler — submit remediation notes. */
import { define } from "../../../lib/define.ts";
import { apiPost } from "../../../lib/api.ts";

export const handler = define.handlers({
  async POST(ctx) {
    try {
      const form = await ctx.req.formData();
      const findingId = form.get("findingId")?.toString() ?? "";
      const notes = form.get("notes")?.toString() ?? "";
      const username = form.get("username")?.toString() ?? "";
      if (!findingId || !notes) {
        return new Response(`<span class="error-text">Finding ID and notes required</span>`, { headers: { "content-type": "text/html" } });
      }
      await apiPost("/manager/api/remediate", ctx.req, { findingId, notes, username });
      return new Response(null, { status: 303, headers: { location: "/manager", "HX-Redirect": "/manager" } });
    } catch (e) {
      return new Response(`<span class="error-text">${e}</span>`, { headers: { "content-type": "text/html" } });
    }
  },
});
