/** GET handler: read live QStash queue counts and render a formatted list
 *  (one row per queue with color-coded count). Replaces the prior raw-JSON
 *  dump that just stringified the response object. */
import { define } from "../../../../../lib/define.ts";
import { apiFetch } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

interface QueueResponse { queues?: Record<string, number> }

function tone(count: number): string {
  if (count <= 0) return "idle";
  if (count < 10) return "busy";
  if (count < 50) return "hot";
  return "full";
}

export const handler = define.handlers({
  async GET(ctx) {
    let data: QueueResponse | Record<string, number> = {};
    try {
      data = await apiFetch<QueueResponse | Record<string, number>>("/admin/queues", ctx.req);
    } catch (e) {
      const html = renderToString(
        <div style="font-size:11px;color:var(--red);padding:4px 0;">Error: {(e as Error).message}</div>,
      );
      return new Response(html, { headers: { "content-type": "text/html" } });
    }

    // Backend may return either { queues: {...} } or the bare record itself.
    const counts: Record<string, number> = ((data as QueueResponse).queues
      ?? (data as Record<string, number>)) || {};
    const entries = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
    const total = entries.reduce((s, [, n]) => s + (Number(n) || 0), 0);

    const html = renderToString(
      <div>
        <div style="display:flex;align-items:center;justify-content:space-between;font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.8px;margin-bottom:4px;">
          <span>{entries.length} queue{entries.length === 1 ? "" : "s"}</span>
          <span>{total} pending overall</span>
        </div>
        {entries.length === 0
          ? <div style="font-size:11px;color:var(--text-dim);padding:6px 0;">No queues reporting.</div>
          : (
            <div class="pm-queue-list">
              {entries.map(([name, count]) => {
                const n = Number(count) || 0;
                return (
                  <>
                    <div class="pm-queue-name">{name}</div>
                    <div class={`pm-queue-count ${tone(n)}`}>{n}</div>
                  </>
                );
              })}
            </div>
          )}
      </div>,
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
