/** HTMX fragment — save reviewer queue type preferences. */
import { define } from "../../../lib/define.ts";
import { apiPost, parseHtmxBody } from "../../../lib/api.ts";

export const handler = define.handlers({
  async POST(ctx) {
    try {
      const body = await parseHtmxBody(ctx.req);
      const allowedTypes: string[] = [];
      if (body["date-leg"] !== undefined) allowedTypes.push("date-leg");
      if (body["package"] !== undefined) allowedTypes.push("package");
      if (allowedTypes.length === 0) {
        return new Response(`<span class="error-text">At least one type required</span>`, { headers: { "content-type": "text/html" } });
      }
      const user = ctx.state.user!;
      await apiPost("/review/api/settings", ctx.req, { email: user.email, config: { allowedTypes } });
      return new Response(`<span style="color:var(--green);">Saved.</span>`, { headers: { "content-type": "text/html" } });
    } catch (e) {
      return new Response(`<span class="error-text">Save failed: ${e}</span>`, { headers: { "content-type": "text/html" } });
    }
  },
});
