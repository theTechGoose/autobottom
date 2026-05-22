/** Review stats — analytics for the review queue. */
import { queryAuditDoneIndex } from "@audit/domain/data/stats-repository/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

export function computeReviewRate(decided: number, hours: number): number {
  return hours > 0 ? Math.round(decided / hours) : 0;
}

const MS_DAY = 86_400_000;

export interface ReviewerBucket {
  reviewed: number;
  avgScore: number;
  lastReviewedAt: number | null;
}

export interface ReviewerStats {
  week: ReviewerBucket;
  month: ReviewerBucket;
  allTime: ReviewerBucket;
  currentStreak: number;
  longestStreak: number;
  daysActive: number;
}

export interface LeaderboardRow {
  email: string;
  reviewed: number;
  avgScore: number;
  lastReviewedAt: number | null;
}

interface MinimalRow { completedAt: number; score: number }

function bucketRows(rows: MinimalRow[], from: number, to: number): ReviewerBucket {
  let count = 0;
  let sum = 0;
  let last = 0;
  for (const r of rows) {
    if (r.completedAt >= from && r.completedAt <= to) {
      count++;
      sum += r.score;
      if (r.completedAt > last) last = r.completedAt;
    }
  }
  return {
    reviewed: count,
    avgScore: count ? Math.round(sum / count) : 0,
    lastReviewedAt: last || null,
  };
}

function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

function parseDayKey(key: string): number {
  return Date.UTC(+key.slice(0, 4), +key.slice(4, 6) - 1, +key.slice(6, 8));
}

function computeStreaks(days: Set<string>): { currentStreak: number; longestStreak: number } {
  if (!days.size) return { currentStreak: 0, longestStreak: 0 };
  const todayMs = Math.floor(Date.now() / MS_DAY) * MS_DAY;
  let cursor = days.has(dayKey(todayMs))
    ? todayMs
    : days.has(dayKey(todayMs - MS_DAY))
    ? todayMs - MS_DAY
    : 0;
  let current = 0;
  while (cursor && days.has(dayKey(cursor))) {
    current++;
    cursor -= MS_DAY;
  }
  const asc = [...days].sort();
  let longest = 0;
  let run = 1;
  for (let i = 1; i < asc.length; i++) {
    if (parseDayKey(asc[i]) - parseDayKey(asc[i - 1]) === MS_DAY) {
      run++;
    } else {
      if (run > longest) longest = run;
      run = 1;
    }
  }
  if (run > longest) longest = run;
  return { currentStreak: current, longestStreak: longest };
}

// Snap "to" to end-of-day UTC so the underlying queryAuditDoneIndex cache key
// is stable for the entire current day — repeated dashboard polls share one
// scan. 365-day window covers any realistic streak / leaderboard view; longer
// would just bloat the per-isolate cache without changing what we render.
function rangeForToday(): { from: number; to: number } {
  const todayStart = Math.floor(Date.now() / MS_DAY) * MS_DAY;
  return { from: todayStart - 365 * MS_DAY, to: todayStart + MS_DAY - 1 };
}

export async function getMyReviewerStats(orgId: OrgId, email: string): Promise<ReviewerStats> {
  const { from, to } = rangeForToday();
  const all = await queryAuditDoneIndex(orgId, from, to);
  const mine: MinimalRow[] = [];
  for (const r of all) {
    if (r.reviewedBy === email) mine.push({ completedAt: r.completedAt, score: r.score });
  }
  const now = Date.now();
  const week = bucketRows(mine, now - 7 * MS_DAY, now);
  const month = bucketRows(mine, now - 30 * MS_DAY, now);
  const allTime = bucketRows(mine, from, to);
  const days = new Set(mine.map((r) => dayKey(r.completedAt)));
  const { currentStreak, longestStreak } = computeStreaks(days);
  return { week, month, allTime, currentStreak, longestStreak, daysActive: days.size };
}

export async function getReviewerLeaderboard(orgId: OrgId): Promise<LeaderboardRow[]> {
  const { from, to } = rangeForToday();
  const all = await queryAuditDoneIndex(orgId, from, to);
  const by = new Map<string, { reviewed: number; sum: number; last: number }>();
  for (const r of all) {
    const who = r.reviewedBy;
    if (!who) continue;
    const entry = by.get(who) ?? { reviewed: 0, sum: 0, last: 0 };
    entry.reviewed++;
    entry.sum += r.score;
    if (r.completedAt > entry.last) entry.last = r.completedAt;
    by.set(who, entry);
  }
  const rows: LeaderboardRow[] = [];
  for (const [email, e] of by) {
    rows.push({
      email,
      reviewed: e.reviewed,
      avgScore: e.reviewed ? Math.round(e.sum / e.reviewed) : 0,
      lastReviewedAt: e.last || null,
    });
  }
  rows.sort((a, b) => b.reviewed - a.reviewed);
  return rows;
}
