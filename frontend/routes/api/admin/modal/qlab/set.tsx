/** POST: bind a destination/office to a QLab config (or unbind via empty
 *  configName). Re-renders the modal in the active tab. */
import { define } from "../../../../../lib/define.ts";
import { apiPost } from "../../../../../lib/api.ts";
import { renderQlabModal, type QlabTab } from "../qlab.tsx";

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const type: QlabTab = form.get("type") === "partner" ? "partner" : "internal";
    const key = String(form.get("key") ?? "").trim();
    const configName = String(form.get("configName") ?? "").trim();

    if (!key) {
      return renderQlabModal(ctx.req, { tab: type, message: "" });
    }

    try {
      await apiPost("/api/qlab-assignments", ctx.req, {
        type,
        key,
        value: configName || null,
      });
    } catch (err) {
      console.error("[qlab/set] failed:", err);
    }

    const message = configName
      ? `Assigned ${key} → ${configName}`
      : `Removed assignment for ${key}`;
    return renderQlabModal(ctx.req, { tab: type, message });
  },
});
