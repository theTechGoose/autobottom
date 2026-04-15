/** POST: Trigger immediate send of an email report. */
import { define } from "../../../../../lib/define.ts";
import { apiPost } from "../../../../../lib/api.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const url = new URL(ctx.req.url);
    const id = url.searchParams.get("id") ?? "";
    try {
      await apiPost("/admin/email-reports/send-now", ctx.req, { id });
      return new Response(`<span style="font-size:11px;color:var(--green);">Sent!</span>`, { headers: { "content-type": "text/html" } });
    } catch (e) {
      return new Response(`<span style="font-size:11px;color:var(--red);">Error: ${(e as Error).message}</span>`, { headers: { "content-type": "text/html" } });
    }
  },
});
