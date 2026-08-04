/** Chunked "Error-Answer Cleanup" — kickoff for BOTH buttons.
 *
 *  Scan (mode=scan, the default) — classify only, zero writes.
 *  Flip (mode=flip)              — rendered by the scan's terminal card, so you
 *                                  can never flip without having looked first.
 *                                  Re-lists the same window and forces only the
 *                                  audits still carrying an Error answer to a
 *                                  100% reviewed pass.
 *
 *  Calls the backend /admin/error-flip-list (one indexed query over
 *  audit-done-idx), creates an in-memory job, and returns an ErrorFlipProgress
 *  fragment that auto-ticks a chunk at a time — so no single request does the
 *  full per-finding loop and times out on Deno Deploy. The admin's email is
 *  threaded as `flippedBy` so the forced pass is attributed to a real person,
 *  exactly like a manual flip. */

import { define } from "../../../../../lib/define.ts";
import { apiPost } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import type { VNode } from "preact";
import {
  createErrorFlipJob,
  type ErrorFlipMeta,
  type ErrorFlipMode,
} from "../../../../../lib/error-flip-job-store.ts";
import { ErrorFlipProgress } from "../../../../../components/ErrorFlipProgress.tsx";

interface Candidate {
  findingId: string;
  completedAt?: number;
  score?: number;
  reviewedBy?: string;
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

    // Anything that isn't an explicit "flip" is a dry scan — a dropped field
    // must never turn a look into a write. The backend re-applies this guard.
    const mode: ErrorFlipMode = raw("mode") === "flip" ? "flip" : "scan";

    // The Flip button round-trips the exact ms window the scan used; the Scan
    // form posts date inputs.
    const sinceMs = Number(raw("sinceMs"));
    const untilMs = Number(raw("untilMs"));
    const since = Number.isFinite(sinceMs) && sinceMs > 0 ? sinceMs : parseDateToMs(raw("since"));
    const until = Number.isFinite(untilMs) && untilMs > 0 ? untilMs : parseDateToMs(raw("until"), true);

    if (since == null || until == null || until <= since) {
      return errBox("Both From and To dates are required and To must be after From.");
    }

    const flippedBy = ctx.state.user?.email ?? "admin";

    let r: ListResp;
    try {
      r = await apiPost<ListResp>("/admin/error-flip-list", ctx.req, { since, until });
    } catch (e) {
      return errBox(`Failed to list audits: ${String((e as Error).message ?? e)}`);
    }
    if (r.error) return errBox(`Backend rejected: ${r.error}`);

    const candidates = r.candidates ?? [];
    if (candidates.length === 0) {
      return html(
        <div style="font-size:12px;color:var(--green);padding:10px;border:1px solid var(--green);border-radius:6px;">
          ✓ No completed audits in that window — nothing to scan.
        </div>,
      );
    }

    const meta = new Map<string, ErrorFlipMeta>();
    for (const c of candidates) {
      meta.set(c.findingId, {
        completedAt: c.completedAt,
        score: c.score,
        reviewedBy: c.reviewedBy,
        voName: c.voName,
        department: c.department,
      });
    }

    const { jobId, job } = createErrorFlipJob({
      mode,
      since,
      until,
      flippedBy,
      fids: candidates.map((c) => c.findingId),
      meta,
    });
    console.log(`🚀 [ERROR-FLIP-START] jobId=${jobId} mode=${mode} total=${job.total} by=${flippedBy}`);
    return html(<ErrorFlipProgress jobId={jobId} job={job} done={false} elapsedMs={0} />);
  },
});
