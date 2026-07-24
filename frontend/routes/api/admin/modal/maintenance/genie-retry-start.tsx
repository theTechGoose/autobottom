/** "Genie Retry" bulk re-run — kickoff.
 *
 *  Asks the backend to create the run (one indexed query over audit-done-idx,
 *  persisted to Firestore) and renders the first progress fragment from the
 *  snapshot it returns. The first batch is requeued by the first tick, not
 *  here, so the bar shows up immediately. */

import { define } from "../../../../../lib/define.ts";
import { apiPost } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import type { VNode } from "preact";
import type { GenieRetrySnapshot } from "../../../../../lib/genie-retry-job-store.ts";
import { GenieRetryProgress } from "../../../../../components/GenieRetryProgress.tsx";

interface StartResp { ok?: boolean; snapshot?: GenieRetrySnapshot; error?: string }

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

    let r: StartResp;
    try {
      r = await apiPost<StartResp>("/admin/genie-retry-start", ctx.req, { since, until });
    } catch (e) {
      return errBox(`Failed to start the run: ${String((e as Error).message ?? e)}`);
    }
    if (r.error || !r.snapshot) return errBox(`Backend rejected: ${r.error ?? "no snapshot returned"}`);

    if (r.snapshot.total === 0) {
      return html(
        <div style="font-size:12px;color:var(--green);padding:10px;border:1px solid var(--green);border-radius:6px;">
          ✓ No invalid-genie audits in that window — nothing to re-run.
        </div>,
      );
    }

    return html(<GenieRetryProgress snap={r.snapshot} elapsedMs={0} />);
  },
});
