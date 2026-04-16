/** HTMX handler — queue management actions (pause, resume, clear, terminate). */
import { define } from "../../../lib/define.ts";
import { apiPost } from "../../../lib/api.ts";

const ACTIONS: Record<string, string> = {
  pause: "/admin/pause-queues",
  resume: "/admin/resume-queues",
  "clear-review": "/admin/clear-review-queue",
  "clear-errors": "/admin/clear-errors",
  "terminate-all": "/admin/terminate-all",
};

export const handler = define.handlers({
  async POST(ctx) {
    try {
      const body = await ctx.req.json();
      const action = body.action;
      const endpoint = ACTIONS[action];
      if (!endpoint) {
        return new Response(`<span class="qa-status err">Unknown action: ${action}</span>`, {
          status: 400,
          headers: { "content-type": "text/html" },
        });
      }
      await apiPost(endpoint, ctx.req, {});
      // Small HTML snippet so the visible status slot shows success — the
      // caller button's after-request hook clears it after ~2s.
      return new Response(`<span class="qa-status ok">✓ ${action} done</span>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    } catch (e) {
      return new Response(`<span class="qa-status err">✗ ${String(e)}</span>`, {
        status: 500,
        headers: { "content-type": "text/html" },
      });
    }
  },
});
