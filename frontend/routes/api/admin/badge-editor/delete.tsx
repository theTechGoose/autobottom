/** POST /api/admin/badge-editor/delete
 *  Forwards delete to backend, then redirects via HX-Redirect so the page
 *  reloads with the item gone. */
import { define } from "../../../../lib/define.ts";
import { apiPost, parseHtmxBody } from "../../../../lib/api.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const body = await parseHtmxBody(ctx.req);
    const id = String(body.id ?? "").trim();
    if (!id) {
      return new Response(`<div style="color:var(--red);font-size:12px;padding:10px;">id required</div>`, {
        status: 400,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    try {
      await apiPost("/admin/badge-editor/item/delete", ctx.req, { id });
    } catch (e) {
      return new Response(
        `<div style="color:var(--red);font-size:12px;padding:10px;">Delete failed: ${(e as Error).message}</div>`,
        { status: 500, headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }
    return new Response(null, {
      status: 200,
      headers: { "HX-Redirect": "/admin/badge-editor" },
    });
  },
});
