/** POST: Create or update email template. Returns updated modal HTML directly (no redirect). */
import { define } from "../../../../../lib/define.ts";
import { apiPost } from "../../../../../lib/api.ts";
import { renderTemplatesModal } from "../email-templates.tsx";

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
      // Backend returns { ok, template: { id, ... } }
      const result = await apiPost<{ ok?: boolean; template?: { id?: string } }>("/admin/email-templates", ctx.req, payload);
      const savedId = result?.template?.id ?? id;
      // Return the updated modal directly — no redirect
      return renderTemplatesModal(ctx.req, { activeId: savedId || undefined });
    } catch (e) {
      return new Response(
        `<div style="color:var(--red);font-size:12px;padding:12px;">Error: ${(e as Error).message}</div>`,
        { headers: { "content-type": "text/html" } },
      );
    }
  },
});
