/** POST: Delete an email template. */
import { define } from "../../../../../lib/define.ts";
import { apiPost } from "../../../../../lib/api.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const url = new URL(ctx.req.url);
    const id = url.searchParams.get("id") ?? "";
    if (id) {
      try { await apiPost("/admin/email-templates/delete", ctx.req, { id }); } catch {}
    }
    return Response.redirect(new URL("/api/admin/modal/email-templates", ctx.req.url), 303);
  },
});
