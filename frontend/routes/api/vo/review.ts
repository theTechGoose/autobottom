/** Submit a TM review (REQ-035). On success the dashboard's tables refresh in
 *  place; from an audit page HTMX goes back to the queue it came from. A refusal says why in the modal, and keeps its real status
 *  (409 already reviewed, 403 not this login's audit, 400 no write-up) for
 *  anything that isn't HTMX. */
import { define } from "../../../lib/define.ts";
import { apiPost } from "../../../lib/api.ts";
import { renderVoFragment } from "./queue.tsx";

const REASONS: Record<string, string> = {
  "already-reviewed": "This audit has already been reviewed.",
  "not-in-scope": "This audit isn't in this login's queue.",
  "note-required": "Write up what you reviewed first.",
};

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const findingId = form.get("findingId")?.toString() ?? "";
    const note = form.get("note")?.toString() ?? "";
    const asEmail = form.get("as")?.toString() ?? new URL(ctx.req.url).searchParams.get("as") ?? "";
    const returnTo = form.get("returnTo")?.toString() ?? "";
    const fallback = asEmail ? `/vo?as=${encodeURIComponent(asEmail)}` : "/vo";
    // Same-origin absolute paths only, so a crafted form can't open-redirect.
    const safeReturn = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : fallback;
    try {
      await apiPost(`/vo/api/review${asEmail ? `?as=${encodeURIComponent(asEmail)}` : ""}`, ctx.req, { findingId, note });
      if (form.get("inplace") === "1") {
        // Dashboard: re-render the tables in place with the filters the form
        // carried, and tell the modal to close (see renderVoReviewModal).
        const sp = new URLSearchParams();
        for (const k of ["since", "until", "member", "wgs", "mcc", "as"]) {
          const v = form.get(k)?.toString();
          if (v) sp.set(k, v);
        }
        return new Response(await renderVoFragment(ctx.req, sp), {
          status: 200,
          headers: { "content-type": "text/html", "HX-Retarget": "#vo-queue-table", "HX-Reswap": "innerHTML", "HX-Trigger": "vo-reviewed" },
        });
      }
      return new Response(null, { status: 200, headers: { "HX-Redirect": safeReturn } });
    } catch (e) {
      const status = (e as { status?: number }).status ?? 500;
      // ApiError's message carries the backend body: {"error":"<code>"}.
      const code = /"error":"([^"]+)"/.exec(String((e as Error).message))?.[1] ?? "";
      const message = REASONS[code] ?? "Couldn't save the review — try again.";
      // htmx 2 won't swap an error status, so the modal gets a 200 carrying
      // the reason; anything else gets the real status.
      const isHtmx = ctx.req.headers.get("hx-request") === "true";
      return new Response(`<span class="error-text">${message}</span>`, {
        status: isHtmx ? 200 : status,
        headers: { "content-type": "text/html" },
      });
    }
  },
});
