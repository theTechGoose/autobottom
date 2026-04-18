/** Super Admin proxy — forwards {action, orgId, ...} to the matching backend
 *  endpoint. action ∈ create | seed | wipe | delete. */
import { define } from "../../../lib/define.ts";
import { apiPost, parseHtmxBody } from "../../../lib/api.ts";

const ACTIONS: Record<string, string> = {
  create: "/admin/super-admin/org-create",
  seed:   "/admin/super-admin/org-seed",
  wipe:   "/admin/super-admin/org-wipe",
  delete: "/admin/super-admin/org-delete",
};

export const handler = define.handlers({
  async POST(ctx) {
    try {
      const body = await parseHtmxBody(ctx.req);
      const action = String(body.action ?? "");
      const endpoint = ACTIONS[action];
      if (!endpoint) return Response.json({ error: `unknown action: ${action}` }, { status: 400 });
      const { action: _a, ...rest } = body;
      const data = await apiPost<Record<string, unknown>>(endpoint, ctx.req, rest);
      return Response.json(data);
    } catch (e) {
      return Response.json({ error: String(e) }, { status: 500 });
    }
  },
});
