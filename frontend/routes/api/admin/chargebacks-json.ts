/** JSON proxy — chargebacks / wire-deductions data for the ChargebacksToolbar
 *  island. Uses `since` + `until` as millisecond timestamps (not `from`/`to`
 *  date strings) so the island can pass them directly to the post-to-sheet
 *  endpoint without re-parsing. */
import { define } from "../../../lib/define.ts";
import { apiFetch } from "../../../lib/api.ts";

export const handler = define.handlers({
  async GET(ctx) {
    try {
      const url = new URL(ctx.req.url);
      const tab = url.searchParams.get("tab") ?? "cb";
      const since = url.searchParams.get("since") ?? "";
      const until = url.searchParams.get("until") ?? "";
      if (!since || !until) return Response.json({ error: "since + until required" }, { status: 400 });
      const path = tab === "wire" ? "/admin/wire-deductions" : "/admin/chargebacks";
      const data = await apiFetch<Record<string, unknown>>(
        `${path}?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}`,
        ctx.req,
      );
      return Response.json(data);
    } catch (e) {
      return Response.json({ error: String(e) }, { status: 500 });
    }
  },
});
