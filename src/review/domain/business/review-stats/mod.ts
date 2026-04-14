/** Review stats — analytics for the review queue. */
export function computeReviewRate(decided: number, hours: number): number {
  return hours > 0 ? Math.round(decided / hours) : 0;
}
