/** Proxy to backend /audit/api/appeal/different-recording — starts a re-audit
 *  with one or more genie IDs. Returns JSON with the new findingId + report URL.
 *  Forwards the backend's status code and body verbatim so the island can show
 *  any real error message instead of a generic HTTP 500. */
import { define } from "../../../../lib/define.ts";
import { parseHtmxBody } from "../../../../lib/api.ts";

const API_URL = () => Deno.env.get("API_URL") ?? "http://localhost:3000";

export const handler = define.handlers({
  async POST(ctx) {
    try {
      const body = await parseHtmxBody(ctx.req);
      const cookie = ctx.req.headers.get("cookie") ?? "";
      const res = await fetch(`${API_URL()}/audit/api/appeal/different-recording`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      return new Response(text, {
        status: res.status,
        headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
      });
    } catch (e) {
      const msg = String(e);
      console.error(`❌ [PROXY:/api/audit/appeal/different-recording] ${msg}`);
      return Response.json({ ok: false, error: msg }, { status: 500 });
    }
  },
});
