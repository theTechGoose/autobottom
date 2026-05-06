/** POST handler: Save pipeline + parallelism config. */
import { define } from "../../../../../lib/define.ts";
import { apiPost } from "../../../../../lib/api.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const parallelism = Number(form.get("parallelism")) || 5;
    const maxRetries = Number(form.get("maxRetries")) || 3;
    const retryDelaySeconds = Number(form.get("retryDelaySeconds")) || 30;

    try {
      await apiPost("/admin/parallelism", ctx.req, { parallelism });
      await apiPost("/admin/pipeline-config", ctx.req, { maxRetries, retryDelaySeconds });
      return new Response(`<span style="font-size:11px;color:var(--green);">Saved</span>`, { headers: { "content-type": "text/html" } });
    } catch (e) {
      return new Response(`<span style="font-size:11px;color:var(--red);">Error: ${(e as Error).message}</span>`, { headers: { "content-type": "text/html" } });
    }
  },
});
