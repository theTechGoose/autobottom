/** Chunked Cleanup re-trigger — phase 1: scan for candidates.
 *
 *  Reads since/until date strings from the form, converts to ms,
 *  asks the backend for fids whose finding.startedAt falls in range
 *  AND whose findingStatus !== "finished" (i.e. drained or in-flight
 *  but not done). Creates a pending RetriggerJob and returns the
 *  confirmation fragment showing the count + Re-trigger button. */

import { define } from "../../../../../lib/define.ts";
import { apiPost } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import type { VNode } from "preact";
import { createRetriggerJob } from "../../../../../lib/retrigger-job-store.ts";
import { RetriggerProgress } from "../../../../../components/RetriggerProgress.tsx";

interface ScanResp { ok?: boolean; scanned?: number; fids?: string[]; error?: string }

function parseDate(input: string, fallback: number): number {
  if (!input) return fallback;
  const t = Date.parse(input);
  return Number.isFinite(t) ? t : fallback;
}

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const sinceStr = form.get("since")?.toString() ?? "";
    const untilStr = form.get("until")?.toString() ?? "";
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const sinceMs = parseDate(sinceStr, todayStart.getTime());
    // For "until", treat the input date as end-of-day so a range like
    // 2026-05-12 → 2026-05-12 means "the whole of 2026-05-12".
    let untilMs: number;
    if (untilStr) {
      const parsed = Date.parse(untilStr);
      if (Number.isFinite(parsed)) {
        const d = new Date(parsed);
        d.setHours(23, 59, 59, 999);
        untilMs = d.getTime();
      } else {
        untilMs = Date.now();
      }
    } else {
      untilMs = Date.now();
    }

    let r: ScanResp;
    try {
      r = await apiPost<ScanResp>("/admin/scan-retrigger-candidates", ctx.req, { sinceMs, untilMs });
    } catch (e) {
      return html(<div class="error-text" style="font-size:11px;">Scan failed: {String(e)}</div>);
    }
    if (r.error) return html(<div class="error-text" style="font-size:11px;">{r.error}</div>);
    const fids = r.fids ?? [];
    if (fids.length === 0) {
      return html(
        <div style="font-size:12px;color:var(--green);padding:10px;border:1px solid var(--green);border-radius:6px;">
          No drained audits found in that window. Nothing to re-trigger.
          <div style="font-size:11px;color:var(--text-dim);margin-top:4px;">Scanned {r.scanned ?? 0} audit-finding docs.</div>
        </div>,
      );
    }
    const { jobId } = createRetriggerJob(fids);
    console.log(`🚀 [RETRIGGER-SCAN] jobId=${jobId} matches=${fids.length} sinceMs=${sinceMs} untilMs=${untilMs}`);
    return html(
      <RetriggerProgress
        jobId={jobId}
        phase="pending"
        total={fids.length}
        requeued={0}
        failed={[]}
        remaining={fids.length}
        elapsedMs={0}
        since={new Date(sinceMs).toISOString().slice(0, 16).replace("T", " ")}
        until={new Date(untilMs).toISOString().slice(0, 16).replace("T", " ")}
      />,
    );
  },
});

function html(el: VNode): Response {
  return new Response(renderToString(el), { headers: { "content-type": "text/html" } });
}
