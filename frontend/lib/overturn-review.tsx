/** Shared by the Overturn Review page and its HTMX routes (REQ-047..051):
 *  load one held appeal from the backend and render the panel + transcript. */
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

/** Judges make the team's call; admins may too (and own the off switch). */
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

/** The two queue columns. The HTMX routes swap the left one (#ovr-panel) and
 *  send the right one out-of-band so the transcript follows the appeal shown. */
export function OverturnReviewColumns(
  { data, user, error, finalizedId, oob }: { data: OverturnReviewData; user: User; error?: string; finalizedId?: string; oob?: boolean },
) {
  return (
    <>
      <OverturnReviewPanel {...data} isAdmin={user.role === "admin"} error={error} finalizedId={finalizedId} />
      <div id="ovr-transcript" class="queue-right" {...(oob ? { "hx-swap-oob": "true" } : {})}>
        <TranscriptPanel transcript={data.item?.transcript ?? null} />
      </div>
    </>
  );
}
