/** Judge analytics — appeal outcome tracking.
 *
 *  Phase 2 (indexed-range queries): `judge-decided` lookups use the composite
 *  index `(_org, _type, decidedAt, __name__)` via `listStoredByCompletedAt`,
 *  so range-scoped dashboard queries now read only docs in the requested
 *  window instead of the whole collection. Two query shapes:
 *
 *  - Range query: docs in [from, to). No cache needed at the module level —
 *    the indexed scan returns in <500ms even on the full org and the
 *    dashboard's HTTP layer already debounces calls via HTMX polling.
 *  - Lookback query: most recent N globally, DESC by decidedAt. Cached 60s
 *    SWR per orgId. Used only to compute `lastDecidedAt` (the absolute most-
 *    recent decision for a judge regardless of selected range — the
 *    dashboard "last decided" card needs absolute-recency semantics). */
import { listStoredByCompletedAt, withTiming } from "@core/data/firestore/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

export function computeOverturnRate(overturned: number, total: number): number {
  return total > 0 ? Math.round((overturned / total) * 100) : 0;
}

export interface JudgeBucket {
  decided: number;
  overturned: number;
  upheld: number;
  overturnRate: number;
  lastDecidedAt: number | null;
}

export interface JudgeStats {
  range: { from: number; to: number };
  /** Stats for the chosen range. */
  decided: number;
  overturned: number;
  upheld: number;
  overturnRate: number;
  /** Most recent decidedAt that falls in the range. */
  lastInRangeAt: number | null;
  /** Always-absolute most-recent — independent of selected range. */
  lastDecidedAt: number | null;
}

export interface JudgeRangeOpts { from?: number; to?: number }

interface JudgeDecidedRow {
  judge: string;
  decision: "uphold" | "overturn";
  decidedAt: number;
}

// Lookback cache — most recent N decisions globally per org, used to compute
// absolute lastDecidedAt without a full collection scan. 60s SWR is plenty
// since lastDecidedAt only needs to be fresh within ~minute granularity.
const LOOKBACK_LIMIT = 1000;
const LOOKBACK_TTL_MS = 60_000;
const _lookbackCache = new Map<string, { value: JudgeDecidedRow[]; expiresAt: number }>();
const _lookbackPending = new Map<string, Promise<JudgeDecidedRow[]>>();

export function _resetJudgeAnalyticsCacheForTests(): void {
  _lookbackCache.clear();
  _lookbackPending.clear();
}

function normalize(raw: { judge?: string; decision?: string; decidedAt?: number }): JudgeDecidedRow | null {
  if (!raw?.judge || !raw.decision || !raw.decidedAt) return null;
  if (raw.decision !== "uphold" && raw.decision !== "overturn") return null;
  return {
    judge: raw.judge,
    decision: raw.decision as "uphold" | "overturn",
    decidedAt: raw.decidedAt,
  };
}

async function fetchJudgeRowsInRange(orgId: OrgId, from: number, to: number): Promise<JudgeDecidedRow[]> {
  const raw = await listStoredByCompletedAt<{ judge?: string; decision?: string; decidedAt?: number }>(
    "judge-decided",
    orgId,
    from,
    to,
    { fieldName: "decidedAt" },
  );
  const rows: JudgeDecidedRow[] = [];
  for (const r of raw) {
    const n = normalize(r);
    if (n) rows.push(n);
  }
  return rows;
}

/** Most-recent LOOKBACK_LIMIT decisions globally for the org. Cached 60s SWR.
 *  Used exclusively to compute the absolute `lastDecidedAt` per judge — any
 *  judge active within the recent LOOKBACK_LIMIT decisions will have an
 *  accurate value; long-inactive judges will return null (acceptable: the
 *  dashboard "last decided" card showing empty for a judge who hasn't
 *  decided in 1000+ org-wide appeals is semantically correct). */
async function fetchLookback(orgId: OrgId): Promise<JudgeDecidedRow[]> {
  const key = String(orgId);
  const now = Date.now();
  const cached = _lookbackCache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;
  let pending = _lookbackPending.get(key);
  if (!pending) {
    pending = (async () => {
      try {
        const raw = await listStoredByCompletedAt<{ judge?: string; decision?: string; decidedAt?: number }>(
          "judge-decided",
          orgId,
          0,
          Date.now(),
          { fieldName: "decidedAt", limit: LOOKBACK_LIMIT },
        );
        const rows: JudgeDecidedRow[] = [];
        for (const r of raw) {
          const n = normalize(r);
          if (n) rows.push(n);
        }
        _lookbackCache.set(key, { value: rows, expiresAt: Date.now() + LOOKBACK_TTL_MS });
        return rows;
      } finally {
        _lookbackPending.delete(key);
      }
    })();
    _lookbackPending.set(key, pending);
  }
  return pending;
}

/** Aggregate a (judge-filtered) row set into the dashboard's range bucket.
 *  Rows are assumed already filtered to the desired window by the caller —
 *  no second pass needed. */
function bucket(rows: JudgeDecidedRow[]): JudgeBucket {
  let overturned = 0;
  let upheld = 0;
  let last = 0;
  for (const r of rows) {
    if (r.decision === "overturn") overturned++;
    else upheld++;
    if (r.decidedAt > last) last = r.decidedAt;
  }
  const decided = overturned + upheld;
  return {
    decided,
    overturned,
    upheld,
    overturnRate: computeOverturnRate(overturned, decided),
    lastDecidedAt: last || null,
  };
}

function resolveRange(opts?: JudgeRangeOpts): { from: number; to: number } {
  const now = Date.now();
  return { from: opts?.from ?? 0, to: opts?.to ?? now };
}

export function getMyJudgeStats(orgId: OrgId, email: string, opts?: JudgeRangeOpts): Promise<JudgeStats> {
  return withTiming("getMyJudgeStats", () => _getMyJudgeStatsRaw(orgId, email, opts), { category: "db" });
}
async function _getMyJudgeStatsRaw(orgId: OrgId, email: string, opts?: JudgeRangeOpts): Promise<JudgeStats> {
  const range = resolveRange(opts);
  // Two parallel queries — range for the bucketed stats, lookback for
  // absolute lastDecidedAt. Both indexed; total cost dominated by range
  // size + a constant LOOKBACK_LIMIT (cached 60s).
  const [rangeRows, lookbackRows] = await Promise.all([
    fetchJudgeRowsInRange(orgId, range.from, range.to),
    fetchLookback(orgId),
  ]);
  const mineInRange = rangeRows.filter((r) => r.judge === email);
  const b = bucket(mineInRange);
  const lastDecidedAt = lookbackRows
    .filter((r) => r.judge === email)
    .reduce<number | null>((acc, r) => (r.decidedAt > (acc ?? 0) ? r.decidedAt : acc), null);
  return {
    range,
    decided: b.decided,
    overturned: b.overturned,
    upheld: b.upheld,
    overturnRate: b.overturnRate,
    lastInRangeAt: b.lastDecidedAt,
    lastDecidedAt,
  };
}
