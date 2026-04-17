/** Proxy to backend /audit/api/appeal — files a judge appeal for a finding.
 *  Called by the AppealModal island; returns JSON so the island can react. */
import { define } from "../../../../lib/define.ts";
import { apiPost, parseHtmxBody } from "../../../../lib/api.ts";

export const handler = define.handlers({
  async POST(ctx) {
    try {
      const body = await parseHtmxBody(ctx.req);
      const result = await apiPost<{ ok?: boolean; queued?: number; judgeUrl?: string; error?: string }>(
        "/audit/api/appeal", ctx.req, body,
      );
      return Response.json(result);
    } catch (e) {
      return Response.json({ ok: false, error: String(e) }, { status: 500 });
    }
  },
});
