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

/** Query chargebacks for a date range, filtering by reviewed + bypass. */
export async function queryChargebackReport(
  orgId: OrgId,
  since: number,
  until: number,
  reviewedIds: Set<string>,
  bypassPatterns: string[],
): Promise<ChargebackReportResult> {
  const entries = await getChargebackEntries(orgId, since, until);
  const reviewed = entries.filter(
    (e) => reviewedIds.has(e.findingId) && !isOfficeBypassed(e.destination ?? "", bypassPatterns),
  );
  return classifyChargebacks(reviewed);
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
