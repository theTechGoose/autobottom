/** Reviewer quality — overturn-rate analytics per reviewer.
 *
 *  A reviewer confirms or flips the autobot's answer; a separate judge later
 *  decides appeals (overturn / uphold). "Overturn rate" measures how often a
 *  reviewer's confirmed fail gets reversed by a judge.
 *
 *  Denominator = the reviewer's reviews that were appealed AND judged. Every
 *  row in `judge-decided` is, by construction, a question that was appealed and
 *  then judged, so the set of judge-decided rows attributed to a reviewer IS
 *  that denominator. Numerator = those rows with decision "overturn".
 *
 *  `judge-decided` carries no reviewer identity, so we join via the finding:
 *  answeredQuestions[questionIndex].reviewedBy (stamped at finalize), with a
 *  finding-level fallback. We scan `judge-decided` by decidedAt (indexed), then
 *  hydrate only the distinct appealed findings (a small fraction of all audits).
 */
import { listStoredByCompletedAt, withTiming } from "@core/data/firestore/mod.ts";
import { getFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { computeOverturnRate } from "@judge/domain/business/judge-analytics/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";
import { shortQuestionLabel } from "@core/business/question-labels/mod.ts";
import type { JudgeDecision } from "@core/dto/types.ts";

const MS_DAY = 86_400_000;
const HYDRATE_CAP = 3000;
const HYDRATE_CONCURRENCY = 25;
const UNKNOWN = "(unknown)";

export interface RangeOpts { from?: number; to?: number }

export interface HeaderOverturn {
  header: string;
  judged: number;
  overturns: number;
  rate: number;
}

export interface ReviewerOverturnRow {
  email: string;
  /** Appealed-and-judged questions attributed to this reviewer. */
  judged: number;
  overturns: number;
  overturnRate: number;
  /** Distinct findings (audits) judged / overturned, for an audit-level rate. */
  auditsJudged: number;
  auditsOverturned: number;
  auditOverturnRate: number;
  /** Per-question-header breakdown, sorted by overturn count. */
  byHeader: HeaderOverturn[];
}

export interface ReviewerQualityResult {
  range: { from: number; to: number };
  rows: ReviewerOverturnRow[];
  cohortDecisions: number;
  hydratedFindings: number;
  capped: boolean;
}

interface DecidedRow {
  findingId: string;
  questionIndex: number;
  header: string;
  decision: "uphold" | "overturn";
  judge: string;
  decidedAt: number;
}

function normalizeDecided(raw: Partial<JudgeDecision>): DecidedRow | null {
  if (!raw?.findingId || !raw.judge || !raw.decidedAt) return null;
  if (raw.decision !== "uphold" && raw.decision !== "overturn") return null;
  return {
    findingId: raw.findingId,
    questionIndex: typeof raw.questionIndex === "number" ? raw.questionIndex : -1,
    header: shortQuestionLabel(String(raw.header ?? "")).trim() || "(untitled)",
    decision: raw.decision,
    judge: raw.judge,
    decidedAt: raw.decidedAt,
  };
}

// ── SWR cache (per isolate) — the join hydration is the expensive part ────────
interface CacheEntry { value: ReviewerQualityResult; expiresAt: number }
const _cache = new Map<string, CacheEntry>();
const _pending = new Map<string, Promise<ReviewerQualityResult>>();

export function _resetReviewerQualityCacheForTests(): void {
  _cache.clear();
  _pending.clear();
}

async function cached(key: string, ttlMs: number, run: () => Promise<ReviewerQualityResult>): Promise<ReviewerQualityResult> {
  const now = Date.now();
  const hit = _cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;
  let pending = _pending.get(key);
  if (!pending) {
    pending = (async () => {
      try {
        const result = await run();
        _cache.set(key, { value: result, expiresAt: Date.now() + ttlMs });
        return result;
      } catch (err) {
        if (hit) {
          console.warn(`⚠️ [REVIEWER-QUALITY] scan failed, serving stale cache key=${key}:`, err);
          return hit.value;
        }
        throw err;
      } finally {
        _pending.delete(key);
      }
    })();
    _pending.set(key, pending);
  }
  if (hit) return hit.value;
  return pending;
}

function compute(orgId: OrgId, from: number, to: number): Promise<ReviewerQualityResult> {
  return withTiming(`reviewerOverturns ${from}-${to}`, () => _computeRaw(orgId, from, to), { category: "db" });
}
async function _computeRaw(orgId: OrgId, from: number, to: number): Promise<ReviewerQualityResult> {
  console.log(`🔍 [REVIEWER-QUALITY] compute org=${orgId} from=${from} to=${to}`);
  const raw = await listStoredByCompletedAt<Partial<JudgeDecision>>(
    "judge-decided", orgId, from, to, { fieldName: "decidedAt" },
  );
  const decided: DecidedRow[] = [];
  for (const r of raw) {
    const n = normalizeDecided(r);
    if (n) decided.push(n);
  }

  // Distinct appealed findings to hydrate (bounded).
  const findingIds = [...new Set(decided.map((d) => d.findingId))];
  const capped = findingIds.length > HYDRATE_CAP;
  const targets = capped ? findingIds.slice(0, HYDRATE_CAP) : findingIds;
  const targetSet = new Set(targets);

  const reviewerByFinding = new Map<string, { byIdx: Map<number, string>; fallback?: string }>();
  for (let i = 0; i < targets.length; i += HYDRATE_CONCURRENCY) {
    const slice = targets.slice(i, i + HYDRATE_CONCURRENCY);
    const findings = await Promise.all(slice.map((id) =>
      getFinding(orgId, id).then((f) => ({ id, f })).catch(() => ({ id, f: null }))
    ));
    for (const { id, f } of findings) {
      const answered = (f as { answeredQuestions?: unknown[] } | null)?.answeredQuestions;
      const byIdx = new Map<number, string>();
      let fallback: string | undefined;
      if (Array.isArray(answered)) {
        answered.forEach((q, idx) => {
          const rv = (q as { reviewedBy?: string })?.reviewedBy;
          if (rv) {
            byIdx.set(idx, rv);
            if (!fallback) fallback = rv;
          }
        });
      }
      reviewerByFinding.set(id, { byIdx, fallback });
    }
  }

  interface Acc {
    judged: number;
    overturns: number;
    byHeader: Map<string, { judged: number; overturns: number }>;
    auditsJudged: Set<string>;
    auditsOverturned: Set<string>;
  }
  const by = new Map<string, Acc>();
  for (const d of decided) {
    if (!targetSet.has(d.findingId)) continue; // dropped by the hydration cap
    const map = reviewerByFinding.get(d.findingId);
    const reviewer = map?.byIdx.get(d.questionIndex) ?? map?.fallback ?? UNKNOWN;
    const acc = by.get(reviewer) ?? {
      judged: 0, overturns: 0, byHeader: new Map(), auditsJudged: new Set<string>(), auditsOverturned: new Set<string>(),
    };
    acc.judged++;
    acc.auditsJudged.add(d.findingId);
    const h = acc.byHeader.get(d.header) ?? { judged: 0, overturns: 0 };
    h.judged++;
    if (d.decision === "overturn") {
      acc.overturns++;
      h.overturns++;
      acc.auditsOverturned.add(d.findingId);
    }
    acc.byHeader.set(d.header, h);
    by.set(reviewer, acc);
  }

  const rows: ReviewerOverturnRow[] = [];
  for (const [email, acc] of by) {
    const byHeader: HeaderOverturn[] = [...acc.byHeader.entries()]
      .map(([header, v]) => ({ header, judged: v.judged, overturns: v.overturns, rate: computeOverturnRate(v.overturns, v.judged) }))
      .sort((a, b) => b.overturns - a.overturns || b.judged - a.judged);
    rows.push({
      email,
      judged: acc.judged,
      overturns: acc.overturns,
      overturnRate: computeOverturnRate(acc.overturns, acc.judged),
      auditsJudged: acc.auditsJudged.size,
      auditsOverturned: acc.auditsOverturned.size,
      auditOverturnRate: computeOverturnRate(acc.auditsOverturned.size, acc.auditsJudged.size),
      byHeader,
    });
  }
  rows.sort((a, b) => b.overturns - a.overturns || b.judged - a.judged);
  console.log(`✅ [REVIEWER-QUALITY] ${rows.length} reviewers from ${decided.length} decisions (hydrated ${targets.length}${capped ? ", capped" : ""})`);
  return { range: { from, to }, rows, cohortDecisions: decided.length, hydratedFindings: targets.length, capped };
}

/** Time-ranged overturn quality. 60s SWR cache. */
export async function getReviewerOverturns(orgId: OrgId, opts?: RangeOpts): Promise<ReviewerQualityResult> {
  const from = opts?.from ?? 0;
  const to = opts?.to ?? Date.now();
  return cached(`${orgId}:${from}:${to}`, 60_000, () => compute(orgId, from, to));
}

/** Lifetime overturn quality (all time). `to` is snapped to end-of-day UTC so
 *  the cache key is stable across the day; 5min SWR cache. */
export async function getReviewerOverturnsLifetime(orgId: OrgId): Promise<ReviewerQualityResult> {
  const to = Math.floor(Date.now() / MS_DAY) * MS_DAY + MS_DAY - 1;
  return cached(`${orgId}:lifetime:${to}`, 300_000, () => compute(orgId, 0, to));
}

/** One reviewer's overturn breakdown (range + lifetime) for the drill-down. */
export async function getReviewerOverturnDetail(
  orgId: OrgId, email: string, opts?: RangeOpts,
): Promise<{ range: ReviewerOverturnRow | null; lifetime: ReviewerOverturnRow | null }> {
  const [ranged, lifetime] = await Promise.all([
    getReviewerOverturns(orgId, opts),
    getReviewerOverturnsLifetime(orgId),
  ]);
  return {
    range: ranged.rows.find((r) => r.email === email) ?? null,
    lifetime: lifetime.rows.find((r) => r.email === email) ?? null,
  };
}
