/** POST: Delete a finding by ID. Returns a small status message. */
import { define } from "../../../../lib/define.ts";
import { apiFetch } from "../../../../lib/api.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const id = ((form.get("id") as string) ?? "").trim();
    if (!id) {
      return new Response(`<span style="color:var(--red);">Enter a finding ID</span>`, { headers: { "content-type": "text/html" } });
    }
    try {
      await apiFetch(`/admin/delete-finding?findingId=${encodeURIComponent(id)}`, ctx.req);
      return new Response(`<span style="color:var(--green);">Deleted ${id}</span>`, { headers: { "content-type": "text/html" } });
    } catch (e) {
      return new Response(`<span style="color:var(--red);">Delete failed: ${(e as Error).message}</span>`, { headers: { "content-type": "text/html" } });
    }
  },
});
