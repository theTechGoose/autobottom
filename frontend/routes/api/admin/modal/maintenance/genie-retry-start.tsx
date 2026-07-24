/** "Genie Retry" bulk re-run — kickoff.
 *
 *  Asks the backend for every audit in the window that finalized as
 *  "Invalid Genie" (one indexed query over audit-done-idx), creates the job,
 *  and returns a GenieRetryProgress fragment. The first batch is requeued by
 *  the first tick, not here, so this request stays short and the operator sees
 *  the bar immediately. */

import { define } from "../../../../../lib/define.ts";
import { apiPost } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import type { VNode } from "preact";
import { createGenieRetryJob, type GenieRetryMeta } from "../../../../../lib/genie-retry-job-store.ts";
import { GenieRetryProgress } from "../../../../../components/GenieRetryProgress.tsx";

interface Candidate {
  findingId: string;
  completedAt?: number;
  recordId?: string;
  recordingId?: string;
  voName?: string;
  department?: string;
}
interface ListResp { ok?: boolean; candidates?: Candidate[]; error?: string }

/** "YYYY-MM-DD" → ms at UTC midnight (To gets the END of the picked day so the
 *  window is inclusive), matching the index's completedAt basis. */
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
    const raw = (k: string) => String(form?.get(k) ?? "").trim();

    const since = parseDateToMs(raw("since"));
    const until = parseDateToMs(raw("until"), true);
    if (since == null || until == null || until <= since) {
      return errBox("Both From and To dates are required and To must be after From.");
    }

    let r: ListResp;
    try {
      r = await apiPost<ListResp>("/admin/genie-retry-list", ctx.req, { since, until });
    } catch (e) {
      return errBox(`Failed to list invalid-genie audits: ${String((e as Error).message ?? e)}`);
    }
    if (r.error) return errBox(`Backend rejected: ${r.error}`);

    const candidates = r.candidates ?? [];
    if (candidates.length === 0) {
      return html(
        <div style="font-size:12px;color:var(--green);padding:10px;border:1px solid var(--green);border-radius:6px;">
          ✓ No invalid-genie audits in that window — nothing to re-run.
        </div>,
      );
    }

    const meta = new Map<string, GenieRetryMeta>();
    for (const c of candidates) {
      meta.set(c.findingId, {
        completedAt: c.completedAt,
        recordId: c.recordId,
        recordingId: c.recordingId,
        voName: c.voName,
        department: c.department,
      });
    }

    const { jobId, job } = createGenieRetryJob({
      since,
      until,
      fids: candidates.map((c) => c.findingId),
      meta,
    });
    console.log(`🚀 [GENIE-RETRY-START] jobId=${jobId} total=${job.total} since=${since} until=${until}`);
    return html(<GenieRetryProgress jobId={jobId} job={job} done={false} elapsedMs={0} />);
  },
});
