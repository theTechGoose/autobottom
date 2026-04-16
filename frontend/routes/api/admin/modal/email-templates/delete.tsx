/** POST: Delete an email template. Returns updated modal HTML directly (no redirect). */
import { define } from "../../../../../lib/define.ts";
import { apiPost } from "../../../../../lib/api.ts";
import { renderTemplatesModal } from "../email-templates.tsx";

export const handler = define.handlers({
  async POST(ctx) {
    const url = new URL(ctx.req.url);
    const id = url.searchParams.get("id") ?? "";
    if (id) {
      try { await apiPost("/admin/email-templates/delete", ctx.req, { id }); } catch {}
    }
    return renderTemplatesModal(ctx.req, {});
  },
});
