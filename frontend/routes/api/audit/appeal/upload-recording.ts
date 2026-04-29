/** Proxy to backend /audit/api/appeal/upload-recording — forwards the
 *  multipart file upload (audio + optional snip range) to the backend's
 *  direct-dispatch handler in main.ts. Returns JSON with the new findingId.
 *
 *  We read the incoming FormData and rebuild it for the backend call rather
 *  than streaming the raw body, so the request lands as a well-formed
 *  multipart body on the backend (where main.ts does `req.formData()`). */
import { define } from "../../../../lib/define.ts";

const API_URL = () => Deno.env.get("API_URL") ?? "http://localhost:3000";

export const handler = define.handlers({
  async POST(ctx) {
    let form: FormData;
    try {
      form = await ctx.req.formData();
    } catch {
      return Response.json({ ok: false, error: "multipart/form-data required" }, { status: 400 });
    }

    // Re-wrap into a fresh FormData so fetch() sets a correct boundary.
    const out = new FormData();
    for (const [k, v] of form.entries()) out.append(k, v);

    const cookie = ctx.req.headers.get("cookie") ?? "";
    try {
      const res = await fetch(`${API_URL()}/audit/api/appeal/upload-recording`, {
        method: "POST",
        headers: { cookie },
        body: out,
      });
      const text = await res.text();
      return new Response(text, {
        status: res.status,
        headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
      });
    } catch (e) {
      return Response.json({ ok: false, error: String(e) }, { status: 500 });
    }
  },
});
