/** POST: Create or update email report config. */
import { define } from "../../../../../lib/define.ts";
import { apiPost } from "../../../../../lib/api.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const payload: Record<string, unknown> = {
      name: form.get("name") as string,
      recipients: ((form.get("recipients") as string) ?? "").split("\n").map(s => s.trim()).filter(Boolean),
      schedule: form.get("schedule") as string,
      enabled: form.has("enabled"),
    };
    const id = form.get("id") as string;
    if (id) payload.id = id;

    try {
      await apiPost("/admin/email-reports", ctx.req, payload);
    } catch (e) {
      return new Response(`<div style="color:var(--red);font-size:12px;padding:12px;">Error: ${(e as Error).message}</div>`, { headers: { "content-type": "text/html" } });
    }

    // Redirect back to list
    return Response.redirect(new URL("/api/admin/modal/email-reports", ctx.req.url), 303);
  },
});
