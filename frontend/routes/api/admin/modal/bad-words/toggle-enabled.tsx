/** POST: Toggle the enabled flag on bad word config. */
import { define } from "../../../../../lib/define.ts";
import { apiFetch, apiPost } from "../../../../../lib/api.ts";

export const handler = define.handlers({
  async POST(ctx) {
    let config: Record<string, unknown> = {};
    try { config = await apiFetch("/admin/bad-word-config", ctx.req); } catch {}
    config.enabled = !config.enabled;
    try { await apiPost("/admin/bad-word-config", ctx.req, config); } catch {}
    return new Response(null, { status: 204 });
  },
});
