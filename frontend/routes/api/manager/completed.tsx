/** HTMX fragment — the Completed tab's table: remediated queue items only
 *  (same scoped /manager/api/queue read as the Queue tab), newest first.
 *  Reuses renderQueueTable in `completed` mode (Remediated By / When columns). */
import { define } from "../../../lib/define.ts";
import { apiFetch } from "../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import { renderQueueTable, isOpenItem, closedOutAt, type QueueItem } from "./queue.tsx";

export const handler = define.handlers({
  async GET(ctx) {
    try {
      // Forward `as` so an admin impersonating a manager (?as=<email>) gets
      // that manager's completed items — same convention as the Queue tab.
      const asEmail = new URL(ctx.req.url).searchParams.get("as");
      const qs = asEmail ? `?as=${encodeURIComponent(asEmail)}` : "";
      const { items } = await apiFetch<{ items: QueueItem[] }>(`/manager/api/queue${qs}`, ctx.req);
      // Everything closed out, newest first — remediated rows and rows an
      // appeal took off the queue, ordered by whichever of those happened.
      const completed = (items ?? [])
        .filter((i) => !isOpenItem(i))
        .sort((a, b) => closedOutAt(b) - closedOutAt(a));
      const html = renderToString(renderQueueTable(completed, { completed: true }));
      return new Response(html, { headers: { "content-type": "text/html" } });
    } catch {
      return new Response(
        `<div class="placeholder-card">Failed to load completed items</div>`,
        { headers: { "content-type": "text/html" } },
      );
    }
  },
});
