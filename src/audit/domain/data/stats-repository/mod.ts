/** Stats repository — pipeline tracking, audit-done-idx, chargeback/wire entries.
 *  Firestore-backed via setStored* helpers. */

import {
  getStored, setStored, deleteStored, listStored, listStoredWithKeys, listStoredByIdPrefix, listStoredByCompletedAt,
} from "@core/data/firestore/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";
import type { AuditDoneIndexEntry, ChargebackEntry, WireDeductionEntry } from "@core/dto/types.ts";
import { getFinding, saveFinding } from "@audit/domain/data/audit-repository/mod.ts";

const DAY_MS = 86_400_000;

function padTs(ts: number): string { return String(ts).padStart(15, "0"); }

// Watchdog-active is org-agnostic (one global namespace). Use empty-string org.
const GLOBAL = "" as OrgId;

// ── Active Tracking ──────────────────────────────────────────────────────────

export async function trackActive(orgId: OrgId, findingId: string, step: string, meta?: Record<string, unknown>): Promise<void> {
  const existing = (await getStored<Record<string, unknown>>("active-tracking", orgId, findingId)) ?? {};
  await setStored("active-tracking", orgId, [findingId], { ...existing, findingId, step, ts: Date.now(), ...(meta ?? {}) });
  await setStored("watchdog-active", GLOBAL, [findingId], { orgId, findingId, step, ts: Date.now() }, { expireInMs: 2 * 60 * 60 * 1000 });
}

export async function trackCompleted(orgId: OrgId, findingId: string, meta?: Record<string, unknown>): Promise<void> {
  await deleteStored("active-tracking", orgId, findingId);
  await deleteStored("watchdog-active", GLOBAL, findingId);
  await setStored("completed-audit-stat", orgId, [`${Date.now()}-${findingId}`], { findingId, ts: Date.now(), ...(meta ?? {}) });
}

export async function terminateFinding(orgId: OrgId, findingId: string): Promise<void> {
  console.log(`🛑 [TERMINATE] terminateFinding orgId=${orgId} fid=${findingId}`);
  try {
    const finding = await getFinding(orgId, findingId);
    if (finding && finding.findingStatus !== "finished") {
      finding.findingStatus = "terminated";
      await saveFinding(orgId, finding);
    }
  } catch { /* best-effort */ }
  await deleteStored("active-tracking", orgId, findingId);
  await deleteStored("watchdog-active", GLOBAL, findingId);
}

export async function terminateAllActive(orgId: OrgId): Promise<number> {
  console.log(`🛑 [TERMINATE] terminateAllActive orgId=${orgId}`);
  const rows = await listStoredWithKeys<Record<string, unknown>>("active-tracking", orgId);
  let count = 0;
  for (const { key, value } of rows) {
    const fid = (value.findingId as string) || String(key[key.length - 1]);
    await terminateFinding(orgId, fid);
    count++;
  }
  console.log(`🛑 [TERMINATE] terminateAllActive done orgId=${orgId} count=${count}`);
  return count;
}

export async function trackError(orgId: OrgId, findingId: string, step: string, error: string): Promise<void> {
  await setStored("error-tracking", orgId, [`${Date.now()}-${findingId}`], { findingId, step, error, ts: Date.now() }, { expireInMs: DAY_MS });
}

export async function clearErrors(orgId: OrgId): Promise<number> {
  const rows = await listStoredWithKeys<Record<string, unknown>>("error-tracking", orgId);
  for (const { key } of rows) await deleteStored("error-tracking", orgId, ...key);
  return rows.length;
}

export async function trackRetry(orgId: OrgId, findingId: string, step: string, attempt: number): Promise<void> {
  await setStored("retry-tracking", orgId, [`${Date.now()}-${findingId}`], { findingId, step, attempt, ts: Date.now() }, { expireInMs: DAY_MS });
}

// ── Completed Stats ──────────────────────────────────────────────────────────

export async function getRecentCompleted(orgId: OrgId, limit = 25): Promise<Record<string, unknown>[]> {
  const all = await listStored<Record<string, unknown>>("completed-audit-stat", orgId);
  return all.slice(0, limit);
}

export async function updateCompletedStatScore(orgId: OrgId, findingId: string, score: number): Promise<void> {
  const rows = await listStoredWithKeys<Record<string, unknown>>("completed-audit-stat", orgId);
  for (const { key, value } of rows) {
    if (value.findingId === findingId) {
      await setStored("completed-audit-stat", orgId, key, { ...value, score });
      return;
    }
  }
}

/** Delete every completed-audit-stat entry matching the given findingId. */
export async function deleteCompletedStat(orgId: OrgId, findingId: string): Promise<void> {
  const rows = await listStoredWithKeys<Record<string, unknown>>("completed-audit-stat", orgId);
  for (const { key, value } of rows) {
    if (value.findingId === findingId) await deleteStored("completed-audit-stat", orgId, ...key);
  }
}

// ── Audit Done Index ─────────────────────────────────────────────────────────
//
// queryAuditDoneIndex / findAuditsByRecordId read directly from `audit-finding`
// records and synthesize the index entry shape on the fly. The audit-done-idx
// type itself is now vestigial — writeAuditDoneIndex still populates it for
// any new audit completion (so live-pipeline behavior is unchanged), but
// readers no longer rely on it. This means the audit-history page reflects
// every finding present in Firestore, including bulk-migrated historical
// data that never went through the live finalize step.

interface FindingShape {
  findingId?: string;
  completedAt?: number;
  startedAt?: number;
  durationMs?: number;
  findingStatus?: string;
  recordingIdField?: string;
  owner?: string;
  reviewedAt?: number | string;
  reviewScore?: number;
  reviewedBy?: string;
  answeredQuestions?: Array<{ answer?: string }>;
  record?: Record<string, unknown>;
}

function findingToIndexEntry(finding: FindingShape): AuditDoneIndexEntry | null {
  const findingId = finding.findingId;
  const completedAt = finding.completedAt;
  if (!findingId || typeof completedAt !== "number") return null;

  const isPackage = finding.recordingIdField === "GenieNumber";
  const aq = finding.answeredQuestions ?? [];
  const yes = aq.filter((q) => /^y/i.test(String(q?.answer ?? ""))).length;
  const score = aq.length > 0 ? Math.round((yes / aq.length) * 100) : 0;
  const rec = (finding.record ?? {}) as Record<string, unknown>;
  const department = String(isPackage ? (rec.OfficeName ?? "") : (rec.ActivatingOffice ?? "")) || undefined;
  const rawVo = typeof rec.VoName === "string" ? rec.VoName : undefined;
  const voName = rawVo
    ? (rawVo.includes(" - ") ? rawVo.split(" - ").slice(1).join(" - ").trim() : rawVo.trim()) || undefined
    : undefined;
  const recordId = String(rec.RecordId ?? "") || undefined;
  const shift = isPackage ? undefined : String(rec.Shift ?? "") || undefined;

  const reviewed = finding.reviewedAt != null;
  const score100 = (typeof finding.reviewScore === "number" ? finding.reviewScore : score) === 100;
  const reason: AuditDoneIndexEntry["reason"] | undefined = reviewed
    ? "reviewed"
    : (score100 ? "perfect_score" : undefined);

  return {
    findingId,
    completedAt,
    score: typeof finding.reviewScore === "number" ? finding.reviewScore : score,
    completed: finding.findingStatus === "finished" || reviewed,
    ...(reason ? { doneAt: completedAt, reason } : {}),
    recordId,
    isPackage,
    voName,
    owner: finding.owner,
    department,
    shift,
    startedAt: finding.startedAt,
    durationMs: finding.durationMs,
    ...(finding.reviewedBy ? { reviewedBy: finding.reviewedBy } : {}),
  };
}

export async function writeAuditDoneIndex(orgId: OrgId, entry: AuditDoneIndexEntry): Promise<void> {
  await setStored("audit-done-idx", orgId, [padTs(entry.completedAt), entry.findingId], entry);
}

export async function queryAuditDoneIndex(orgId: OrgId, from: number, to: number): Promise<AuditDoneIndexEntry[]> {
  console.log(`🔍 [Q-AUDIT-IDX] start orgId=${orgId} from=${from} to=${to}`);
  let findings: FindingShape[];
  try {
    findings = await listStoredByCompletedAt<FindingShape>("audit-finding", orgId, from, to, { limit: 5000 });
  } catch (err) {
    console.error(`❌ [Q-AUDIT-IDX] listStoredByCompletedAt threw:`, err);
    throw err;
  }
  console.log(`🔍 [Q-AUDIT-IDX] got ${findings.length} findings from Firestore`);
  const out: AuditDoneIndexEntry[] = [];
  for (const f of findings) {
    try {
      if (f.findingStatus !== "finished" && f.findingStatus !== "completed" && f.reviewedAt == null) continue;
      const e = findingToIndexEntry(f);
      if (e) out.push(e);
    } catch (err) {
      console.error(`❌ [Q-AUDIT-IDX] findingToIndexEntry threw on findingId=${f.findingId}:`, err);
    }
  }
  console.log(`✅ [Q-AUDIT-IDX] returning ${out.length} entries`);
  return out;
}

export async function findAuditsByRecordId(orgId: OrgId, recordId: string): Promise<AuditDoneIndexEntry[]> {
  const findings = await listStored<FindingShape>("audit-finding", orgId, { limit: 5000 });
  const out: AuditDoneIndexEntry[] = [];
  for (const f of findings) {
    const rid = String((f.record ?? {} as Record<string, unknown>).RecordId ?? "");
    if (rid !== recordId) continue;
    const e = findingToIndexEntry(f);
    if (e) out.push(e);
  }
  return out.sort((a, b) => b.completedAt - a.completedAt);
}

export async function deleteAuditDoneIndexEntry(orgId: OrgId, findingId: string, completedAt: number): Promise<void> {
  await deleteStored("audit-done-idx", orgId, padTs(completedAt), findingId);
}

// ── Chargeback Entries ───────────────────────────────────────────────────────

export async function saveChargebackEntry(orgId: OrgId, entry: ChargebackEntry): Promise<void> {
  await setStored("chargeback-entry", orgId, [entry.findingId], entry);
}

export async function deleteChargebackEntry(orgId: OrgId, findingId: string): Promise<void> {
  await deleteStored("chargeback-entry", orgId, findingId);
}

export async function getChargebackEntry(orgId: OrgId, findingId: string): Promise<ChargebackEntry | null> {
  return await getStored<ChargebackEntry>("chargeback-entry", orgId, findingId);
}

export async function getChargebackEntries(orgId: OrgId, since: number, until: number): Promise<ChargebackEntry[]> {
  const all = await listStored<ChargebackEntry>("chargeback-entry", orgId);
  return all.filter((e) => e.ts >= since && e.ts <= until);
}

// ── Wire Deduction Entries ───────────────────────────────────────────────────

export async function saveWireDeductionEntry(orgId: OrgId, entry: WireDeductionEntry): Promise<void> {
  await setStored("wire-deduction-entry", orgId, [entry.findingId], entry);
}

export async function deleteWireDeductionEntry(orgId: OrgId, findingId: string): Promise<void> {
  await deleteStored("wire-deduction-entry", orgId, findingId);
}

export async function getWireDeductionEntry(orgId: OrgId, findingId: string): Promise<WireDeductionEntry | null> {
  return await getStored<WireDeductionEntry>("wire-deduction-entry", orgId, findingId);
}

export async function getWireDeductionEntries(orgId: OrgId, since: number, until: number): Promise<WireDeductionEntry[]> {
  const all = await listStored<WireDeductionEntry>("wire-deduction-entry", orgId);
  return all.filter((e) => e.ts >= since && e.ts <= until);
}

// ── Stuck Findings (watchdog) ────────────────────────────────────────────────

export async function getStuckFindings(thresholdMs = 15 * 60 * 1000): Promise<Array<{ orgId: string; findingId: string; step: string; ts: number; ageMs: number }>> {
  const now = Date.now();
  const stuck: Array<{ orgId: string; findingId: string; step: string; ts: number; ageMs: number }> = [];
  // Watchdog-active uses GLOBAL ("") as org. List all docs of that type.
  const rows = await listStoredByIdPrefix<{ orgId: string; findingId: string; step: string; ts: number }>("watchdog-active__");
  for (const { value } of rows) {
    if (!value?.ts) continue;
    const ageMs = now - value.ts;
    if (ageMs > thresholdMs) stuck.push({ ...value, ageMs });
  }
  return stuck;
}

// ── Pipeline Stats Aggregation ───────────────────────────────────────────────

export async function getStats(orgId: OrgId): Promise<{
  active: Record<string, unknown>[];
  completedCount: number;
  errors: Record<string, unknown>[];
  retries: Record<string, unknown>[];
  completedTs: number[];
  errorsTs: number[];
  retriesTs: number[];
}> {
  const now = Date.now();
  const cutoff = now - DAY_MS;

  const activeRows = await listStoredWithKeys<Record<string, unknown>>("active-tracking", orgId);
  const active: Record<string, unknown>[] = activeRows.map(({ key, value }) => ({
    ...value,
    findingId: (value.findingId as string) || String(key[key.length - 1]),
  }));

  const completed = await listStored<Record<string, unknown>>("completed-audit-stat", orgId);
  const completedCount = completed.length;
  const completedTs: number[] = [];
  for (const v of completed) {
    const ts = Number(v?.ts ?? 0);
    if (ts >= cutoff) completedTs.push(ts);
  }

  const errors = await listStored<Record<string, unknown>>("error-tracking", orgId);
  const errorsTs: number[] = [];
  for (const v of errors) {
    const ts = Number(v?.ts ?? 0);
    if (ts >= cutoff) errorsTs.push(ts);
  }

  const retries = await listStored<Record<string, unknown>>("retry-tracking", orgId);
  const retriesTs: number[] = [];
  for (const v of retries) {
    const ts = Number(v?.ts ?? 0);
    if (ts >= cutoff) retriesTs.push(ts);
  }

  return { active, completedCount, errors, retries, completedTs, errorsTs, retriesTs };
}
