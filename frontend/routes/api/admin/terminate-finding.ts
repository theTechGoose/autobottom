/** HTMX handler — terminate a specific finding. Pattern-matched from retry.ts. */
import { define } from "../../../lib/define.ts";
import { apiPost } from "../../../lib/api.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const url = new URL(ctx.req.url);
    const findingId = url.searchParams.get("findingId") ?? "";
    if (!findingId) {
      return new Response(`<span class="error-text">findingId required</span>`, {
        status: 400,
        headers: { "content-type": "text/html" },
      });
    }
    try {
      await apiPost(`/admin/terminate-finding`, ctx.req, { findingId });
      // 204 so HTMX with hx-swap="none" doesn't clobber the row; caller's
      // after-request hook refreshes the table.
      return new Response(null, { status: 204 });
    } catch (e) {
      return new Response(`<span class="error-text">${e}</span>`, {
        status: 500,
        headers: { "content-type": "text/html" },
      });
    }
  },
});
