/** POST: Create user, return refreshed members list. */
import { define } from "../../../../../lib/define.ts";
import { apiPost } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

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
      const html = renderToString(
        <div style="color:var(--red);font-size:12px;padding:12px;">Error: {(e as Error).message}</div>
      );
      return new Response(html, { headers: { "content-type": "text/html" } });
    }

    // Return a trigger to reload the modal with the list tab
    return new Response(
      `<div style="color:var(--green);font-size:12px;padding:12px;">User created! Refreshing...</div>`,
      { headers: { "content-type": "text/html", "HX-Trigger": "modal-open" } },
    );
  },
});
