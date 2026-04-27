/** POST: rename a config. Returns updated sidebar list. */
import { define } from "../../../../lib/define.ts";
import { apiPost, parseHtmxBody } from "../../../../lib/api.ts";
import { htmlResponse, renderConfigList, errorFragment } from "../../../../lib/qlab-render.tsx";

export const handler = define.handlers({
  async POST(ctx) {
    try {
      const body = await parseHtmxBody(ctx.req);
      const id = String(body.id ?? "");
      const name = String(body.name ?? "").trim();
      if (!id || !name) return htmlResponse(errorFragment("id + name required"), 400);
      await apiPost("/api/qlab/configs/update", ctx.req, { id, name });
      const html = await renderConfigList(ctx.req, id);
      return htmlResponse(html);
    } catch (e) {
      return htmlResponse(errorFragment(`Rename failed: ${(e as Error).message}`), 500);
    }
  },
});
