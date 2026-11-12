/** Department question order — the "worst fails" list (REQ-053..056).
 *
 *  Pure: the default list, how a saved list is reconciled with it, the
 *  dark red → orange → yellow → green gradient, and the comparator that ranks
 *  queue rows by their worst failed question. Shared by the backend (which
 *  stores one list per department) and the frontend (which sorts and colors).
 *
 *  Questions are matched by their header text, exactly. */

/** Position 0 is the worst. */
export const DEFAULT_QUESTION_ORDER: readonly string[] = [
  "Income",
  "MCC Recurring Charges Disclosed?",
  "MCC Not Egregious?",
  "Married/Cohab Qualifier Question",
  "Single Qualifier Question",
  "Understand Reschedule Process",
  "Major CC",
  "US or Canadian Citizen?",
  "Age",
  "Attending Presentation Together?",
  "Matching IDs",
  "Active Bankruptcy",
  "9% Service Fee",
  "Taxes",
  "TimeShare Owner",
  "No Group Travel",
  "Preview 15 Months",
  "# in Room",
  "Correct Location",
  "Correct Days & Nights",
  "No Pets",
  "Credit Card Number is Not Read on VO?",
  "Confirmation Expectations",
  "Phone Number",
  "Guest Name",
];

/** The list to use: a saved one in its own order (duplicates and blanks
 *  dropped), with any default question it lacks appended at the bottom — so a
 *  list saved before a question existed still covers it. No saved list → the
 *  default. */
export function effectiveOrder(saved: readonly string[] | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const q of [...(saved ?? []), ...DEFAULT_QUESTION_ORDER]) {
    const name = typeof q === "string" ? q.trim() : "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

// Gradient stops, evenly spaced: dark red → orange → yellow → green.
const STOPS: Array<[number, number, number]> = [
  [139, 0, 0],
  [230, 110, 0],
  [222, 184, 0],
  [34, 139, 34],
];

const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, "0");

/** The color for position `index` of an `n`-long list, as `#rrggbb`. An index
 *  past the end (a question the list doesn't know) gets the bottom color. */
export function severityColor(index: number, n: number): string {
  const last = Math.max(1, n - 1);
  const t = Math.min(1, Math.max(0, index / last));
  const span = t * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(span));
  const f = span - i;
  const [a, b] = [STOPS[i], STOPS[i + 1]];
  return "#" + [0, 1, 2].map((k) => hex2(a[k] + (b[k] - a[k]) * f)).join("");
}

/** Position of each failed question on `order`, worst first. A question the
 *  list doesn't know ranks just below the list. */
function ranks(failed: readonly string[] | undefined, order: readonly string[]): number[] {
  const pos = new Map(order.map((q, i) => [q, i]));
  return (failed ?? []).map((q) => pos.get(q) ?? order.length).sort((a, b) => a - b);
}

/** A row's failed questions, worst first; unknown ones keep their order at the end. */
export function sortFailsBySeverity(failed: readonly string[], order: readonly string[]): string[] {
  const pos = new Map(order.map((q, i) => [q, i]));
  return failed
    .map((q, i) => ({ q, i, r: pos.get(q) ?? order.length }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.q);
}

interface Rankable {
  failedQuestions?: string[];
  completedAt?: number;
  addedAt?: number;
}

/** Comparator: worst failed question first; a tie goes to the next-worst
 *  failed question (more failures beat fewer once the shared ones match);
 *  then the most recent audit. `orderFor` gives a row's department list. */
export function compareBySeverity<T extends Rankable>(
  orderFor: (row: T) => readonly string[] | undefined,
): (a: T, b: T) => number {
  const cache = new WeakMap<T, number[]>();
  const rankOf = (row: T) => {
    let r = cache.get(row);
    if (!r) {
      r = ranks(row.failedQuestions, orderFor(row) ?? DEFAULT_QUESTION_ORDER);
      cache.set(row, r);
    }
    return r;
  };
  const ts = (row: T) => row.completedAt ?? row.addedAt ?? 0;
  return (a, b) => {
    const ra = rankOf(a), rb = rankOf(b);
    for (let i = 0; i < Math.min(ra.length, rb.length); i++) {
      if (ra[i] !== rb[i]) return ra[i] - rb[i];
    }
    if (ra.length !== rb.length) return rb.length - ra.length;
    return ts(b) - ts(a);
  };
}
