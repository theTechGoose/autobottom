/** GET handler: Check QStash queue status. */
import { define } from "../../../../../lib/define.ts";
import { apiFetch } from "../../../../../lib/api.ts";

export const handler = define.handlers({
  async GET(ctx) {
    try {
      const data = await apiFetch<Record<string, unknown>>("/admin/queues", ctx.req);
      const html = `<div style="font-size:11px;color:var(--green);padding:4px 0;">Queue OK — ${JSON.stringify(data)}</div>`;
      return new Response(html, { headers: { "content-type": "text/html" } });
    } catch (e) {
      const html = `<div style="font-size:11px;color:var(--red);padding:4px 0;">Error: ${(e as Error).message}</div>`;
      return new Response(html, { headers: { "content-type": "text/html" } });
    }
  },
});
