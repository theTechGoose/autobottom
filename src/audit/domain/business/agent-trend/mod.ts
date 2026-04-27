/** Agent dashboard weekly-trend bucketing — pure function so it can be tested
 *  without standing up a KV. Last-7-days windowed by local-day boundary, oldest
 *  bucket first. Empty days carry score=0/count=0; a day with audits returns
 *  the rounded average. */

export interface ScorePoint { completedAt: number; score: number; }
export interface TrendDay { date: string; avgScore: number; count: number; }

const DAY_MS = 24 * 60 * 60 * 1000;

function fmtDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Returns 7 buckets, oldest → newest, ending on the local-day containing `now`. */
export function bucketWeeklyTrend(points: ScorePoint[], now: number): TrendDay[] {
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const trendStart = today.getTime() - 6 * DAY_MS;
  const buckets: { sum: number; count: number }[] =
    Array.from({ length: 7 }, () => ({ sum: 0, count: 0 }));

  for (const p of points) {
    if (p.completedAt < trendStart || p.completedAt >= today.getTime() + DAY_MS) continue;
    const bucketIdx = Math.floor((p.completedAt - trendStart) / DAY_MS);
    if (bucketIdx < 0 || bucketIdx >= 7) continue;
    buckets[bucketIdx].sum += p.score;
    buckets[bucketIdx].count += 1;
  }

  return buckets.map((b, i) => ({
    date: fmtDate(trendStart + i * DAY_MS),
    avgScore: b.count > 0 ? Math.round(b.sum / b.count) : 0,
    count: b.count,
  }));
}
