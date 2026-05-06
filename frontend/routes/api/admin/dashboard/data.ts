/** JSON proxy — used by the PipelineActivityChart island to refetch
 *  pipeline.completedTs/errorsTs/retriesTs after a stats refresh. */
import { define } from "../../../../lib/define.ts";
import { apiFetch } from "../../../../lib/api.ts";

export const handler = define.handlers({
  async GET(ctx) {
    try {
      return Response.json(await apiFetch<Record<string, unknown>>("/admin/dashboard/data", ctx.req));
    } catch (e) {
      return Response.json({ error: String(e) }, { status: 500 });
    }
  },
});
