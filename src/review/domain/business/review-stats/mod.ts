/** Review stats — analytics for the review queue. */
import { queryAuditDoneIndex } from "@audit/domain/data/stats-repository/mod.ts";
import { getFinding } from "@audit/domain/data/audit-repository/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

export function computeReviewRate(decided: number, hours: number): number {
  return hours > 0 ? Math.round(decided / hours) : 0;
}

const MS_DAY = 86_400_000;
const MS_HOUR = 3_600_000;

/** Median of a numeric array (0 for empty). */
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export interface ReviewerBucket {
  reviewed: number;
  avgScore: number;
  lastReviewedAt: number | null;
}

export interface ReviewerStats {
  range: { from: number; to: number };
  /** Stats for the chosen range. */
  reviewed: number;
  avgScore: number;
  daysActive: number;
  /** Most recent reviewedAt that falls inside the range. */
  lastInRangeAt: number | null;
  /** Streaks + lastReviewedAt are always today-relative regardless of
   *  selected range — they're "are you working right now" indicators
   *  that lose meaning when scoped to an arbitrary range. */
  currentStreak: number;
  longestStreak: number;
  lastReviewedAt: number | null;
}

export interface LeaderboardRow {
  email: string;
  reviewed: number;
  avgScore: number;
  lastReviewedAt: number | null;
  /** Handle-time stats (forward-only — based on audits that carry reviewHandleMs).
   *  timedAudits is how many of `reviewed` have timing; the rest predate capture. */
  timedAudits: number;
  totalHandleMs: number;
  avgHandleMs: number;
  medianHandleMs: number;
  validQuestions: number;
  avgPerQuestionMs: number;
  auditsPerActiveHour: number;
}

export interface QuestionTimingRow {
  header: string;
  samples: number;
  avgMs: number;
  medianMs: number;
  discardedCount: number;
}

export interface RangeOpts { from?: number; to?: number }

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

/** Resolve {from?, to?} into a fully-bounded range. Missing both → 365d
 *  trailing window (backwards-compat with the previous fixed behavior).
 *  Missing one → fill the other with a sensible default. */
function resolveRange(opts?: RangeOpts): { from: number; to: number } {
  if (opts?.from != null && opts?.to != null) return { from: opts.from, to: opts.to };
  const fallback = rangeForToday();
  return {
    from: opts?.from ?? fallback.from,
    to: opts?.to ?? fallback.to,
  };
}

export async function getMyReviewerStats(orgId: OrgId, email: string, opts?: RangeOpts): Promise<ReviewerStats> {
  const range = resolveRange(opts);
  // For streaks we need the trailing-today window even when the operator
  // picked a custom range — current streak loses meaning if computed
  // against an arbitrary slice. Pull both scans; the second is cache-warm
  // on dashboards that default to today's window.
  const today = rangeForToday();
  const scanFrom = Math.min(range.from, today.from);
  const scanTo = Math.max(range.to, today.to);
  const all = await queryAuditDoneIndex(orgId, scanFrom, scanTo);
  const mine: MinimalRow[] = [];
  const minePost: MinimalRow[] = []; // rows used for streak/lastReviewedAt (today-window)
  for (const r of all) {
    if (r.reviewedBy !== email) continue;
    const row = { completedAt: r.completedAt, score: r.score };
    if (r.completedAt >= range.from && r.completedAt <= range.to) mine.push(row);
    if (r.completedAt >= today.from && r.completedAt <= today.to) minePost.push(row);
  }
  const bucket = bucketRows(mine, range.from, range.to);
  const daysInRange = new Set(mine.map((r) => dayKey(r.completedAt)));
  const daysTrailing = new Set(minePost.map((r) => dayKey(r.completedAt)));
  const { currentStreak, longestStreak } = computeStreaks(daysTrailing);
  const lastReviewedAt = minePost.reduce<number | null>(
    (acc, r) => (r.completedAt > (acc ?? 0) ? r.completedAt : acc),
    null,
  );
  return {
    range,
    reviewed: bucket.reviewed,
    avgScore: bucket.avgScore,
    daysActive: daysInRange.size,
    lastInRangeAt: bucket.lastReviewedAt,
    currentStreak,
    longestStreak,
    lastReviewedAt,
  };
}

export async function getReviewerLeaderboard(orgId: OrgId, opts?: RangeOpts): Promise<LeaderboardRow[]> {
  const { from, to } = resolveRange(opts);
  const all = await queryAuditDoneIndex(orgId, from, to);
  interface Acc { reviewed: number; sum: number; last: number; handleSamples: number[]; validQuestions: number }
  const by = new Map<string, Acc>();
  for (const r of all) {
    const who = r.reviewedBy;
    if (!who) continue;
    if (r.completedAt < from || r.completedAt > to) continue;
    const entry = by.get(who) ?? { reviewed: 0, sum: 0, last: 0, handleSamples: [], validQuestions: 0 };
    entry.reviewed++;
    entry.sum += r.score;
    if (r.completedAt > entry.last) entry.last = r.completedAt;
    // Handle time is only present on audits reviewed after timing capture shipped.
    if (typeof r.reviewHandleMs === "number" && (r.reviewedValidCount ?? 0) > 0) {
      entry.handleSamples.push(r.reviewHandleMs);
      entry.validQuestions += r.reviewedValidCount ?? 0;
    }
    by.set(who, entry);
  }
  const rows: LeaderboardRow[] = [];
  for (const [email, e] of by) {
    const totalHandleMs = e.handleSamples.reduce((s, x) => s + x, 0);
    const timedAudits = e.handleSamples.length;
    const avgHandleMs = timedAudits ? Math.round(totalHandleMs / timedAudits) : 0;
    rows.push({
      email,
      reviewed: e.reviewed,
      avgScore: e.reviewed ? Math.round(e.sum / e.reviewed) : 0,
      lastReviewedAt: e.last || null,
      timedAudits,
      totalHandleMs,
      avgHandleMs,
      medianHandleMs: median(e.handleSamples),
      validQuestions: e.validQuestions,
      avgPerQuestionMs: e.validQuestions ? Math.round(totalHandleMs / e.validQuestions) : 0,
      auditsPerActiveHour: totalHandleMs > 0 ? Math.round((timedAudits / (totalHandleMs / MS_HOUR)) * 10) / 10 : 0,
    });
  }
  rows.sort((a, b) => b.reviewed - a.reviewed);
  return rows;
}

export interface ReviewerAuditRow {
  findingId: string;
  completedAt: number;
  score: number;
  isPackage?: boolean;
  recordId?: string;
  recordingId?: string;
  voName?: string;
  reviewHandleMs?: number;
  reviewedQuestionCount?: number;
  reviewedValidCount?: number;
}

/** One reviewer's audits in range (newest first), paginated — drill-down from
 *  the throughput report's by-reviewer table. Reads the index directly (cheap). */
export async function getReviewerAudits(
  orgId: OrgId,
  email: string,
  opts: RangeOpts | undefined,
  page = 1,
  limit = 100,
): Promise<{ rows: ReviewerAuditRow[]; total: number; page: number; pages: number }> {
  const { from, to } = resolveRange(opts);
  const all = await queryAuditDoneIndex(orgId, from, to);
  const mine = all
    .filter((r) => r.reviewedBy === email && r.completedAt >= from && r.completedAt <= to)
    .sort((a, b) => b.completedAt - a.completedAt);
  const lim = Math.min(500, Math.max(10, limit));
  const pages = Math.max(1, Math.ceil(mine.length / lim));
  const pg = Math.min(Math.max(1, page), pages);
  const rows: ReviewerAuditRow[] = mine.slice((pg - 1) * lim, pg * lim).map((r) => ({
    findingId: r.findingId,
    completedAt: r.completedAt,
    score: r.score,
    isPackage: r.isPackage,
    recordId: r.recordId,
    recordingId: r.recordingId,
    voName: r.voName,
    reviewHandleMs: r.reviewHandleMs,
    reviewedQuestionCount: r.reviewedQuestionCount,
    reviewedValidCount: r.reviewedValidCount,
  }));
  return { rows, total: mine.length, page: pg, pages };
}

/** Per-question review handle time over a range. Hydrates the reviewed audits'
 *  finding docs (bounded by HYDRATE_CAP) and groups answeredQuestions[].reviewHandleMs
 *  by header, excluding idle-discarded questions. `questionFilter` is a
 *  case-insensitive substring match on the header. */
const HYDRATE_CAP = 2000;
const HYDRATE_CONCURRENCY = 25;

export async function getQuestionTiming(
  orgId: OrgId,
  opts?: RangeOpts,
  questionFilter?: string,
): Promise<{ rows: QuestionTimingRow[]; cohort: number; hydrated: number; capped: boolean }> {
  const { from, to } = resolveRange(opts);
  const all = await queryAuditDoneIndex(orgId, from, to);
  const reviewed = all.filter((r) =>
    r.reason === "reviewed" && r.completedAt >= from && r.completedAt <= to
  );
  const capped = reviewed.length > HYDRATE_CAP;
  const targets = capped ? reviewed.slice(0, HYDRATE_CAP) : reviewed;

  interface QAcc { samples: number[]; discardedCount: number }
  const byHeader = new Map<string, QAcc>();
  for (let i = 0; i < targets.length; i += HYDRATE_CONCURRENCY) {
    const slice = targets.slice(i, i + HYDRATE_CONCURRENCY);
    const findings = await Promise.all(slice.map((r) => getFinding(orgId, r.findingId).catch(() => null)));
    for (const f of findings) {
      const answered = (f as { answeredQuestions?: unknown[] } | null)?.answeredQuestions;
      if (!Array.isArray(answered)) continue;
      for (const q of answered) {
        const qq = q as { header?: string; reviewHandleMs?: number; reviewDiscarded?: boolean; reviewedAt?: number };
        // Only count questions that actually went through review (have timing).
        if (qq.reviewHandleMs == null && qq.reviewedAt == null) continue;
        const header = String(qq.header ?? "").trim() || "(untitled)";
        const acc = byHeader.get(header) ?? { samples: [], discardedCount: 0 };
        if (qq.reviewDiscarded) acc.discardedCount++;
        else if (typeof qq.reviewHandleMs === "number") acc.samples.push(qq.reviewHandleMs);
        byHeader.set(header, acc);
      }
    }
  }

  const filter = (questionFilter ?? "").trim().toLowerCase();
  const rows: QuestionTimingRow[] = [];
  for (const [header, acc] of byHeader) {
    if (filter && !header.toLowerCase().includes(filter)) continue;
    const total = acc.samples.reduce((s, x) => s + x, 0);
    rows.push({
      header,
      samples: acc.samples.length,
      avgMs: acc.samples.length ? Math.round(total / acc.samples.length) : 0,
      medianMs: median(acc.samples),
      discardedCount: acc.discardedCount,
    });
  }
  rows.sort((a, b) => b.avgMs - a.avgMs);
  return { rows, cohort: reviewed.length, hydrated: targets.length, capped };
}
