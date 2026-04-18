/** Proxy — POST /admin/seed to create the test-user set. */
import { define } from "../../../lib/define.ts";
import { apiPost } from "../../../lib/api.ts";

export const handler = define.handlers({
  async POST(ctx) {
    try {
      const data = await apiPost<Record<string, unknown>>("/admin/seed", ctx.req, {});
      return Response.json(data);
    } catch (e) {
      return Response.json({ error: String(e) }, { status: 500 });
    }
  },
});
