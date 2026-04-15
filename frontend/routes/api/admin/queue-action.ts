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
      if (!endpoint) return new Response("Unknown action", { status: 400 });
      await apiPost(endpoint, ctx.req, {});
      return new Response(null, { status: 204 });
    } catch (e) {
      return new Response(String(e), { status: 500 });
    }
  },
});
