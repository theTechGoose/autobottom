/** POST: Delete an email report config. Returns updated modal HTML directly (no redirect). */
import { define } from "../../../../../lib/define.ts";
import { apiPost } from "../../../../../lib/api.ts";
import { renderReportsModal } from "../email-reports.tsx";

export const handler = define.handlers({
  async POST(ctx) {
    const url = new URL(ctx.req.url);
    const id = url.searchParams.get("id") ?? "";
    if (id) {
      try { await apiPost("/admin/email-reports/delete", ctx.req, { id }); } catch {}
    }
    return renderReportsModal(ctx.req, { view: "list" });
  },
});
