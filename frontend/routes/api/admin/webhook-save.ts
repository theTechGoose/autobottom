/** HTMX handler — save webhook config for a specific kind. */
import { define } from "../../../lib/define.ts";
import { apiPost } from "../../../lib/api.ts";

export const handler = define.handlers({
  async POST(ctx) {
    try {
      const url = new URL(ctx.req.url);
      const kind = url.searchParams.get("kind") ?? "";
      if (!kind) return new Response(`<span class="error-text">Missing kind</span>`, { headers: { "content-type": "text/html" } });

      const form = await ctx.req.formData();
      const postUrl = form.get("postUrl")?.toString() ?? "";
      let postHeaders: unknown = {};
      try { postHeaders = JSON.parse(form.get("postHeaders")?.toString() ?? "{}"); } catch {}

      await apiPost(`/admin/settings/${kind}`, ctx.req, { postUrl, postHeaders });
      return new Response(`<span style="color:var(--green);font-size:12px;">Saved</span>`, { headers: { "content-type": "text/html" } });
    } catch (e) {
      return new Response(`<span class="error-text">${e}</span>`, { headers: { "content-type": "text/html" } });
    }
  },
});
