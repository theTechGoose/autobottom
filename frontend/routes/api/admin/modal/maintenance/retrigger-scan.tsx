/** Chunked Cleanup re-trigger — kickoff.
 *
 *  Takes a pasted fid list (one per line) + a date range, creates a job
 *  in "scanning" phase, and returns a RetriggerProgress fragment that
 *  auto-ticks through /retrigger-scan-tick per 25-fid batch. The
 *  backend's /admin/check-fids-for-retrigger returns whether each fid
 *  matches (status !== "finished" AND startedAt in window). */

import { define } from "../../../../../lib/define.ts";
import { apiPost } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import type { VNode } from "preact";
import { createRetriggerJob } from "../../../../../lib/retrigger-job-store.ts";
import { RetriggerProgress } from "../../../../../components/RetriggerProgress.tsx";

interface ListResp { ok?: boolean; fids?: string[]; error?: string }

function parseSince(input: string): number {
  if (!input) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  const t = Date.parse(input);
  if (!Number.isFinite(t)) return 0;
  // Date inputs (yyyy-mm-dd) parse to UTC midnight. Treat as local midnight.
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function parseUntil(input: string): number {
  if (!input) return Date.now();
  const t = Date.parse(input);
  if (!Number.isFinite(t)) return Date.now();
  const d = new Date(t);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const fidsRaw = form.get("fids")?.toString() ?? "";
    const sinceStr = form.get("since")?.toString() ?? "";
    const untilStr = form.get("until")?.toString() ?? "";

    let fids = fidsRaw
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const sinceMs = parseSince(sinceStr);
    const untilMs = parseUntil(untilStr);

    // Empty paste → ask the backend for the fid list, passing the date
    // range so it can do a server-side Firestore field-filter query on
    // audit-finding.startedAt. That's O(matches) instead of O(all
    // findings) — the difference between "instant" and "20-minute scan".
    // The subsequent scan-tick loop still per-fid double-checks status
    // and startedAt (so chunked findings without the filter-friendly
    // field still get filtered correctly when included via the paste
    // path).
    if (fids.length === 0) {
      let listR: ListResp;
      try {
        listR = await apiPost<ListResp>("/admin/list-all-finding-ids", ctx.req, { sinceMs, untilMs });
      } catch (e) {
        return html(<div class="error-text" style="font-size:11px;">Failed to list audit-finding ids: {String(e)}</div>);
      }
      if (listR.error) return html(<div class="error-text" style="font-size:11px;">{listR.error}</div>);
      fids = listR.fids ?? [];
      if (fids.length === 0) {
        return html(
          <div style="font-size:12px;color:var(--green);padding:10px;border:1px solid var(--green);border-radius:6px;">
            No audit-finding docs found with startedAt between {new Date(sinceMs).toISOString().slice(0, 10)} and {new Date(untilMs).toISOString().slice(0, 10)}. Nothing to scan.
          </div>,
        );
      }
    }

    const { jobId } = createRetriggerJob(fids, sinceMs, untilMs);
    console.log(`🚀 [RETRIGGER-SCAN] jobId=${jobId} pasted=${fids.length} sinceMs=${sinceMs} untilMs=${untilMs}`);

    return html(
      <RetriggerProgress
        jobId={jobId}
        phase="scanning"
        total={fids.length}
        scanned={0}
        matched={0}
        matchedFids={[]}
        rejectedFinished={0}
        rejectedOutOfRange={0}
        rejectedMissing={0}
        requeued={0}
        failed={[]}
        remaining={fids.length}
        elapsedMs={0}
        since={new Date(sinceMs).toISOString().slice(0, 10)}
        until={new Date(untilMs).toISOString().slice(0, 10)}
      />,
    );
  },
});

function html(el: VNode): Response {
  return new Response(renderToString(el), { headers: { "content-type": "text/html" } });
}
