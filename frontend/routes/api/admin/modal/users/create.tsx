/** POST: Create user, return refreshed members list. */
import { define } from "../../../../../lib/define.ts";
import { apiPost } from "../../../../../lib/api.ts";
import { renderUsersModal } from "../users.tsx";

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const payload = {
      email: form.get("email") as string,
      password: form.get("password") as string,
      role: form.get("role") as string,
      supervisor: (form.get("supervisor") as string) || undefined,
    };

    try {
      await apiPost("/admin/users", ctx.req, payload);
    } catch (e) {
      return new Response(
        `<div style="color:var(--red);font-size:12px;padding:12px;">Error: ${(e as Error).message}</div>`,
        { headers: { "content-type": "text/html" } },
      );
    }

    // Return the updated members list directly
    return renderUsersModal(ctx.req, { tab: "list" });
  },
});
