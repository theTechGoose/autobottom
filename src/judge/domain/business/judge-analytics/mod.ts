/** Judge analytics — appeal outcome tracking. */
import { listStoredWithKeys } from "@core/data/firestore/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

export function computeOverturnRate(overturned: number, total: number): number {
  return total > 0 ? Math.round((overturned / total) * 100) : 0;
}

const MS_DAY = 86_400_000;

export interface JudgeBucket {
  decided: number;
  overturned: number;
  upheld: number;
  overturnRate: number;
  lastDecidedAt: number | null;
}

export interface JudgeStats {
  week: JudgeBucket;
  month: JudgeBucket;
  allTime: JudgeBucket;
  decisions: number; // total all-time, same as allTime.decided for convenience
}

interface JudgeDecidedRow {
  judge: string;
  decision: "uphold" | "overturn";
  decidedAt: number;
}

// 60s SWR cache keyed by orgId — judge-decided has no completedAt index, so
// every fetch is a full collection scan. Dashboard polls every 10s; cache
// shares one scan across ~6 polls.
const _judgeRowsCache = new Map<string, { value: JudgeDecidedRow[]; expiresAt: number }>();
const _judgeRowsPending = new Map<string, Promise<JudgeDecidedRow[]>>();
const JUDGE_ROWS_TTL_MS = 60_000;

export function _resetJudgeAnalyticsCacheForTests(): void {
  _judgeRowsCache.clear();
  _judgeRowsPending.clear();
}

async function fetchJudgeRows(orgId: OrgId): Promise<JudgeDecidedRow[]> {
  const key = String(orgId);
  const now = Date.now();
  const cached = _judgeRowsCache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;
  let pending = _judgeRowsPending.get(key);
  if (!pending) {
    pending = (async () => {
      try {
        const all = await listStoredWithKeys<{ judge?: string; decision?: string; decidedAt?: number }>(
          "judge-decided",
          orgId,
        );
        const rows: JudgeDecidedRow[] = [];
        for (const { value } of all) {
          if (!value?.judge || !value.decision || !value.decidedAt) continue;
          if (value.decision !== "uphold" && value.decision !== "overturn") continue;
          rows.push({
            judge: value.judge,
            decision: value.decision as "uphold" | "overturn",
            decidedAt: value.decidedAt,
          });
        }
        _judgeRowsCache.set(key, { value: rows, expiresAt: Date.now() + JUDGE_ROWS_TTL_MS });
        return rows;
      } finally {
        _judgeRowsPending.delete(key);
      }
    })();
    _judgeRowsPending.set(key, pending);
  }
  return pending;
}

function bucket(rows: JudgeDecidedRow[], from: number, to: number): JudgeBucket {
  let overturned = 0;
  let upheld = 0;
  let last = 0;
  for (const r of rows) {
    if (r.decidedAt < from || r.decidedAt > to) continue;
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

export async function getMyJudgeStats(orgId: OrgId, email: string): Promise<JudgeStats> {
  const all = await fetchJudgeRows(orgId);
  const mine = all.filter((r) => r.judge === email);
  const now = Date.now();
  const week = bucket(mine, now - 7 * MS_DAY, now);
  const month = bucket(mine, now - 30 * MS_DAY, now);
  const allTime = bucket(mine, 0, now);
  return { week, month, allTime, decisions: allTime.decided };
}
