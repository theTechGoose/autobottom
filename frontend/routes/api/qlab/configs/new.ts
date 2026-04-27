/** POST: create a new QLab config with a default name. Returns updated sidebar list. */
import { define } from "../../../../lib/define.ts";
import { apiPost } from "../../../../lib/api.ts";
import { htmlResponse, renderConfigList, errorFragment } from "../../../../lib/qlab-render.tsx";

export const handler = define.handlers({
  async POST(ctx) {
    try {
      const name = "New Config " + new Date().toISOString().slice(11, 19);
      const created = await apiPost<{ id?: string }>("/api/qlab/configs", ctx.req, { name, type: "internal" });
      const html = await renderConfigList(ctx.req, created?.id);
      return htmlResponse(html);
    } catch (e) {
      return htmlResponse(errorFragment(`Failed to create config: ${(e as Error).message}`), 500);
    }
  },
});
