/** Proxy to backend /audit/api/appeal — files a judge appeal for a finding.
 *  Called by the AppealModal island; returns JSON so the island can react.
 *  Forwards the backend's error body verbatim so the modal can show the real
 *  reason instead of a generic "HTTP 500". */
import { define } from "../../../lib/define.ts";
import { parseHtmxBody } from "../../../lib/api.ts";

const API_URL = () => Deno.env.get("API_URL") ?? "http://localhost:3000";

export const handler = define.handlers({
  async POST(ctx) {
    try {
      const body = await parseHtmxBody(ctx.req);
      const cookie = ctx.req.headers.get("cookie") ?? "";
      const res = await fetch(`${API_URL()}/audit/api/appeal`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      // Pass backend JSON (or its error body) through so the island can show
      // data.error verbatim. Keep backend's status code.
      return new Response(text, {
        status: res.status,
        headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
      });
    } catch (e) {
      const msg = String(e);
      console.error(`❌ [PROXY:/api/audit/appeal] ${msg}`);
      return Response.json({ ok: false, error: msg }, { status: 500 });
    }
  },
});
