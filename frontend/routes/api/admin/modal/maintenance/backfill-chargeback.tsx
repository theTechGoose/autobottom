/** Backfill / repair chargeback ("payroll") entries from current finding state.
 *  POSTs since/until (ms) to the backend, which re-reads each chargeback + wire
 *  entry's finding in the window and rewrites it to the finding's CURRENT
 *  answers/score — DELETING an entry whose audit now passes (e.g. a reviewer
 *  flipped it to 100%) or rewriting it to the reviewed score + remaining fails.
 *  This is what clears stale "failed VO" rows from the chargeback sheet after a
 *  review. Idempotent — safe to re-run. Renders the {scanned/updated/deleted}
 *  counts into #maint-msg. */

import { define } from "../../../../../lib/define.ts";
import { apiFetch } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

interface Resp {
  scanned?: number;
  cbUpdated?: number;
  cbDeleted?: number;
  wireUpdated?: number;
  error?: string;
}

/** "YYYY-MM-DD" → ms at UTC midnight (To gets the END of the picked day so the
 *  window is inclusive), matching the entry's completedAt basis. */
function parseDateToMs(s: string, endOfDay = false): number | null {
  if (!s) return null;
  const ts = Date.parse(s + "T00:00:00Z");
  if (!Number.isFinite(ts)) return null;
  return endOfDay ? ts + 86_400_000 - 1 : ts;
}

function errBox(msg: string): Response {
  const html = renderToString(
    <div class="error-text" style="font-size:11px;padding:10px;border:1px solid var(--red);border-radius:6px;">{msg}</div>,
  );
  return new Response(html, { headers: { "content-type": "text/html" } });
}

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const since = parseDateToMs(String(form.get("since") ?? "").trim());
    const until = parseDateToMs(String(form.get("until") ?? "").trim(), true);
    if (since == null || until == null || until <= since) {
      return errBox("Both From and To dates are required and To must be after From.");
    }

    let r: Resp;
    try {
      r = await apiFetch<Resp>("/admin/backfill-chargeback-entries", ctx.req, {
        method: "POST",
        body: JSON.stringify({ since, until }),
        headers: { "content-type": "application/json" },
      });
    } catch (e) {
      return errBox(`Backfill failed: ${String((e as Error).message ?? e)}`);
    }
    if (r.error) return errBox(`Backend rejected: ${r.error}`);

    const scanned = r.scanned ?? 0;
    const cbDeleted = r.cbDeleted ?? 0;
    const cbUpdated = r.cbUpdated ?? 0;
    const wireUpdated = r.wireUpdated ?? 0;
    const html = renderToString(
      <div style="border:1px solid var(--border);border-radius:6px;padding:12px;background:var(--bg);">
        <div style="font-size:12px;font-weight:700;color:var(--green);margin-bottom:8px;">✓ Chargeback entries reconciled</div>
        <div style="display:grid;grid-template-columns:auto auto;gap:4px 18px;font-size:11px;color:var(--text);width:fit-content;">
          <span style="color:var(--text-dim);">Entries scanned</span><strong>{scanned}</strong>
          <span style="color:var(--text-dim);">Stale fails removed</span><strong style="color:var(--green);">{cbDeleted}</strong>
          <span style="color:var(--text-dim);">Chargebacks rewritten</span><strong>{cbUpdated}</strong>
          <span style="color:var(--text-dim);">Wire entries rewritten</span><strong>{wireUpdated}</strong>
        </div>
        <div style="font-size:10px;color:var(--text-dim);margin-top:10px;line-height:1.4;">
          "Removed" = audits that now pass on review and are no longer chargeable. The live
          Failed Audits report reflects this immediately; re-run the weekly export to refresh the Google Sheet.
        </div>
      </div>,
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
