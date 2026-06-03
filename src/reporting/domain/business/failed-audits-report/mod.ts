/** Failed Audits report — failures-only analytics over the failed-finding index.
 *
 *  Five read shapes, all pure aggregation over queryFailedFindings:
 *    1. line items (paginated)
 *    2. appealed-and-still-failed (appealed && appeal denied)
 *    3. failure by question (ranked)
 *    4. department x question matrix
 *    5. #1 fail drill-down (ranked, with graceful filter degradation)
 *  Mirrors chargeback-report — thin business layer, no HTTP. */
import { queryFailedFindings } from "@audit/domain/data/failed-finding-repository/mod.ts";
import type { FailedFilters } from "@audit/domain/data/failed-finding-repository/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";
import type { FailedFindingIndexEntry } from "@core/dto/types.ts";

const MATRIX_QUESTION_CAP = 40;

export type { FailedFilters };

export interface Paged<T> {
  rows: T[];
  total: number;
  page: number;
  pages: number;
}

function paginate<T>(all: T[], page: number, limit: number): Paged<T> {
  const lim = Math.min(500, Math.max(10, limit));
  const pages = Math.max(1, Math.ceil(all.length / lim));
  const pg = Math.min(Math.max(1, page), pages);
  return { rows: all.slice((pg - 1) * lim, pg * lim), total: all.length, page: pg, pages };
}

/** View 1 — exact failed findings (newest first), paginated. */
export async function getFailedFindings(
  orgId: OrgId, from: number, to: number, filters: FailedFilters, page = 1, limit = 100,
): Promise<Paged<FailedFindingIndexEntry>> {
  const rows = (await queryFailedFindings(orgId, from, to, filters))
    .sort((a, b) => b.completedAt - a.completedAt);
  return paginate(rows, page, limit);
}

/** View 2 — appealed and still failed (appeal denied). */
export async function getAppealedStillFailed(
  orgId: OrgId, from: number, to: number, filters: FailedFilters, page = 1, limit = 100,
): Promise<Paged<FailedFindingIndexEntry>> {
  return getFailedFindings(orgId, from, to, { ...filters, appealedOnly: true }, page, limit);
}

export interface QuestionCount {
  header: string;
  questionKey: string;
  count: number;
}

/** View 3 — failure by question (ranked desc). */
export async function getFailureByQuestion(
  orgId: OrgId, from: number, to: number, filters: FailedFilters,
): Promise<{ rows: QuestionCount[]; total: number }> {
  const rows = await queryFailedFindings(orgId, from, to, filters);
  const by = new Map<string, QuestionCount>();
  for (const r of rows) {
    const cur = by.get(r.questionKey) ?? { header: r.header, questionKey: r.questionKey, count: 0 };
    cur.count++;
    by.set(r.questionKey, cur);
  }
  const ranked = [...by.values()].sort((a, b) => b.count - a.count || a.header.localeCompare(b.header));
  return { rows: ranked, total: rows.length };
}

export interface FailureMatrix {
  departments: string[];
  questions: string[];
  cells: Record<string, Record<string, number>>; // cells[questionKey][department] = count
  rowTotals: Record<string, number>;             // by questionKey
  colTotals: Record<string, number>;             // by department
  grandTotal: number;
  truncatedQuestions: number;                     // questions dropped past the cap
  headerByKey: Record<string, string>;
}

/** View 4 — department x question matrix. Questions capped to the top
 *  MATRIX_QUESTION_CAP by total failures (the rest are reported as truncated). */
export async function getFailureMatrix(
  orgId: OrgId, from: number, to: number, filters: FailedFilters,
): Promise<FailureMatrix> {
  const rows = await queryFailedFindings(orgId, from, to, filters);
  const UNSET = "(unassigned)";
  const cells: Record<string, Record<string, number>> = {};
  const rowTotals: Record<string, number> = {};
  const colTotals: Record<string, number> = {};
  const headerByKey: Record<string, string> = {};
  const deptSet = new Set<string>();
  let grandTotal = 0;
  for (const r of rows) {
    const dep = (r.department ?? "").trim() || UNSET;
    deptSet.add(dep);
    headerByKey[r.questionKey] = r.header;
    (cells[r.questionKey] ??= {})[dep] = (cells[r.questionKey][dep] ?? 0) + 1;
    rowTotals[r.questionKey] = (rowTotals[r.questionKey] ?? 0) + 1;
    colTotals[dep] = (colTotals[dep] ?? 0) + 1;
    grandTotal++;
  }
  const allQuestions = Object.keys(rowTotals).sort((a, b) => rowTotals[b] - rowTotals[a]);
  const questions = allQuestions.slice(0, MATRIX_QUESTION_CAP);
  const departments = [...deptSet].sort((a, b) => colTotals[b] - colTotals[a]);
  return {
    departments,
    questions,
    cells,
    rowTotals,
    colTotals,
    grandTotal,
    truncatedQuestions: Math.max(0, allQuestions.length - questions.length),
    headerByKey,
  };
}

export interface TopFailResult {
  rows: QuestionCount[];
  /** Human-readable description of the scope actually used. */
  scope: string;
  total: number;
}

/** #1 fail drill-down. Applies the active filters; if there is no data, it
 *  progressively drops the most specific dimension (team member, then shift,
 *  then department) and retries, so "what is the #1 fail for [TM] in [dept] for
 *  [week]" degrades gracefully to dept-wide / shift-wide / all. */
export async function getTopFailRanked(
  orgId: OrgId, from: number, to: number, filters: FailedFilters,
): Promise<TopFailResult> {
  const describe = (f: FailedFilters): string => {
    const parts: string[] = [];
    if (f.voName) parts.push(`team member "${f.voName}"`);
    if (f.shift) parts.push(`shift "${f.shift}"`);
    if (f.department) parts.push(`department "${f.department}"`);
    if (f.failureSource) parts.push(`source ${f.failureSource}`);
    return parts.length ? parts.join(", ") : "all failures";
  };

  // Successively relax: full filters -> drop voName -> drop shift -> drop dept.
  const ladder: FailedFilters[] = [
    filters,
    { ...filters, voName: undefined },
    { ...filters, voName: undefined, shift: undefined },
    { ...filters, voName: undefined, shift: undefined, department: undefined },
  ];
  // De-dup adjacent identical rungs (e.g. no voName set means rung 1 == rung 2).
  for (const f of ladder) {
    const { rows, total } = await getFailureByQuestion(orgId, from, to, f);
    if (total > 0) return { rows, scope: describe(f), total };
  }
  return { rows: [], scope: describe(filters), total: 0 };
}
