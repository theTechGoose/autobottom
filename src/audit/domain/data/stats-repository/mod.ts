/** Stats repository — pipeline tracking, audit-done-idx, chargeback/wire entries.
 *  Ported from lib/kv.ts tracking/stats/index/chargeback/wire sections. */

import { getKv, orgKey } from "@core/data/deno-kv/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";
import type { AuditDoneIndexEntry, ChargebackEntry, WireDeductionEntry } from "@core/dto/types.ts";
import { getFinding, saveFinding } from "@audit/domain/data/audit-repository/mod.ts";

const DAY_MS = 86_400_000;

function padTs(ts: number): string { return String(ts).padStart(15, "0"); }

// ── Active Tracking ──────────────────────────────────────────────────────────

export async function trackActive(orgId: OrgId, findingId: string, step: string, meta?: Record<string, unknown>): Promise<void> {
  const db = await getKv();
  const existing = (await db.get(orgKey(orgId, "active-tracking", findingId))).value as Record<string, unknown> | null;
  await db.set(orgKey(orgId, "active-tracking", findingId), { ...(existing ?? {}), findingId, step, ts: Date.now(), ...(meta ?? {}) });
  await db.set(["watchdog-active", findingId], { orgId, findingId, step, ts: Date.now() }, { expireIn: 2 * 60 * 60 * 1000 });
}

export async function trackCompleted(orgId: OrgId, findingId: string, meta?: Record<string, unknown>): Promise<void> {
  const db = await getKv();
  await db.delete(orgKey(orgId, "active-tracking", findingId));
  await db.delete(["watchdog-active", findingId]);
  await db.set(orgKey(orgId, "completed-audit-stat", `${Date.now()}-${findingId}`), { findingId, ts: Date.now(), ...(meta ?? {}) });
}

export async function terminateFinding(orgId: OrgId, findingId: string): Promise<void> {
  const db = await getKv();
  const key = orgKey(orgId, "active-tracking", findingId);
  console.log(`🛑 [TERMINATE] terminateFinding orgId=${orgId} fid=${findingId} key=${JSON.stringify(key)}`);
  try {
    const finding = await getFinding(orgId, findingId);
    if (finding && finding.findingStatus !== "finished") {
      finding.findingStatus = "terminated";
      await saveFinding(orgId, finding);
    }
  } catch { /* best-effort */ }
  await db.delete(key);
  await db.delete(["watchdog-active", findingId]);
}

export async function terminateAllActive(orgId: OrgId): Promise<number> {
  const db = await getKv();
  const prefix = orgKey(orgId, "active-tracking");
  console.log(`🛑 [TERMINATE] terminateAllActive orgId=${orgId} prefix=${JSON.stringify(prefix)}`);
  let count = 0;
  for await (const entry of db.list<Record<string, unknown>>({ prefix })) {
    const fid = (entry.value.findingId as string) || String(entry.key[entry.key.length - 1]);
    await terminateFinding(orgId, fid);
    count++;
  }
  console.log(`🛑 [TERMINATE] terminateAllActive done orgId=${orgId} count=${count}`);
  return count;
}

export async function trackError(orgId: OrgId, findingId: string, step: string, error: string): Promise<void> {
  const db = await getKv();
  await db.set(orgKey(orgId, "error-tracking", `${Date.now()}-${findingId}`), { findingId, step, error, ts: Date.now() }, { expireIn: DAY_MS });
}

export async function clearErrors(orgId: OrgId): Promise<number> {
  const db = await getKv();
  let count = 0;
  for await (const entry of db.list({ prefix: orgKey(orgId, "error-tracking") })) {
    await db.delete(entry.key);
    count++;
  }
  return count;
}

export async function trackRetry(orgId: OrgId, findingId: string, step: string, attempt: number): Promise<void> {
  const db = await getKv();
  await db.set(orgKey(orgId, "retry-tracking", `${Date.now()}-${findingId}`), { findingId, step, attempt, ts: Date.now() }, { expireIn: DAY_MS });
}

// ── Completed Stats ──────────────────────────────────────────────────────────

export async function getRecentCompleted(orgId: OrgId, limit = 25): Promise<Record<string, unknown>[]> {
  const db = await getKv();
  const results: Record<string, unknown>[] = [];
  let count = 0;
  for await (const entry of db.list<Record<string, unknown>>({ prefix: orgKey(orgId, "completed-audit-stat") })) {
    results.push(entry.value);
    if (++count >= limit) break;
  }
  return results;
}

export async function updateCompletedStatScore(orgId: OrgId, findingId: string, score: number): Promise<void> {
  const db = await getKv();
  for await (const entry of db.list<Record<string, unknown>>({ prefix: orgKey(orgId, "completed-audit-stat") })) {
    if (entry.value.findingId === findingId) {
      await db.set(entry.key, { ...entry.value, score });
      return;
    }
  }
}

/** Delete every completed-audit-stat entry matching the given findingId. */
export async function deleteCompletedStat(orgId: OrgId, findingId: string): Promise<void> {
  const db = await getKv();
  for await (const entry of db.list<Record<string, unknown>>({ prefix: orgKey(orgId, "completed-audit-stat") })) {
    if (entry.value.findingId === findingId) {
      await db.delete(entry.key);
    }
  }
}

// ── Audit Done Index ─────────────────────────────────────────────────────────

export async function writeAuditDoneIndex(orgId: OrgId, entry: AuditDoneIndexEntry): Promise<void> {
  const db = await getKv();
  await db.set(orgKey(orgId, "audit-done-idx", padTs(entry.completedAt), entry.findingId), entry);
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

export async function findAuditsByRecordId(orgId: OrgId, recordId: string): Promise<AuditDoneIndexEntry[]> {
  const db = await getKv();
  const matches: AuditDoneIndexEntry[] = [];
  for await (const entry of db.list<AuditDoneIndexEntry>({ prefix: orgKey(orgId, "audit-done-idx") })) {
    if (entry.value?.recordId === recordId) matches.push(entry.value);
  }
  return matches.sort((a, b) => b.completedAt - a.completedAt);
}

export async function deleteAuditDoneIndexEntry(orgId: OrgId, findingId: string, completedAt: number): Promise<void> {
  const db = await getKv();
  await db.delete(orgKey(orgId, "audit-done-idx", padTs(completedAt), findingId));
}

// ── Chargeback Entries ───────────────────────────────────────────────────────

export async function saveChargebackEntry(orgId: OrgId, entry: ChargebackEntry): Promise<void> {
  const db = await getKv();
  await db.set(orgKey(orgId, "chargeback-entry", entry.findingId), entry);
}

export async function deleteChargebackEntry(orgId: OrgId, findingId: string): Promise<void> {
  const db = await getKv();
  await db.delete(orgKey(orgId, "chargeback-entry", findingId));
}

export async function getChargebackEntry(orgId: OrgId, findingId: string): Promise<ChargebackEntry | null> {
  const db = await getKv();
  return (await db.get<ChargebackEntry>(orgKey(orgId, "chargeback-entry", findingId))).value;
}

export async function getChargebackEntries(orgId: OrgId, since: number, until: number): Promise<ChargebackEntry[]> {
  const db = await getKv();
  const items: ChargebackEntry[] = [];
  for await (const r of db.list<ChargebackEntry>({ prefix: orgKey(orgId, "chargeback-entry") })) {
    if (r.value.ts >= since && r.value.ts <= until) items.push(r.value);
  }
  return items;
}

// ── Wire Deduction Entries ───────────────────────────────────────────────────

export async function saveWireDeductionEntry(orgId: OrgId, entry: WireDeductionEntry): Promise<void> {
  const db = await getKv();
  await db.set(orgKey(orgId, "wire-deduction-entry", entry.findingId), entry);
}

export async function deleteWireDeductionEntry(orgId: OrgId, findingId: string): Promise<void> {
  const db = await getKv();
  await db.delete(orgKey(orgId, "wire-deduction-entry", findingId));
}

export async function getWireDeductionEntry(orgId: OrgId, findingId: string): Promise<WireDeductionEntry | null> {
  const db = await getKv();
  return (await db.get<WireDeductionEntry>(orgKey(orgId, "wire-deduction-entry", findingId))).value;
}

export async function getWireDeductionEntries(orgId: OrgId, since: number, until: number): Promise<WireDeductionEntry[]> {
  const db = await getKv();
  const items: WireDeductionEntry[] = [];
  for await (const r of db.list<WireDeductionEntry>({ prefix: orgKey(orgId, "wire-deduction-entry") })) {
    if (r.value.ts >= since && r.value.ts <= until) items.push(r.value);
  }
  return items;
}

// ── Stuck Findings (watchdog) ────────────────────────────────────────────────

export async function getStuckFindings(thresholdMs = 15 * 60 * 1000): Promise<Array<{ orgId: string; findingId: string; step: string; ts: number; ageMs: number }>> {
  const db = await getKv();
  const now = Date.now();
  const stuck: Array<{ orgId: string; findingId: string; step: string; ts: number; ageMs: number }> = [];
  for await (const entry of db.list<{ orgId: string; findingId: string; step: string; ts: number }>({ prefix: ["watchdog-active"] })) {
    const v = entry.value;
    if (!v?.ts) continue;
    const ageMs = now - v.ts;
    if (ageMs > thresholdMs) stuck.push({ ...v, ageMs });
  }
  return stuck;
}

// ── Pipeline Stats Aggregation ───────────────────────────────────────────────

export async function getStats(orgId: OrgId): Promise<{
  active: Record<string, unknown>[];
  completedCount: number;
  errors: Record<string, unknown>[];
  retries: Record<string, unknown>[];
}> {
  const db = await getKv();

  const activePrefix = orgKey(orgId, "active-tracking");
  const active: Record<string, unknown>[] = [];
  for await (const entry of db.list<Record<string, unknown>>({ prefix: activePrefix })) {
    const v = entry.value;
    const findingId = (v.findingId as string) || String(entry.key[entry.key.length - 1]);
    active.push({ ...v, findingId });
  }
  console.log(`📊 [STATS] getStats orgId=${orgId} prefix=${JSON.stringify(activePrefix)} activeCount=${active.length}`);

  let completedCount = 0;
  for await (const _entry of db.list({ prefix: orgKey(orgId, "completed-audit-stat") })) {
    completedCount++;
  }

  const errors: Record<string, unknown>[] = [];
  for await (const entry of db.list<Record<string, unknown>>({ prefix: orgKey(orgId, "error-tracking") })) {
    errors.push(entry.value);
  }

  const retries: Record<string, unknown>[] = [];
  for await (const entry of db.list<Record<string, unknown>>({ prefix: orgKey(orgId, "retry-tracking") })) {
    retries.push(entry.value);
  }

  return { active, completedCount, errors, retries };
}
