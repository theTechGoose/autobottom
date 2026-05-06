/** HTMX fragment — backfill manager queue, return refreshed queue table. */
import { define } from "../../../lib/define.ts";
import { apiFetch, apiPost } from "../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

interface QueueItem { findingId: string; agentEmail?: string; score?: number; status?: string; }

function pillColor(score?: number) {
  if (score == null) return "blue";
  if (score >= 90) return "green";
  if (score >= 70) return "yellow";
  return "red";
}

export const handler = define.handlers({
  async POST(ctx) {
    try {
      await apiPost("/manager/api/backfill", ctx.req, {});
      const { items } = await apiFetch<{ items: QueueItem[] }>("/manager/api/queue", ctx.req);
      const queue = items ?? [];
      const html = renderToString(
        <table class="data-table">
          <thead><tr><th>Finding</th><th>Agent</th><th>Score</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>
            {queue.length === 0 ? (
              <tr class="empty-row"><td colSpan={5}>No items in queue</td></tr>
            ) : queue.map((item) => (
              <tr
                key={item.findingId}
                style="cursor:pointer;"
                hx-get={`/api/manager/finding?findingId=${item.findingId}`}
                hx-target="#finding-detail-content"
                hx-swap="innerHTML"
                hx-trigger="click"
                {...{ "hx-on:click": "document.getElementById('finding-detail-modal').classList.add('open')" }}
              >
                <td class="mono">{item.findingId?.slice(0, 8)}</td>
                <td>{item.agentEmail ?? "\u2014"}</td>
                <td>{item.score != null ? <span class={`pill pill-${pillColor(item.score)}`}>{item.score}%</span> : "\u2014"}</td>
                <td><span class={`pill pill-${item.status === "remediated" ? "green" : "yellow"}`}>{item.status ?? "pending"}</span></td>
                <td>
                  <button
                    class="btn btn-ghost btn-sm"
                    {...{ "hx-on:click": `event.stopPropagation();document.getElementById('remediate-modal').classList.add('open');document.getElementById('rem-findingId').value='${item.findingId}'` }}
                  >Remediate</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>,
      );
      return new Response(html, { headers: { "content-type": "text/html" } });
    } catch (e) {
      return new Response(`<div class="placeholder-card error-text">Backfill failed: ${e}</div>`, { headers: { "content-type": "text/html" } });
    }
  },
});
