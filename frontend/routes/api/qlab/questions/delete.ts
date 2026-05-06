/** POST: delete a question. Redirects back to the config view. */
import { define } from "../../../../lib/define.ts";
import { apiPost } from "../../../../lib/api.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const url = new URL(ctx.req.url);
    const id = url.searchParams.get("id") ?? "";
    const configId = url.searchParams.get("configId") ?? "";
    if (!id) return new Response("id required", { status: 400 });
    try {
      await apiPost("/api/qlab/questions/delete", ctx.req, { id });
    } catch (_e) { /* swallow */ }
    return new Response(null, {
      status: 200,
      headers: { "HX-Redirect": `/question-lab?configId=${configId}` },
    });
  },
});
