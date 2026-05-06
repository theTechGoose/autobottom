/** Frontend wrapper — release a stranded review claim and redirect to dashboard.
 *
 *  Called from the QueueModals "Discard This Audit" link when a reviewer
 *  doesn't want to finalize the in-flight audit. Forwards to backend
 *  `/review/api/discard` which moves any active claims + recorded decisions
 *  back to review-pending so the audit isn't stuck.
 *
 *  Returns `HX-Redirect: /review/dashboard` for HTMX-friendly navigation,
 *  plus a JSON-y body so non-HTMX `fetch()` callers can detect success. */
import { define } from "../../../lib/define.ts";
import { apiPost, parseHtmxBody } from "../../../lib/api.ts";

export const handler = define.handlers({
  async POST(ctx) {
    try {
      const body = await parseHtmxBody(ctx.req);
      const findingId = String(body.findingId ?? "");
      const reviewer = String(body.reviewer ?? "");
      if (!findingId || !reviewer) {
        return Response.json({ ok: false, error: "findingId and reviewer required" }, { status: 400 });
      }
      const result = await apiPost<{ ok?: boolean; restored?: number; error?: string }>(
        "/review/api/discard", ctx.req, { findingId, reviewer },
      );
      if (!result.ok) {
        return Response.json({ ok: false, error: result.error ?? "discard failed" }, { status: 500 });
      }
      return new Response(
        JSON.stringify({ ok: true, restored: result.restored ?? 0 }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "HX-Redirect": "/review/dashboard",
          },
        },
      );
    } catch (e) {
      console.error("❌ [DISCARD] failed:", e);
      return Response.json({ ok: false, error: String(e) }, { status: 500 });
    }
  },
});
