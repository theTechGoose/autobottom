/** POST: delete a config + all its questions. Redirects browser to /question-lab. */
import { define } from "../../../../lib/define.ts";
import { apiPost } from "../../../../lib/api.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const url = new URL(ctx.req.url);
    const id = url.searchParams.get("id") ?? "";
    if (!id) return new Response("id required", { status: 400 });
    try {
      await apiPost("/api/qlab/configs/delete", ctx.req, { id });
    } catch (_e) { /* ignore — drop them on the page either way */ }
    return new Response(null, {
      status: 200,
      headers: { "HX-Redirect": "/question-lab" },
    });
  },
});
