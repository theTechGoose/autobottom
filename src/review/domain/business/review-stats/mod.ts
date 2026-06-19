/** Review stats — analytics for the review queue. */
import { queryAuditDoneIndex } from "@audit/domain/data/stats-repository/mod.ts";
import { getFinding } from "@audit/domain/data/audit-repository/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

export function computeReviewRate(decided: number, hours: number): number {
  return hours > 0 ? Math.round(decided / hours) : 0;
}

const MS_DAY = 86_400_000;
const MS_HOUR = 3_600_000;
/** A gap longer than this between a reviewer's consecutive audit completions is a
 *  break, not active work — excluded from cadence-based handle time. */
const BREAK_MS = 15 * 60_000;

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
  /** Cadence-based per-audit handle time — gap between consecutive audit
   *  completions, breaks (>15 min) excluded. Works on ALL history. */
  handledAudits: number;      // audits with an in-session gap
  avgHandleMs: number;        // mean in-session gap
  medianHandleMs: number;
  activeMs: number;           // Σ in-session gaps
  auditsPerActiveHour: number;
  /** Per-question handle (forward-only — decision-to-decision gaps stored on the
   *  finding). Blank for audits reviewed before timing shipped. */
  validQuestions: number;
  avgPerQuestionMs: number;
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
  interface Acc {
    completedAts: number[]; sum: number; last: number;
    perQuestionMs: number; validQuestions: number;
  }
  const by = new Map<string, Acc>();
  for (const r of all) {
    const who = r.reviewedBy;
    if (!who) continue;
    if (r.completedAt < from || r.completedAt > to) continue;
    const e = by.get(who) ?? { completedAts: [], sum: 0, last: 0, perQuestionMs: 0, validQuestions: 0 };
    e.completedAts.push(r.completedAt);
    e.sum += r.score;
    if (r.completedAt > e.last) e.last = r.completedAt;
    // Forward-only per-question handle (decision gaps stored at finalize).
    if (typeof r.reviewHandleMs === "number" && (r.reviewedValidCount ?? 0) > 0) {
      e.perQuestionMs += r.reviewHandleMs;
      e.validQuestions += r.reviewedValidCount ?? 0;
    }
    by.set(who, e);
  }
  const rows: LeaderboardRow[] = [];
  for (const [email, e] of by) {
    const reviewed = e.completedAts.length;
    // Cadence: in-session gaps between consecutive completions (≤ BREAK_MS).
    const ts = [...e.completedAts].sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let i = 1; i < ts.length; i++) {
      const g = ts[i] - ts[i - 1];
      if (g > 0 && g <= BREAK_MS) gaps.push(g);
    }
    const activeMs = gaps.reduce((s, x) => s + x, 0);
    const handledAudits = gaps.length;
    rows.push({
      email,
      reviewed,
      avgScore: reviewed ? Math.round(e.sum / reviewed) : 0,
      lastReviewedAt: e.last || null,
      handledAudits,
      avgHandleMs: handledAudits ? Math.round(activeMs / handledAudits) : 0,
      medianHandleMs: median(gaps),
      activeMs,
      auditsPerActiveHour: activeMs > 0 ? Math.round((handledAudits / (activeMs / MS_HOUR)) * 10) / 10 : 0,
      validQuestions: e.validQuestions,
      avgPerQuestionMs: e.validQuestions ? Math.round(e.perQuestionMs / e.validQuestions) : 0,
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

export interface ReviewerTrueAvg { ms: number; samples: number }

export async function getQuestionTiming(
  orgId: OrgId,
  opts?: RangeOpts,
  questionFilter?: string,
): Promise<{
  rows: QuestionTimingRow[];
  cohort: number;
  hydrated: number;
  capped: boolean;
  /** Σ of every non-discarded per-question sample (ms), across ALL questions
   *  (ignores questionFilter) — powers the top-row "true avg / question". */
  totalSamples: number;
  trueAvgPerQuestionMs: number;
  /** Per-reviewer Σ sample ms + count, keyed by the finding's reviewedBy — lets
   *  the leaderboard's "avg / question" column use the true per-question mean. */
  byReviewerTrueAvg: Map<string, ReviewerTrueAvg>;
}> {
  const { from, to } = resolveRange(opts);
  const all = await queryAuditDoneIndex(orgId, from, to);
  const reviewed = all.filter((r) =>
    r.reason === "reviewed" && r.completedAt >= from && r.completedAt <= to
  );
  const capped = reviewed.length > HYDRATE_CAP;
  const targets = capped ? reviewed.slice(0, HYDRATE_CAP) : reviewed;

  interface QAcc { samples: number[]; discardedCount: number }
  const byHeader = new Map<string, QAcc>();
  const byReviewerTrueAvg = new Map<string, ReviewerTrueAvg>();
  let grandTotalMs = 0;
  let grandSamples = 0;
  for (let i = 0; i < targets.length; i += HYDRATE_CONCURRENCY) {
    const slice = targets.slice(i, i + HYDRATE_CONCURRENCY);
    const findings = await Promise.all(slice.map((r) =>
      getFinding(orgId, r.findingId).then((f) => ({ f, reviewer: r.reviewedBy })).catch(() => ({ f: null, reviewer: r.reviewedBy }))
    ));
    for (const { f, reviewer } of findings) {
      const answered = (f as { answeredQuestions?: unknown[] } | null)?.answeredQuestions;
      if (!Array.isArray(answered)) continue;
      for (const q of answered) {
        const qq = q as { header?: string; reviewHandleMs?: number; reviewDiscarded?: boolean; reviewedAt?: number };
        // Only count questions that actually went through review (have timing).
        if (qq.reviewHandleMs == null && qq.reviewedAt == null) continue;
        const header = String(qq.header ?? "").trim() || "(untitled)";
        const acc = byHeader.get(header) ?? { samples: [], discardedCount: 0 };
        if (qq.reviewDiscarded) acc.discardedCount++;
        else if (typeof qq.reviewHandleMs === "number") {
          acc.samples.push(qq.reviewHandleMs);
          grandTotalMs += qq.reviewHandleMs;
          grandSamples++;
          if (reviewer) {
            const rAcc = byReviewerTrueAvg.get(reviewer) ?? { ms: 0, samples: 0 };
            rAcc.ms += qq.reviewHandleMs;
            rAcc.samples++;
            byReviewerTrueAvg.set(reviewer, rAcc);
          }
        }
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
  return {
    rows,
    cohort: reviewed.length,
    hydrated: targets.length,
    capped,
    totalSamples: grandSamples,
    trueAvgPerQuestionMs: grandSamples ? Math.round(grandTotalMs / grandSamples) : 0,
    byReviewerTrueAvg,
  };
}

// ── Per-reviewer flip-to-yes rate ────────────────────────────────────────────
// A reviewer only ever sees the bot's failed ("No") answers
// (populateReviewQueue filters answer === "No"); confirming keeps the "No",
// flipping turns it into "Yes". So a reviewer's "flip → yes" rate is just
// flips / (flips + confirms) over the failed questions they adjudicated. The
// decision is stamped per-question on the finding at finalize as `reviewAction`
// ("flip" | "confirm" | "admin-flip") + `reviewedBy`. `admin-flip` is an admin
// override from /audit/report (and is attributed to the admin, not the
// reviewer), so it's excluded — only "flip"/"confirm" count.
//
// Same bounded, windowed hydration as getQuestionTiming (HYDRATE_CAP wide,
// HYDRATE_CONCURRENCY at a time) over the SWR-cached audit-done index — NOT an
// unbounded crawl. Wrapped in its own 60s SWR cache so concurrent
// judge-dashboard loads of the same window share a single hydration pass.

export interface ReviewerFlipRow {
  email: string;
  flips: number;
  confirms: number;
  /** flips + confirms — the reviewer's adjudicated failed questions. */
  decisions: number;
  /** flips / decisions * 100, 0 when no decisions. */
  flipRate: number;
}

export interface ReviewerFlipResult {
  rows: ReviewerFlipRow[];
  /** Reviewed audits in the window (pre-cap). */
  cohort: number;
  /** Findings actually hydrated (== cohort unless capped). */
  hydrated: number;
  capped: boolean;
}

export function computeFlipRate(flips: number, decisions: number): number {
  return decisions > 0 ? Math.round((flips / decisions) * 100) : 0;
}

interface FlipCacheEntry { value: ReviewerFlipResult; expiresAt: number }
const _flipCache = new Map<string, FlipCacheEntry>();
const _flipPending = new Map<string, Promise<ReviewerFlipResult>>();

export function _resetReviewerFlipRatesCacheForTests(): void {
  _flipCache.clear();
  _flipPending.clear();
}

async function _computeFlipRates(orgId: OrgId, from: number, to: number): Promise<ReviewerFlipResult> {
  const all = await queryAuditDoneIndex(orgId, from, to);
  const reviewed = all.filter((r) =>
    r.reason === "reviewed" && r.completedAt >= from && r.completedAt <= to
  );
  const capped = reviewed.length > HYDRATE_CAP;
  const targets = capped ? reviewed.slice(0, HYDRATE_CAP) : reviewed;

  interface Acc { flips: number; confirms: number }
  const by = new Map<string, Acc>();
  for (let i = 0; i < targets.length; i += HYDRATE_CONCURRENCY) {
    const slice = targets.slice(i, i + HYDRATE_CONCURRENCY);
    const findings = await Promise.all(slice.map((r) =>
      getFinding(orgId, r.findingId)
        .then((f) => ({ f, fallback: r.reviewedBy }))
        .catch(() => ({ f: null, fallback: r.reviewedBy }))
    ));
    for (const { f, fallback } of findings) {
      const answered = (f as { answeredQuestions?: unknown[] } | null)?.answeredQuestions;
      if (!Array.isArray(answered)) continue;
      for (const q of answered) {
        const qq = q as { reviewAction?: string; reviewedBy?: string };
        // Only reviewer-queue decisions — admin-flip / judge actions excluded.
        if (qq.reviewAction !== "flip" && qq.reviewAction !== "confirm") continue;
        // Attribute per-question (finalize stamps reviewedBy on each answered
        // question); fall back to the index row's reviewer for legacy rows.
        const who = qq.reviewedBy || fallback;
        if (!who) continue;
        const acc = by.get(who) ?? { flips: 0, confirms: 0 };
        if (qq.reviewAction === "flip") acc.flips++;
        else acc.confirms++;
        by.set(who, acc);
      }
    }
  }

  const rows: ReviewerFlipRow[] = [];
  for (const [email, acc] of by) {
    const decisions = acc.flips + acc.confirms;
    rows.push({ email, flips: acc.flips, confirms: acc.confirms, decisions, flipRate: computeFlipRate(acc.flips, decisions) });
  }
  rows.sort((a, b) => b.flips - a.flips || b.decisions - a.decisions);
  return { rows, cohort: reviewed.length, hydrated: targets.length, capped };
}

/** Per-reviewer flip-to-yes rate over a range. 60s SWR cache; serves stale on
 *  scan failure when a prior value exists. */
export async function getReviewerFlipRates(orgId: OrgId, opts?: RangeOpts): Promise<ReviewerFlipResult> {
  const { from, to } = resolveRange(opts);
  const key = `${orgId}:${from}:${to}`;
  const now = Date.now();
  const hit = _flipCache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;
  let pending = _flipPending.get(key);
  if (!pending) {
    pending = (async () => {
      try {
        const result = await _computeFlipRates(orgId, from, to);
        _flipCache.set(key, { value: result, expiresAt: Date.now() + 60_000 });
        return result;
      } catch (err) {
        if (hit) {
          console.warn(`⚠️ [REVIEWER-FLIPS] scan failed, serving stale cache key=${key}:`, err);
          return hit.value;
        }
        throw err;
      } finally {
        _flipPending.delete(key);
      }
    })();
    _flipPending.set(key, pending);
  }
  if (hit) return hit.value;
  return pending;
}
