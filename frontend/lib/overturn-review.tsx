/** Shared by the Overturn Review page and its HTMX routes (REQ-047..049):
 *  load one held appeal from the backend and render the queue's two columns. */
import { apiFetch } from "./api.ts";
import { OverturnReviewPanel, type OverturnReviewItem, type OverturnReviewWaiting } from "../components/OverturnReviewPanel.tsx";
import { TranscriptPanel } from "../components/TranscriptPanel.tsx";
import type { User } from "./auth.ts";

export interface OverturnReviewData {
  item: OverturnReviewItem | null;
  remaining: number;
  enabled: boolean;
  waiting: OverturnReviewWaiting[];
}

/** Judges make the team's call; admins may too. */
export const canReviewOverturns = (user: User | undefined) => user?.role === "judge" || user?.role === "admin";

export async function loadOverturnReview(req: Request, findingId?: string): Promise<OverturnReviewData> {
  const q = findingId ? `?findingId=${encodeURIComponent(findingId)}` : "";
  try {
    const d = await apiFetch<Partial<OverturnReviewData>>(`/judge/api/overturn-review${q}`, req);
    return { item: d.item ?? null, remaining: d.remaining ?? 0, enabled: d.enabled !== false, waiting: d.waiting ?? [] };
  } catch (e) {
    console.error("Failed to load overturn review:", e);
    return { item: null, remaining: 0, enabled: true, waiting: [] };
  }
}

/** The inside of #ovr-content: the verdict panel left, the transcript right —
 *  the same split as the review and judge queues. After the team's last call
 *  closes an appeal, the confirmation goes out-of-band into the page's
 *  bottom-right toast slot (#ovr-toast), never into the info panel. */
export function OverturnReviewColumns(
  { data, questionIndex, error, finalizedId }: { data: OverturnReviewData; questionIndex?: number; error?: string; finalizedId?: string },
) {
  return (
    <>
      <div class="queue-left">
        <OverturnReviewPanel {...data} questionIndex={questionIndex} error={error} />
      </div>
      <div class="queue-right">
        <TranscriptPanel transcript={data.item?.transcript ?? null} />
      </div>
      {finalizedId && (
        <div id="ovr-toast" hx-swap-oob="true">
          <div class="toast toast-success ovr-toast">Appeal {finalizedId} is final — appeal result email sent.</div>
        </div>
      )}
    </>
  );
}

/** The page's empty toast slot, outside #ovr-content. */
export function OverturnReviewToastSlot() {
  return (
    <>
      <div id="ovr-toast"></div>
      <style>{`.ovr-toast{animation:toastIn .2s ease, ovrToastOut .3s ease 5s forwards}@keyframes ovrToastOut{to{opacity:0;visibility:hidden}}`}</style>
    </>
  );
}

export const htmlResponse = (s: string, status = 200) =>
  new Response(s, { status, headers: { "content-type": "text/html" } });
