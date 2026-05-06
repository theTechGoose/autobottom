/** POST: Delete user, return refreshed members list. */
import { define } from "../../../../../lib/define.ts";
import { apiPost } from "../../../../../lib/api.ts";
import { renderUsersModal } from "../users.tsx";

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const email = form.get("email") as string;
    if (email) {
      try { await apiPost("/admin/users/delete", ctx.req, { email }); } catch {}
    }
    // Return the refreshed members list directly
    return renderUsersModal(ctx.req, { tab: "list" });
  },
});
