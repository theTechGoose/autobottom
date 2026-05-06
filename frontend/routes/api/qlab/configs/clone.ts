/** POST: clone a config (with all its questions). Returns updated sidebar list. */
import { define } from "../../../../lib/define.ts";
import { apiPost } from "../../../../lib/api.ts";
import { htmlResponse, renderConfigList, errorFragment } from "../../../../lib/qlab-render.tsx";

export const handler = define.handlers({
  async POST(ctx) {
    try {
      const url = new URL(ctx.req.url);
      const id = url.searchParams.get("id") ?? "";
      if (!id) return htmlResponse(errorFragment("id required"), 400);
      const cloned = await apiPost<{ id?: string }>("/api/qlab/configs/clone", ctx.req, { id });
      const html = await renderConfigList(ctx.req, cloned?.id);
      return htmlResponse(html);
    } catch (e) {
      return htmlResponse(errorFragment(`Clone failed: ${(e as Error).message}`), 500);
    }
  },
});
