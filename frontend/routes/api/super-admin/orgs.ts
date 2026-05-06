/** Super Admin proxy — list orgs with counts. */
import { define } from "../../../lib/define.ts";
import { apiFetch } from "../../../lib/api.ts";

export const handler = define.handlers({
  async GET(ctx) {
    try {
      const data = await apiFetch<Record<string, unknown>>("/admin/super-admin/orgs", ctx.req);
      return Response.json(data);
    } catch (e) {
      return Response.json({ error: String(e) }, { status: 500 });
    }
  },
});
