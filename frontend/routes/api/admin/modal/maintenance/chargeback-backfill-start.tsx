/** Chunked "Backfill Chargeback Entries" (payroll sheet repair) — kickoff.
 *
 *  Calls the backend /admin/chargeback-backfill-list (one fast index scan that
 *  returns the fids of chargeback + wire entries in the window), creates an
 *  in-memory job, and returns a ChargebackBackfillProgress fragment that
 *  auto-ticks /chargeback-backfill-tick a 25-fid chunk at a time — so no single
 *  request does the full per-finding loop and times out on Deno Deploy. */

import { define } from "../../../../../lib/define.ts";
import { apiPost } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import type { VNode } from "preact";
import { createCbBackfillJob } from "../../../../../lib/chargeback-backfill-job-store.ts";
import { ChargebackBackfillProgress } from "../../../../../components/ChargebackBackfillProgress.tsx";

interface ListResp { ok?: boolean; fids?: string[]; error?: string }

/** "YYYY-MM-DD" → ms at UTC midnight (To gets the END of the picked day so the
 *  window is inclusive), matching the entry's completedAt basis. Exported for tests. */
export function parseDateToMs(s: string, endOfDay = false): number | null {
  if (!s) return null;
  const ts = Date.parse(s + "T00:00:00Z");
  if (!Number.isFinite(ts)) return null;
  return endOfDay ? ts + 86_400_000 - 1 : ts;
}

function html(el: VNode): Response {
  return new Response(renderToString(el), { headers: { "content-type": "text/html" } });
}

function errBox(msg: string): Response {
  return html(
    <div class="error-text" style="font-size:11px;padding:10px;border:1px solid var(--red);border-radius:6px;">{msg}</div>,
  );
}

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData().catch(() => null);
    const since = form ? parseDateToMs(String(form.get("since") ?? "").trim()) : null;
    const until = form ? parseDateToMs(String(form.get("until") ?? "").trim(), true) : null;
    if (since == null || until == null || until <= since) {
      return errBox("Both From and To dates are required and To must be after From.");
    }

    let r: ListResp;
    try {
      r = await apiPost<ListResp>("/admin/chargeback-backfill-list", ctx.req, { since, until });
    } catch (e) {
      return errBox(`Failed to list entries: ${String((e as Error).message ?? e)}`);
    }
    if (r.error) return errBox(`Backend rejected: ${r.error}`);

    const fids = r.fids ?? [];
    if (fids.length === 0) {
      return html(
        <div style="font-size:12px;color:var(--green);padding:10px;border:1px solid var(--green);border-radius:6px;">
          ✓ Nothing to repair — no chargeback or wire entries completed in that window.
        </div>,
      );
    }

    const { jobId } = createCbBackfillJob(fids);
    console.log(`🚀 [CB-BACKFILL-START] jobId=${jobId} total=${fids.length}`);
    return html(
      <ChargebackBackfillProgress
        jobId={jobId}
        total={fids.length}
        scanned={0}
        cbUpdated={0}
        cbDeleted={0}
        wireUpdated={0}
        wireDeleted={0}
        remaining={fids.length}
        done={false}
        elapsedMs={0}
      />,
    );
  },
});
