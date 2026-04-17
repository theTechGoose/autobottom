/** Proxy to backend /audit/api/appeal/different-recording — starts a re-audit
 *  with one or more genie IDs. Returns JSON with the new findingId + report URL. */
import { define } from "../../../../../lib/define.ts";
import { apiPost, parseHtmxBody } from "../../../../../lib/api.ts";

export const handler = define.handlers({
  async POST(ctx) {
    try {
      const body = await parseHtmxBody(ctx.req);
      const result = await apiPost<{ ok?: boolean; newFindingId?: string; reportUrl?: string; appealType?: string; agentEmail?: string; error?: string }>(
        "/audit/api/appeal/different-recording", ctx.req, body,
      );
      return Response.json(result);
    } catch (e) {
      return Response.json({ ok: false, error: String(e) }, { status: 500 });
    }
  },
});
