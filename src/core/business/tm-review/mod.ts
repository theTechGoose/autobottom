/** TM reviews — the VO dashboard's write-up on a failed audit — and the pure
 *  rules both the VO dashboard and the manager queue share.
 *
 *  A review is written once per audit and never changed (REQ-035): the first
 *  one stands for everybody on that login, and it never alters the audit's
 *  remediation state — it is information for the manager (REQ-038). */

export interface TmReview {
  findingId: string;
  /** The audit's department when it was reviewed — what the manager queue
   *  queries reviews by, so attaching them costs one query per page load. */
  department: string;
  note: string;
  reviewedBy: string;
  reviewedAt: number;
}

/** Firestore type for the write-once review records. */
export const TM_REVIEW_TYPE = "tm-review";

const TZ = "America/New_York";

/** ET wall clock of `ms`: calendar date + ISO weekday (1 = Monday … 7 = Sunday). */
function etParts(ms: number): { y: number; m: number; d: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, year: "numeric", month: "numeric", day: "numeric", weekday: "short",
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday")) + 1;
  return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), weekday };
}

/** Epoch ms of 00:00 ET on the given calendar date (month 1-based; day may
 *  overflow either way — Date.UTC normalises it). */
function etMidnight(y: number, m: number, d: number): number {
  const utcMidnight = Date.UTC(y, m - 1, d);
  // ET is UTC-4 or UTC-5. Read the ET hour at 05:00 UTC that day: 0 under
  // EST, 1 under EDT — i.e. how many hours earlier midnight ET falls.
  const probe = utcMidnight + 5 * 3_600_000;
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(new Date(probe)));
  return probe - hour * 3_600_000;
}

/** The VO dashboard's default date window (REQ-040), Eastern time:
 *  Tuesday–Sunday → this Monday 00:00 through now; Monday → last week,
 *  Monday 00:00 through Sunday 23:59:59.999. */
export function voDefaultWindow(now: number): { since: number; until: number } {
  const { y, m, d, weekday } = etParts(now);
  if (weekday === 1) {
    const today = etMidnight(y, m, d);
    return { since: etMidnight(y, m, d - 7), until: today - 1 };
  }
  return { since: etMidnight(y, m, d - (weekday - 1)), until: now };
}

/** Queue rows with their TM review (if any) attached as `tmReview`. Rows with
 *  no review come back unchanged. */
export function attachTmReviews<T extends { findingId: string }>(
  items: T[],
  reviews: TmReview[],
): Array<T & { tmReview?: TmReview }> {
  const byId = new Map(reviews.map((r) => [r.findingId, r]));
  return items.map((it) => {
    const r = byId.get(it.findingId);
    return r ? { ...it, tmReview: r } : it;
  });
}

/** The VO dashboard's two sides. To Review = not yet reviewed and not out for
 *  appeal; a manager remediating or skipping does NOT take an audit off it.
 *  Reviewed = reviewed by a TM, or taken off the table by an appeal / new
 *  recording (REQ-037). */
export function splitVoQueue<T extends { appealState?: string; tmReview?: TmReview }>(
  items: T[],
): { pending: T[]; reviewed: T[] } {
  const pending: T[] = [];
  const reviewed: T[] = [];
  for (const it of items) (it.tmReview || it.appealState ? reviewed : pending).push(it);
  return { pending, reviewed };
}

/** When a Reviewed-side row was closed out: its review, else its appeal. */
export function voClosedAt(it: { tmReview?: TmReview; appealedAt?: number }): number {
  return it.tmReview?.reviewedAt ?? it.appealedAt ?? 0;
}
