/** POST: restore ONE finding wrongly hidden as a duplicate — un-hide it and
 *  re-assert its index rows on the backend, then re-render the Find-by-Record
 *  results in place (the "duplicate" badge disappears, the row stays). */
import { define } from "../../../lib/define.ts";
import { apiPost, parseHtmxBody } from "../../../lib/api.ts";
import { renderFindByRecord } from "./find-by-record.tsx";

export const handler = define.handlers({
  async POST(ctx) {
    const body = await parseHtmxBody(ctx.req);
    const findingId = String((body as Record<string, unknown>).findingId ?? "").trim();
    const recordId = String((body as Record<string, unknown>).recordId ?? "").trim();
    if (!findingId) {
      return new Response(`<div id="fbr-results"><span class="error-text">Missing findingId</span></div>`, {
        headers: { "content-type": "text/html" },
      });
    }
    try {
      await apiPost<{ ok?: boolean; error?: string }>("/admin/restore-finding", ctx.req, { findingId });
    } catch (e) {
      return new Response(
        `<div id="fbr-results"><span class="error-text">Restore failed: ${String(e).slice(0, 120)}</span></div>`,
        { headers: { "content-type": "text/html" } },
      );
    }
    // Re-render the lookup so the restored finding shows un-flagged.
    return await renderFindByRecord(ctx.req, recordId);
  },
});
