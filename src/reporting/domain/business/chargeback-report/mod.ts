/** Chargeback report service — queries audit-done-idx and builds
 *  chargeback/omission/wire entries from reviewed findings. */

import {
  queryAuditDoneIndex as queryAuditDoneIndexStats,
  getChargebackEntries as getChargebackEntriesStats,
  getWireDeductionEntries as getWireDeductionEntriesStats,
} from "@audit/domain/data/stats-repository/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";
import type { AuditDoneIndexEntry, ChargebackEntry, WireDeductionEntry } from "@core/dto/types.ts";
import { classifyChargebacks, isOfficeBypassed } from "@audit/domain/business/chargeback-engine/mod.ts";
import { isNewerFinding, normalizeRecordId } from "@reporting/domain/business/email-report-engine/mod.ts";

export async function queryAuditDoneIndex(orgId: OrgId, from: number, to: number): Promise<AuditDoneIndexEntry[]> {
  return await queryAuditDoneIndexStats(orgId, from, to);
}

export async function getChargebackEntries(orgId: OrgId, since: number, until: number): Promise<ChargebackEntry[]> {
  return await getChargebackEntriesStats(orgId, since, until);
}

export async function getWireDeductionEntries(orgId: OrgId, since: number, until: number): Promise<WireDeductionEntry[]> {
  return await getWireDeductionEntriesStats(orgId, since, until);
}

export interface ChargebackReportResult {
  chargebacks: ChargebackEntry[];
  omissions: ChargebackEntry[];
}

/** Query chargebacks for a date range, filtering by reviewed.
 *
 *  No office-bypass filter here, deliberately. A ChargebackEntry stores no
 *  department, so the only office-ish field to match was `destination` — the
 *  RESORT ("SMD - Gatlinburg, TN"), not the selling office. That dropped
 *  legitimate rows from non-bypassed offices whenever the guest happened to be
 *  booked at a resort whose code collides with a bypass pattern (and the match
 *  is a loose substring, so "Gatlinburg" also hits the "INB" pattern).
 *
 *  Filtering on office here is redundant anyway: step-finalize skips the review
 *  queue for bypassed offices (step-finalize/mod.ts), so their findings are
 *  never reviewed, and the `reviewedIds` filter below already excludes them.
 *  Verified against prod for the week of 2026-07-27: 72 failed findings across
 *  all 10 bypassed offices, 0 of them present in the report. */
/** True if this entry's audit is FINISHED — settled by any terminal path, not
 *  just a human review.
 *
 *  The report gated on `reviewedIds` alone until 2026-08-18, which silently
 *  dropped every invalid-Genie fail: an audit with no playable recording never
 *  enters the review queue, so it can never acquire a `review-done` row, so it
 *  was excluded forever — not late, never. Measured on the week of 2026-08-10:
 *  31 invalid-Genie entries, 0 of them on the sheet.
 *
 *  This is the same "settled" predicate audit-history and the dashboard already
 *  use (`reviewedIds.has(id) || reason === "perfect_score" || "invalid_genie"`);
 *  the chargeback report was the one money path still using the bare set.
 *
 *  Three ways to recognise an invalid Genie, because the signal was added in
 *  layers: the index `reason` (authoritative, written at finalize), the entry's
 *  own `invalidGenie` flag (2026-08-18 onward), and the auto-generated failed-
 *  question header (the only signal on older entries). */
function isSettled(
  entry: ChargebackEntry,
  reviewedIds: Set<string>,
  reasonByFinding: Map<string, AuditDoneIndexEntry["reason"]>,
): boolean {
  if (reviewedIds.has(entry.findingId)) return true;
  const reason = reasonByFinding.get(entry.findingId);
  if (reason === "invalid_genie" || reason === "perfect_score") return true;
  if (entry.invalidGenie) return true;
  return (entry.failedQHeaders ?? []).some((h) => /invalid genie|no recording/i.test(h));
}

/** Query chargebacks for a date range: settled audits only, superseded rows
 *  dropped.
 *
 *  The supersede pass is why this reads the audit index. A re-audit is a BRAND
 *  NEW finding with a new id (`reaudit/mod.ts` stamps `appealSourceFindingId` on
 *  the new one) and nothing ever retires the original's chargeback entry —
 *  every `deleteChargebackEntry` call is keyed on the finding being processed,
 *  never on the finding it replaced. So a 0% invalid Genie whose audio was
 *  resubmitted and scored 100 would otherwise post as a fail forever.
 *
 *  The supersede signal is a NEWER FINDING ON THE SAME QuickBase record — the
 *  same rule `dedupeByRecordKeepNewest` already applies to the email reports.
 *  The lookahead runs to `now`, not `until`: a resubmission lands days after the
 *  week it belongs to.
 *
 *  A row is dropped only when something strictly newer than it exists on its
 *  record. An entry whose own index row is missing is KEPT, not dropped — losing
 *  a real deduction is worse than carrying a stale one, and this is payroll. */
export async function queryChargebackReport(
  orgId: OrgId,
  since: number,
  until: number,
  reviewedIds: Set<string>,
): Promise<ChargebackReportResult> {
  const entries = await getChargebackEntries(orgId, since, until);
  if (!entries.length) return { chargebacks: [], omissions: [] };

  const idx = await queryAuditDoneIndex(orgId, since, Date.now());
  const reasonByFinding = new Map<string, AuditDoneIndexEntry["reason"]>();
  const newestByRecord = new Map<string, AuditDoneIndexEntry>();
  for (const row of idx) {
    reasonByFinding.set(row.findingId, row.reason);
    const rid = normalizeRecordId(row.recordId);
    if (!rid) continue;
    const cur = newestByRecord.get(rid);
    if (!cur || isNewerFinding(row, cur)) newestByRecord.set(rid, row);
  }

  const settled = entries.filter((e) => isSettled(e, reviewedIds, reasonByFinding));
  const current = settled.filter((e) => {
    const rid = normalizeRecordId(e.recordId);
    if (!rid) return true;
    const newest = newestByRecord.get(rid);
    if (!newest || newest.findingId === e.findingId) return true;
    return (newest.completedAt ?? 0) <= e.ts;
  });
  return classifyChargebacks(current);
}

/** Query wire deductions for a date range, filtering by reviewed + score + bypass. */
export async function queryWireReport(
  orgId: OrgId,
  since: number,
  until: number,
  reviewedIds: Set<string>,
  bypassPatterns: string[],
): Promise<WireDeductionEntry[]> {
  const entries = await getWireDeductionEntries(orgId, since, until);
  return entries.filter(
    (e) => e.score < 100 && reviewedIds.has(e.findingId) && !isOfficeBypassed(e.office ?? "", bypassPatterns),
  );
}
