/** POST: Create or update email report config. Returns updated modal HTML directly (no redirect). */
import { define } from "../../../../../lib/define.ts";
import { apiPost } from "../../../../../lib/api.ts";
import { renderReportsModal } from "../email-reports.tsx";

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const payload: Record<string, unknown> = {
      name: form.get("name") as string,
      recipients: ((form.get("recipients") as string) ?? "").split("\n").map(s => s.trim()).filter(Boolean),
      schedule: form.get("schedule") as string,
      enabled: form.has("enabled"),
    };
    const id = form.get("id") as string;
    if (id) payload.id = id;

    try {
      await apiPost("/admin/email-reports", ctx.req, payload);
    } catch (e) {
      return new Response(
        `<div style="color:var(--red);font-size:12px;padding:12px;">Error: ${(e as Error).message}</div>`,
        { headers: { "content-type": "text/html" } },
      );
    }

    // Return list view directly — no redirect
    return renderReportsModal(ctx.req, { view: "list" });
  },
});
