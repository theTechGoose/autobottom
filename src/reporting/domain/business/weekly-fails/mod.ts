/** Prior-week fails report — INTERNAL (date-leg) audits that either died on an
 *  invalid genie or were still failing AFTER a human reviewed them.
 *
 *  "Internal" and "date leg" are the same thing, named two ways in this
 *  codebase: a finding whose `recordingIdField` is NOT "GenieNumber". The index
 *  carries it as `isPackage`, and the report engine maps it straight across —
 *  `isPackage ? "partner" : "internal"`. Partner packages are excluded by
 *  default; that is not a small trim, it removed 217 of 248 invalid genies for
 *  the week of 2026-08-10.
 *
 *  Read-only and index-only: every field the criteria need (reason, score,
 *  doneAt, department, shift, VO) already lives on `audit-done-idx`, so this
 *  never hydrates finding docs. That is deliberate — per-request finding
 *  hydration on a report endpoint wedged prod once already.
 *
 *  On the window. The report means "settled during the week", so it filters on
 *  `doneAt` (review time for a reviewed audit), while `audit-done-idx`
 *  range-scans on `completedAt`. Those look like they could disagree, but for
 *  the rows this report selects they do not: `writeSoleAuditDoneIndex` rewrites
 *  a reviewed row's `completedAt` to the review timestamp and re-keys the doc
 *  there, so the row physically MOVES to its settle time. Measured against prod
 *  over the week of 2026-08-10 (730 matching rows): doneAt − completedAt was
 *  0.00 days at p50, p90, p99 AND max.
 *
 *  So the lookback below is a safety margin, not a correction — it exists in
 *  case a row is ever written without that re-key (a legacy row, or a new code
 *  path). The doneAt filter is applied in memory regardless, so a too-small
 *  lookback can only ever omit rows, never admit wrong ones. Keep it modest:
 *  a 120-day scan read 63k rows and took ~11s against prod, which is exactly
 *  the shape of request that wedges this deployment.
 *
 *  `failed-finding-idx` is keyed on the finding's own completedAt, so the
 *  question-name join is scanned over the matched rows' actual span and
 *  matched by findingId — never by position in the window. */

import type { OrgId } from "@core/data/deno-kv/mod.ts";
import type { AuditDoneIndexEntry } from "@core/dto/types.ts";
import { queryAuditDoneIndex } from "@audit/domain/data/stats-repository/mod.ts";
import { queryFailedFindings } from "@audit/domain/data/failed-finding-repository/mod.ts";
import { normalizeRecordId, isNewerFinding } from "@reporting/domain/business/email-report-engine/mod.ts";

/** Safety margin on the completedAt scan. Measured lag is zero (see the note
 *  above), so this is slack for an unexpected row, not a correction. Two weeks
 *  keeps the scan small — the cost of widening it is steep and non-linear. */
export const DEFAULT_LOOKBACK_DAYS = 14;

export type WeeklyFailCategory = "invalid_genie" | "failed_post_review";

/** Which side of the business to report on. "internal" = date legs, the
 *  default and what the report is for. */
export type WeeklyFailScope = "internal" | "package" | "all";

/** A row is internal (a date leg) unless it is explicitly flagged a package.
 *  Falsy-means-internal matches how the chargeback report already branches, so
 *  a row missing the flag is never silently dropped from payroll-adjacent
 *  numbers. */
export function isInternalDateLeg(e: { isPackage?: boolean }): boolean {
  return !e.isPackage;
}

export function inScope(e: { isPackage?: boolean }, scope: WeeklyFailScope): boolean {
  if (scope === "all") return true;
  return scope === "internal" ? isInternalDateLeg(e) : !isInternalDateLeg(e);
}

export interface WeeklyFailRow {
  findingId: string;
  category: WeeklyFailCategory;
  recordId?: string;
  recordingId?: string;
  voName?: string;
  employeeId?: string;
  owner?: string;
  department?: string;
  shift?: string;
  score: number;
  /** Raw index reason — "invalid_genie" or "reviewed". */
  reason?: string;
  /** When the BOT finished grading. */
  completedAt: number;
  /** When the audit SETTLED — review time for reviewed audits. The week filter
   *  runs on this. */
  doneAt: number;
  /** "pending" means a judge could still overturn this fail. */
  appealStatus?: "none" | "pending" | "complete";
  isPackage?: boolean;
  /** Question headers that were failing at the last index write. Empty when the
   *  finding predates the failed-question index (June 2026) or nothing matched. */
  failedQuestions: string[];
  /** Set when a NEWER audit exists for the same QuickBase record — i.e. this one
   *  was re-audited. Left in the list rather than dropped, so a re-submitted
   *  invalid genie is still visible; filter on it if you want only live rows. */
  supersededByFindingId?: string;
  reportUrl: string;
}

export interface WeeklyFailsResult {
  window: { since: number; until: number; timeZone: string; filteredOn: "doneAt"; scope: WeeklyFailScope };
  scan: { from: number; to: number; lookbackDays: number; rowsScanned: number };
  counts: { total: number; invalidGenie: number; failedPostReview: number; superseded: number };
  items: WeeklyFailRow[];
}

/** The settle time a row is judged on. Falls back to completedAt for rows
 *  written before doneAt was populated. */
export function settledAt(e: AuditDoneIndexEntry): number {
  return e.doneAt ?? e.completedAt;
}

/** Does this index row meet the report criteria? Returns null when it doesn't.
 *
 *  - invalid genie  → the bot found no usable recording; scored 0 and settled
 *                     without ever entering the review queue.
 *  - failed post review → a human reviewed it and it is STILL under 100.
 *
 *  Audits that failed the bot but have NOT been reviewed yet are deliberately
 *  excluded: they are not "post review", and a reviewer may still clear them. */
export function classifyWeeklyFail(e: AuditDoneIndexEntry): WeeklyFailCategory | null {
  if (e.reason === "invalid_genie") return "invalid_genie";
  if (e.reason === "reviewed" && typeof e.score === "number" && e.score < 100) {
    return "failed_post_review";
  }
  return null;
}

export interface WeeklyFailsOpts {
  /** Defaults to "internal" — date legs only. */
  scope?: WeeklyFailScope;
  lookbackDays?: number;
  selfUrl?: string;
  /** Join the failed-question names. On by default; it is a second full range
   *  scan and roughly doubles the request, so callers that only need counts or
   *  identities can turn it off. */
  includeQuestions?: boolean;
}

export async function queryWeeklyFails(
  orgId: OrgId,
  since: number,
  until: number,
  opts: WeeklyFailsOpts = {},
): Promise<WeeklyFailsResult> {
  const scope: WeeklyFailScope = opts.scope ?? "internal";
  const lookbackDays = Math.max(0, opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS);
  const scanFrom = since - lookbackDays * 86_400_000;
  // Upper bound stays at `until`: doneAt >= completedAt always (you cannot
  // review an audit before the bot finishes it), so nothing with doneAt inside
  // the week can have completedAt past the week's end.
  const rows = await queryAuditDoneIndex(orgId, scanFrom, until);

  const inWeek = rows.filter((e) => {
    const t = settledAt(e);
    return t >= since && t <= until;
  });

  const matched: Array<{ e: AuditDoneIndexEntry; category: WeeklyFailCategory }> = [];
  for (const e of inWeek) {
    if (!inScope(e, scope)) continue;
    const category = classifyWeeklyFail(e);
    if (category) matched.push({ e, category });
  }

  // Mark (don't drop) rows superseded by a newer audit on the same record.
  // Newest-per-record is computed over the WHOLE scan, not just the week, so a
  // fail re-audited the following Monday is still flagged.
  const newestByRecord = new Map<string, AuditDoneIndexEntry>();
  for (const e of rows) {
    const rid = normalizeRecordId(e.recordId);
    if (!rid) continue;
    const cur = newestByRecord.get(rid);
    if (!cur || isNewerFinding(e, cur)) newestByRecord.set(rid, e);
  }

  // The question join MUST use the wide scan window, not the matched rows' own
  // span. `failed-finding-idx` is keyed on the finding's ORIGINAL bot grading
  // time, whereas a matched row's `completedAt` has been re-keyed to its review
  // time — always later. Narrowing this to the matched span silently lost the
  // question names on 111 of 730 rows when tried against prod.
  const wanted = new Set(matched.map((m) => m.e.findingId));
  const questionsByFinding = opts.includeQuestions === false
    ? new Map<string, string[]>()
    : await failedQuestionsFor(orgId, scanFrom, until, wanted);

  const base = opts.selfUrl ?? "";
  const items: WeeklyFailRow[] = matched.map(({ e, category }) => {
    const rid = normalizeRecordId(e.recordId);
    const newest = rid ? newestByRecord.get(rid) : undefined;
    const superseded = newest && newest.findingId !== e.findingId ? newest.findingId : undefined;
    return {
      findingId: e.findingId,
      category,
      recordId: e.recordId,
      recordingId: e.recordingId,
      voName: e.voName,
      employeeId: e.employeeId,
      owner: e.owner,
      department: e.department,
      shift: e.shift,
      score: e.score,
      reason: e.reason,
      completedAt: e.completedAt,
      doneAt: settledAt(e),
      appealStatus: e.appealStatus,
      isPackage: e.isPackage,
      failedQuestions: questionsByFinding.get(e.findingId) ?? [],
      ...(superseded ? { supersededByFindingId: superseded } : {}),
      reportUrl: `${base}/audit/report?id=${e.findingId}`,
    };
  });

  items.sort((a, b) => a.doneAt - b.doneAt);

  return {
    window: { since, until, timeZone: "America/New_York", filteredOn: "doneAt", scope },
    scan: { from: scanFrom, to: until, lookbackDays, rowsScanned: rows.length },
    counts: {
      total: items.length,
      invalidGenie: items.filter((i) => i.category === "invalid_genie").length,
      failedPostReview: items.filter((i) => i.category === "failed_post_review").length,
      superseded: items.filter((i) => i.supersededByFindingId).length,
    },
    items,
  };
}

/** Question headers per finding, from the failed-question index. Best-effort:
 *  the index only covers June 2026 onward and the report is still correct
 *  without it, so a failure here degrades to empty lists rather than a 500. */
async function failedQuestionsFor(
  orgId: OrgId,
  from: number,
  to: number,
  wanted: Set<string>,
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (wanted.size === 0) return out;
  try {
    const rows = await queryFailedFindings(orgId, from, to, {});
    for (const r of rows) {
      if (!wanted.has(r.findingId)) continue;
      const header = String(r.header ?? "").trim();
      if (!header) continue;
      const list = out.get(r.findingId);
      if (list) {
        if (!list.includes(header)) list.push(header);
      } else {
        out.set(r.findingId, [header]);
      }
    }
  } catch (err) {
    console.warn(`[WEEKLY-FAILS] failed-question join skipped (non-fatal):`, err);
  }
  return out;
}
