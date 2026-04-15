/** POST: Create or update email template. */
import { define } from "../../../../../lib/define.ts";
import { apiPost } from "../../../../../lib/api.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const payload: Record<string, unknown> = {
      name: form.get("name") as string,
      subject: form.get("subject") as string,
      html: form.get("html") as string,
    };
    const id = form.get("id") as string;
    if (id) payload.id = id;

    try {
      const result = await apiPost<{ id?: string }>("/admin/email-templates", ctx.req, payload);
      const savedId = result?.id ?? id;
      // Redirect to show the saved template
      if (savedId) {
        return Response.redirect(new URL(`/api/admin/modal/email-templates?id=${savedId}`, ctx.req.url), 303);
      }
      return Response.redirect(new URL("/api/admin/modal/email-templates", ctx.req.url), 303);
    } catch (e) {
      return new Response(`<div style="color:var(--red);font-size:12px;padding:12px;">Error: ${(e as Error).message}</div>`, { headers: { "content-type": "text/html" } });
    }
  },
});
