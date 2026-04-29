/** POST: restore a previous question text version. Reads id + versionIndex
 *  from query params, posts JSON to the backend, redirects back to the
 *  editor page so the user sees the restored text. */
import { define } from "../../../../lib/define.ts";
import { apiPost } from "../../../../lib/api.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const url = new URL(ctx.req.url);
    const id = String(url.searchParams.get("id") ?? "").trim();
    const versionIndex = Number(url.searchParams.get("versionIndex") ?? "0");
    if (!id) return new Response("missing id", { status: 400 });

    try {
      await apiPost("/api/qlab/questions/restore", ctx.req, { id, versionIndex });
    } catch (err) {
      return new Response(`<div style="color:var(--red);font-size:11px;">${(err as Error).message}</div>`, {
        headers: { "content-type": "text/html" },
      });
    }
    return new Response(null, {
      status: 200,
      headers: { "HX-Redirect": `/question-lab/question/${id}` },
    });
  },
});
