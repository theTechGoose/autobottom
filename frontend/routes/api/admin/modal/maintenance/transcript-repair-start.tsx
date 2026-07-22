/** Chunked "Transcript Repair" — kickoff for BOTH buttons.
 *
 *  Scan  (mode=scan, the default)   — classify only, zero writes.
 *  Repair(mode=repair)              — rendered by the scan's terminal card, so
 *                                     you can never repair without having looked
 *                                     first. Re-lists the same window and writes
 *                                     only the contaminated rows.
 *
 *  Calls the backend /admin/transcript-repair-list (one indexed query over
 *  audit-done-idx), creates an in-memory job, and returns a
 *  TranscriptRepairProgress fragment that auto-ticks a chunk at a time — so no
 *  single request does the full per-finding loop and times out on Deno Deploy. */

import { define } from "../../../../../lib/define.ts";
import { apiPost } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import type { VNode } from "preact";
import {
  createTranscriptRepairJob,
  type TranscriptRepairMeta,
  type TranscriptRepairMode,
} from "../../../../../lib/transcript-repair-job-store.ts";
import { TranscriptRepairProgress } from "../../../../../components/TranscriptRepairProgress.tsx";

interface Candidate {
  findingId: string;
  completedAt?: number;
  score?: number;
  reviewedBy?: string;
  voName?: string;
}
interface ListResp { ok?: boolean; candidates?: Candidate[]; error?: string }

/** "YYYY-MM-DD" → ms at UTC midnight (To gets the END of the picked day so the
 *  window is inclusive), matching the index's completedAt basis. */
function parseDateToMs(s: string, endOfDay = false): number | null {
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

    // Anything that isn't an explicit "repair" is a dry scan — a dropped field
    // must never turn a look into a write. The backend re-applies this guard.
    const mode: TranscriptRepairMode = raw("mode") === "repair" ? "repair" : "scan";

    // The Repair button round-trips the exact ms window the scan used; the Scan
    // form posts date inputs.
    const sinceMs = Number(raw("sinceMs"));
    const untilMs = Number(raw("untilMs"));
    const since = Number.isFinite(sinceMs) && sinceMs > 0 ? sinceMs : parseDateToMs(raw("since"));
    const until = Number.isFinite(untilMs) && untilMs > 0 ? untilMs : parseDateToMs(raw("until"), true);

    if (since == null || until == null || until <= since) {
      return errBox("Both From and To dates are required and To must be after From.");
    }

    let r: ListResp;
    try {
      r = await apiPost<ListResp>("/admin/transcript-repair-list", ctx.req, { since, until });
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

    const meta = new Map<string, TranscriptRepairMeta>();
    for (const c of candidates) {
      meta.set(c.findingId, { completedAt: c.completedAt, score: c.score, reviewedBy: c.reviewedBy, voName: c.voName });
    }

    const { jobId, job } = createTranscriptRepairJob({
      mode,
      since,
      until,
      fids: candidates.map((c) => c.findingId),
      meta,
    });
    console.log(`🚀 [TRANSCRIPT-REPAIR-START] jobId=${jobId} mode=${mode} total=${job.total}`);
    return html(<TranscriptRepairProgress jobId={jobId} job={job} done={false} elapsedMs={0} />);
  },
});
