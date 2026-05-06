/** POST: create a new config from an inline form (name + type), then
 *  redirect via HX-Redirect to the new config's detail page. Mirrors prod's
 *  /question-lab "+ New Config" inline-form flow. */
import { define } from "../../../../lib/define.ts";
import { apiPost } from "../../../../lib/api.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const name = String(form.get("name") ?? "").trim();
    const type = String(form.get("type") ?? "internal") === "partner" ? "partner" : "internal";

    if (!name) {
      return new Response(`<span style="color:var(--red);font-size:11px;">Name is required.</span>`, {
        headers: { "content-type": "text/html" },
      });
    }

    try {
      const r = await apiPost<{ id?: string }>("/api/qlab/configs", ctx.req, { name, type });
      const id = r.id;
      if (!id) throw new Error("backend did not return an id");
      return new Response(null, { status: 200, headers: { "HX-Redirect": `/question-lab/config/${id}` } });
    } catch (err) {
      return new Response(`<span style="color:var(--red);font-size:11px;">${(err as Error).message}</span>`, {
        headers: { "content-type": "text/html" },
      });
    }
  },
});
