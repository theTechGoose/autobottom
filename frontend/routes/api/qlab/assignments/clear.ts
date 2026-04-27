/** POST: unbind an assignment. Removes that row from the list (hx-swap="outerHTML" replaces with empty). */
import { define } from "../../../../lib/define.ts";
import { apiPost } from "../../../../lib/api.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const url = new URL(ctx.req.url);
    const type = url.searchParams.get("type") ?? "internal";
    const key = url.searchParams.get("key") ?? "";
    if (!key) return new Response("key required", { status: 400 });
    try {
      await apiPost("/api/qlab-assignments", ctx.req, { type, key, value: null });
    } catch (_e) { /* swallow */ }
    return new Response("", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
});
