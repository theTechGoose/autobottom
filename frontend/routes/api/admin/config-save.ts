/** Generic HTMX config save handler — posts form data to a backend endpoint. */
import { define } from "../../../lib/define.ts";
import { apiPost } from "../../../lib/api.ts";

export const handler = define.handlers({
  async POST(ctx) {
    try {
      const form = await ctx.req.formData();
      const endpoint = form.get("endpoint")?.toString() ?? "";
      if (!endpoint) return new Response(`<span class="error-text">Missing endpoint</span>`, { headers: { "content-type": "text/html" } });

      // Build body from form data (excluding endpoint)
      const body: Record<string, unknown> = {};
      for (const [key, value] of form.entries()) {
        if (key === "endpoint") continue;
        const v = value.toString();
        // Try to parse as number, boolean, or array
        if (v === "true") body[key] = true;
        else if (v === "false") body[key] = false;
        else if (/^\d+$/.test(v)) body[key] = parseInt(v);
        else if (v.includes(",") && !v.includes("\n")) body[key] = v.split(",").map(s => s.trim()).filter(Boolean);
        else if (v.includes("\n")) body[key] = v.split("\n").map(s => s.trim()).filter(Boolean);
        else body[key] = v;
      }

      await apiPost(endpoint, ctx.req, body);
      return new Response(`<span style="color:var(--green);font-size:12px;">Saved</span>`, { headers: { "content-type": "text/html" } });
    } catch (e) {
      return new Response(`<span class="error-text">${e}</span>`, { headers: { "content-type": "text/html" } });
    }
  },
});
