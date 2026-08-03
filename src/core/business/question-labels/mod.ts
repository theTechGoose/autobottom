/** The single source of truth for how an audit question is NAMED to a human.
 *
 *  A question's `header` is its identity: the failed-question index, the
 *  per-question stats buckets, the Question Lab rows and every report filter
 *  key off it (usually via normalizeQuestionKey). Renaming a header in the
 *  config would fork all of that history into a second question, so we never
 *  touch it — we map it to a display label at the edge instead.
 *
 *  Two ways in, one answer:
 *    - `displayHeader` is stamped onto the question when a config serves it
 *      (question-repository.serveConfig → step-prepare), so everything
 *      downstream of an audit carries its own label.
 *    - `shortQuestionLabel` recomputes the same label from a bare header, which
 *      is what the older findings (and anything holding only a string, like the
 *      stats buckets) fall back to.
 *
 *  Anything unmapped passes through unchanged rather than being blanked. */

/** Verbatim question headers → the name humans should see. Every key is a
 *  header audits actually carry (verified against prod's Question Lab configs);
 *  keep it that way — a key with no live question is dead weight. */
export const QUESTION_LABELS: Record<string, string> = {
  "Correct Days & Nights": "Travel Dates",
  "9% Service Fee": "11% Service Fee",
  "# in Room": "Occupancy",
  "Credit Card Number is Not Read on VO?": "CC# Read",
  "US or Canadian Citizen?": "Citizenship",
  "MCC Recurring Charges Disclosed?": "MCC Disclosed",
  "MCC Not Egregious?": "MCC Egregious",
  "Understand Reschedule Process": "WGS Disclosure",
  "Confirmation Expectations": "Conf Email",
  "Attending Presentation Together?": "Presentation Disclosure",
  "Preview 15 Months": "Previous Presentation",
  "No Pets": "Pet Policy",
  "No Group Travel": "Group Travel",
};

/** Display label for a question header (identity for anything unmapped). */
export function shortQuestionLabel(header: string): string {
  const h = String(header ?? "").trim();
  return QUESTION_LABELS[h] ?? h;
}

/** Display label for a question-shaped object: the label stamped on at serve
 *  time when present, else recomputed from the header. Falls back to the
 *  populated prompt so a header-less question still renders as something. */
export function questionLabel(
  q: { displayHeader?: string; header?: string; populated?: string } | null | undefined,
): string {
  const stamped = String(q?.displayHeader ?? "").trim();
  if (stamped) return stamped;
  const fromHeader = shortQuestionLabel(String(q?.header ?? ""));
  return fromHeader || String(q?.populated ?? "").trim();
}
