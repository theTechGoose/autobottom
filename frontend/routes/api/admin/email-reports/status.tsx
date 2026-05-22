/** Thin proxy to /admin/email-reports/status — used by EmailReportEditor's
 *  status badge to look up the last-run state for a config without a full
 *  config refetch. Returns the EmailReportStatus shape (or {} if never run). */

import { define } from "../../../../lib/define.ts";
import { apiFetch } from "../../../../lib/api.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const configId = new URL(ctx.req.url).searchParams.get("configId") ?? "";
    if (!configId) return new Response(JSON.stringify({ error: "configId required" }), {
      status: 400, headers: { "content-type": "application/json" },
    });
    try {
      const data = await apiFetch<Record<string, unknown>>(
        `/admin/email-reports/status?configId=${encodeURIComponent(configId)}`,
        ctx.req,
      );
      return new Response(JSON.stringify(data ?? {}), { headers: { "content-type": "application/json" } });
    } catch (e) {
      console.error("[email-reports/status] proxy failed:", e);
      return new Response(JSON.stringify({}), { headers: { "content-type": "application/json" } });
    }
  },
});
