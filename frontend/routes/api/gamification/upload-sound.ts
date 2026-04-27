/** Multipart proxy → backend direct-dispatch handler. */
import { define } from "../../../lib/define.ts";

const API_URL = () => Deno.env.get("API_URL") ?? "http://localhost:3000";

export const handler = define.handlers({
  async POST(ctx) {
    let form: FormData;
    try { form = await ctx.req.formData(); }
    catch { return Response.json({ ok: false, error: "multipart/form-data required" }, { status: 400 }); }
    const out = new FormData();
    for (const [k, v] of form.entries()) out.append(k, v);
    const cookie = ctx.req.headers.get("cookie") ?? "";
    try {
      const res = await fetch(`${API_URL()}/gamification/api/upload-sound`, { method: "POST", headers: { cookie }, body: out });
      const text = await res.text();
      return new Response(text, { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json" } });
    } catch (e) { return Response.json({ ok: false, error: String(e) }, { status: 500 }); }
  },
});
