/** POST: unbind a destination/office from its QLab config. Re-renders the
 *  modal in the active tab. */
import { define } from "../../../../../lib/define.ts";
import { apiPost } from "../../../../../lib/api.ts";
import { renderQlabModal, type QlabTab } from "../qlab.tsx";

export const handler = define.handlers({
  async POST(ctx) {
    const url = new URL(ctx.req.url);
    const type: QlabTab = url.searchParams.get("type") === "partner" ? "partner" : "internal";
    const key = String(url.searchParams.get("key") ?? "").trim();

    if (key) {
      try {
        await apiPost("/api/qlab-assignments", ctx.req, { type, key, value: null });
      } catch (err) {
        console.error("[qlab/clear] failed:", err);
      }
    }

    return renderQlabModal(ctx.req, { tab: type, message: key ? `Removed assignment for ${key}` : "" });
  },
});
