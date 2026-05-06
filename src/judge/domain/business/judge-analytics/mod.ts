/** Judge analytics — appeal outcome tracking. */
export function computeOverturnRate(overturned: number, total: number): number {
  return total > 0 ? Math.round((overturned / total) * 100) : 0;
}
