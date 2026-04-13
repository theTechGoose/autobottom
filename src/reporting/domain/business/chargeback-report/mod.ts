/** Chargeback report service — queries audit-done-idx and builds
 *  chargeback/omission/wire entries from reviewed findings. */

import { getKv, orgKey } from "@core/domain/data/deno-kv/mod.ts";
import type { OrgId } from "@core/domain/data/deno-kv/mod.ts";
import type { AuditDoneIndexEntry, ChargebackEntry, WireDeductionEntry } from "@core/dto/types.ts";
import { classifyChargebacks, isOfficeBypassed } from "@audit/domain/business/chargeback-engine/mod.ts";

function padTs(ts: number): string {
  return String(ts).padStart(15, "0");
}

export async function queryAuditDoneIndex(orgId: OrgId, from: number, to: number): Promise<AuditDoneIndexEntry[]> {
  const db = await getKv();
  const start = orgKey(orgId, "audit-done-idx", padTs(from));
  const end = orgKey(orgId, "audit-done-idx", padTs(to + 1));
  const entries: AuditDoneIndexEntry[] = [];
  for await (const entry of db.list<AuditDoneIndexEntry>({ start, end })) {
    if (entry.value) entries.push(entry.value);
  }
  return entries;
}

export async function getChargebackEntries(orgId: OrgId, since: number, until: number): Promise<ChargebackEntry[]> {
  const db = await getKv();
  const prefix = orgKey(orgId, "__chargeback-entry__");
  const items: ChargebackEntry[] = [];
  for await (const r of db.list<ChargebackEntry>({ prefix })) {
    const v = r.value as unknown as ChargebackEntry;
    if (v.ts >= since && v.ts <= until) items.push(v);
  }
  return items;
}

export async function getWireDeductionEntries(orgId: OrgId, since: number, until: number): Promise<WireDeductionEntry[]> {
  const db = await getKv();
  const prefix = orgKey(orgId, "__wire-deduction-entry__");
  const items: WireDeductionEntry[] = [];
  for await (const r of db.list<WireDeductionEntry>({ prefix })) {
    const v = r.value as unknown as WireDeductionEntry;
    if (v.ts >= since && v.ts <= until) items.push(v);
  }
  return items;
}

export interface ChargebackReportResult {
  chargebacks: ChargebackEntry[];
  omissions: ChargebackEntry[];
}

/**
 * Query chargebacks for a date range, filtering by reviewed status and office bypass.
 */
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

/**
 * Query wire deductions for a date range, filtering by reviewed status, score, and bypass.
 */
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
