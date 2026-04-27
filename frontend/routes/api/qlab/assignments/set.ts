/** POST: bind an internal-destination or partner-office to this config. */
import { define } from "../../../../lib/define.ts";
import { apiPost, parseHtmxBody } from "../../../../lib/api.ts";
import { okFragment, errorFragment, htmlResponse } from "../../../../lib/qlab-render.tsx";

export const handler = define.handlers({
  async POST(ctx) {
    const body = await parseHtmxBody(ctx.req);
    const type = String(body.type ?? "internal");
    const key = String(body.key ?? "").trim();
    const value = String(body.value ?? "").trim();
    if (!key || !value) return htmlResponse(errorFragment("key + value required"), 400);
    try {
      await apiPost("/api/qlab-assignments", ctx.req, { type, key, value });
      return htmlResponse(okFragment(`Bound ${key} → ${value}.`));
    } catch (e) {
      return htmlResponse(errorFragment(`Bind failed: ${(e as Error).message}`), 500);
    }
  },
});
