/** POST: Delete user, return refreshed members list. */
import { define } from "../../../../../lib/define.ts";
import { apiPost } from "../../../../../lib/api.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const email = form.get("email") as string;
    if (email) {
      try { await apiPost("/admin/users/delete", ctx.req, { email }); } catch {}
    }
    // Redirect back to list tab to show updated state
    return new Response(null, { status: 200, headers: { "HX-Redirect": "/api/admin/modal/users?tab=list", "content-type": "text/html" } });
  },
});
