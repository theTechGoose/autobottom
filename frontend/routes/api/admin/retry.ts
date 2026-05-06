/** HTMX handler — retry a failed finding. */
import { define } from "../../../lib/define.ts";
import { apiFetch } from "../../../lib/api.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const findingId = url.searchParams.get("findingId") ?? "";
    const step = url.searchParams.get("step") ?? "";
    try {
      await apiFetch(`/admin/retry-finding?findingId=${findingId}&step=${step}`, ctx.req);
      return new Response(null, { status: 204 });
    } catch (e) {
      return new Response(`<span class="error-text">${e}</span>`, {
        headers: { "content-type": "text/html" },
      });
    }
  },
});
