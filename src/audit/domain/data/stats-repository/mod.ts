/** Stats repository — pipeline tracking, audit-done-idx, chargeback/wire entries.
 *  Firestore-backed via setStored* helpers. */

import {
  getStored, setStored, deleteStored, listStored, listStoredWithKeys, listStoredByIdPrefix, listStoredByCompletedAt, withTiming,
} from "@core/data/firestore/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";
import type { AuditDoneIndexEntry, ChargebackEntry, WireDeductionEntry } from "@core/dto/types.ts";
import { getFinding, saveFinding } from "@audit/domain/data/audit-repository/mod.ts";

const DAY_MS = 86_400_000;

function padTs(ts: number): string { return String(ts).padStart(15, "0"); }

// Watchdog-active is org-agnostic (one global namespace). Use empty-string org.
const GLOBAL = "" as OrgId;

// ── Audit Hidden (soft-hide marker) ──────────────────────────────────────────
// Per-finding marker that read paths should treat the finding as hidden.
// Used by dedup instead of physical deletion — one tiny write per finding,
// reversible via unmarkFindingHidden, and cheap to filter against on reads.

export interface AuditHiddenEntry {
  findingId: string;
  hiddenAt: number;
  hiddenBy: string;
  reason: "duplicate";
}

export async function markFindingHidden(
  orgId: OrgId,
  findingId: string,
  hiddenBy: string,
  reason: "duplicate" = "duplicate",
): Promise<void> {
  await setStored("audit-hidden", orgId, [findingId], {
    findingId, hiddenAt: Date.now(), hiddenBy, reason,
  });
}

export async function unmarkFindingHidden(orgId: OrgId, findingId: string): Promise<void> {
  await deleteStored("audit-hidden", orgId, findingId);
}

// Per-isolate cache so the Set is loaded once and reused across the many
// filter sites. 30s TTL — cross-isolate writes propagate within one cache
// cycle. Background refresh promise NEVER rejects (catch internally) to
// avoid the unhandled-rejection isolate-crash mode.
const _hiddenCache = new Map<string, { ids: Set<string>; expiresAt: number }>();
const _hiddenRefreshing = new Set<string>();
const HIDDEN_TTL_MS = 30 * 1000;

async function loadHiddenIds(orgId: OrgId): Promise<Set<string>> {
  const rows = await listStoredWithKeys<{ findingId?: string }>("audit-hidden", orgId);
  const ids = new Set<string>();
  for (const { key, value } of rows) {
    const fid = (typeof key[0] === "string" ? key[0] : undefined) ?? value?.findingId;
    if (fid) ids.add(String(fid));
  }
  return ids;
}

function refreshHiddenInBackground(orgId: OrgId): void {
  if (_hiddenRefreshing.has(orgId)) return;
  _hiddenRefreshing.add(orgId);
  loadHiddenIds(orgId)
    .then((ids) => {
      _hiddenCache.set(orgId, { ids, expiresAt: Date.now() + HIDDEN_TTL_MS });
    })
    .catch((err) => {
      console.warn(`⚠️ [HIDDEN] background refresh failed org=${orgId}: ${(err as Error).message}`);
    })
    .finally(() => {
      _hiddenRefreshing.delete(orgId);
    });
}

export async function getHiddenFindingIds(orgId: OrgId): Promise<Set<string>> {
  const now = Date.now();
  const cached = _hiddenCache.get(orgId);
  if (cached && cached.expiresAt > now) {
    // SWR: serve cached, refresh in background if past 50% TTL
    if (cached.expiresAt - now < HIDDEN_TTL_MS / 2) refreshHiddenInBackground(orgId);
    return cached.ids;
  }
  // Cold load — block.
  const ids = await loadHiddenIds(orgId);
  _hiddenCache.set(orgId, { ids, expiresAt: now + HIDDEN_TTL_MS });
  return ids;
}

/** Test-only — clear the per-isolate hidden cache. resetFirestoreCredentials()
 *  wipes the in-mem store but not this cache; tests that depend on freshness
 *  call this at the top of each step. */
export function _resetHiddenCacheForTesting(): void {
  _hiddenCache.clear();
  _hiddenRefreshing.clear();
}

// ── Active Tracking ──────────────────────────────────────────────────────────

export async function trackActive(orgId: OrgId, findingId: string, step: string, meta?: Record<string, unknown>): Promise<void> {
  const existing = (await getStored<Record<string, unknown>>("active-tracking", orgId, findingId)) ?? {};
  await setStored("active-tracking", orgId, [findingId], { ...existing, findingId, step, ts: Date.now(), ...(meta ?? {}) });
  await setStored("watchdog-active", GLOBAL, [findingId], { orgId, findingId, step, ts: Date.now() }, { expireInMs: 2 * 60 * 60 * 1000 });
}

/** Mark a handler invocation as finished WITHOUT marking the whole audit as
 *  complete. Removes the active-tracking row so the dashboard's "Active"
 *  panel reflects only currently-executing handlers (capped by QStash
 *  parallelism), not "audits anywhere in the pipeline". The audit-level
 *  lifecycle is tracked separately by trackCompleted/terminateFinding. */
export async function untrackHandler(orgId: OrgId, findingId: string): Promise<void> {
  await deleteStored("active-tracking", orgId, findingId);
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
  return withTiming(`getRecentCompleted limit=${limit}`, () => _getRecentCompletedRaw(orgId, limit));
}

async function _getRecentCompletedRaw(orgId: OrgId, limit: number): Promise<Record<string, unknown>[]> {
  const now = Date.now();
  const cutoff = now - DAY_MS;
  // Over-fetch and post-filter hidden findings so the dashboard "Recent
  // Completed" list reflects what the operator can actually act on. Dedup
  // soft-hide leaves the completed-audit-stat rows in place, so without
  // this filter duplicates we already pruned still appear.
  const rows = await listStoredByCompletedAt<Record<string, unknown>>(
    "completed-audit-stat", orgId, cutoff, now,
    { limit: limit * 4, fieldName: "ts" },
  );
  const hidden = await getHiddenFindingIds(orgId);
  const out: Record<string, unknown>[] = [];
  for (const row of rows) {
    const fid = String(row.findingId ?? "");
    if (fid && hidden.has(fid)) continue;
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
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

export async function writeAuditDoneIndex(orgId: OrgId, entry: AuditDoneIndexEntry): Promise<void> {
  await setStored("audit-done-idx", orgId, [padTs(entry.completedAt), entry.findingId], entry);
}

export async function queryAuditDoneIndex(orgId: OrgId, from: number, to: number): Promise<AuditDoneIndexEntry[]> {
  return withTiming(`queryAuditDoneIndex from=${from} to=${to}`, () => _queryAuditDoneIndexRaw(orgId, from, to));
}

async function _queryAuditDoneIndexRaw(orgId: OrgId, from: number, to: number): Promise<AuditDoneIndexEntry[]> {
  console.log(`[AUDIT-HISTORY] [Q-IDX] start orgId=${orgId} from=${from} to=${to}`);
  let entries: AuditDoneIndexEntry[];
  try {
    entries = await listStoredByCompletedAt<AuditDoneIndexEntry>(
      "audit-done-idx", orgId, from, to,
      { limit: Number.MAX_SAFE_INTEGER, fieldName: "completedAt" },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[AUDIT-HISTORY] [Q-IDX] ❌ listStoredByCompletedAt threw: ${msg}`);
    throw err;
  }
  console.log(`[AUDIT-HISTORY] [Q-IDX] got ${entries.length} audit-done-idx rows from Firestore`);
  const hidden = await getHiddenFindingIds(orgId);
  const visible = entries.filter((e) => !hidden.has(e.findingId));
  console.log(`[AUDIT-HISTORY] [Q-IDX] ${entries.length} rows, ${visible.length} after hidden filter`);
  return visible;
}

// SWR cache for findAuditsByRecordId. Each call previously scanned up to
// 51k+ audit-done-idx rows over a 365-day window — single-digit seconds
// minimum, blows 60s under FS lag. Operators tend to repeat the same
// record-id lookups (debugging a specific guest's audit history), so a
// 60s SWR cache keyed by `${orgId}:${recordId}` gives near-instant
// repeat hits and amortizes the scan cost across burst usage.
const _findByRecordCache = new Map<string, { value: AuditDoneIndexEntry[]; expiresAt: number }>();
const _findByRecordPending = new Map<string, Promise<AuditDoneIndexEntry[]>>();
const FIND_BY_RECORD_TTL_MS = 60_000;

export async function findAuditsByRecordId(orgId: OrgId, recordId: string): Promise<AuditDoneIndexEntry[]> {
  const cacheKey = `${orgId}:${recordId}`;
  const now = Date.now();
  const cached = _findByRecordCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.value;
  const inflight = _findByRecordPending.get(cacheKey);
  if (inflight) return inflight;
  const promise = (async () => {
    try {
      const result = await withTiming(`findAuditsByRecordId ${recordId}`, () => _findAuditsByRecordIdRaw(orgId, recordId));
      _findByRecordCache.set(cacheKey, { value: result, expiresAt: Date.now() + FIND_BY_RECORD_TTL_MS });
      return result;
    } finally {
      _findByRecordPending.delete(cacheKey);
    }
  })();
  _findByRecordPending.set(cacheKey, promise);
  return promise;
}

async function _findAuditsByRecordIdRaw(orgId: OrgId, recordId: string): Promise<AuditDoneIndexEntry[]> {
  console.log(`🔍 [FIND-BY-RECORD] orgId=${orgId} recordId=${recordId} starting`);
  // Page via the (_type, _org, completedAt)-indexed scan. Window narrowed
  // from 365d → 90d: cuts scan size from 51k rows to ~12k on a hot org,
  // dropping query time from seconds-on-a-good-day to ~hundreds of ms.
  // Operators looking up records older than 90d should use the audit
  // history page directly (which takes an explicit date range).
  const now = Date.now();
  const since = now - 90 * DAY_MS;
  const hidden = await getHiddenFindingIds(orgId);

  const idx = await listStoredByCompletedAt<AuditDoneIndexEntry>(
    "audit-done-idx", orgId, since, now,
    { limit: Number.MAX_SAFE_INTEGER, fieldName: "completedAt" },
  );
  const out: AuditDoneIndexEntry[] = [];
  for (const e of idx) {
    if (hidden.has(e.findingId)) continue;
    if (e.recordId !== recordId) continue;
    out.push(e);
  }
  console.log(`🔍 [FIND-BY-RECORD] audit-done-idx primary count=${out.length} (scanned ${idx.length})`);

  // Fallback: completed-audit-stat (post-migration, audit-done-idx may be sparse
  // for old orgs). Same paged scan; merge matches into the AuditDoneIndexEntry shape.
  if (out.length === 0) {
    type CompletedStatRow = {
      findingId: string;
      ts: number;
      recordId?: string;
      score?: number;
      isPackage?: boolean;
      voName?: string;
      owner?: string;
      department?: string;
      shift?: string;
      startedAt?: number;
      durationMs?: number;
      reason?: string;
    };
    const stats = await listStoredByCompletedAt<CompletedStatRow>(
      "completed-audit-stat", orgId, since, now,
      { limit: Number.MAX_SAFE_INTEGER, fieldName: "ts" },
    );
    let fallbackCount = 0;
    for (const s of stats) {
      if (hidden.has(s.findingId)) continue;
      if (s.recordId !== recordId) continue;
      fallbackCount++;
      out.push({
        findingId: s.findingId,
        completedAt: s.ts,
        completed: true,
        reason: (s.reason as AuditDoneIndexEntry["reason"]) ?? undefined,
        score: typeof s.score === "number" ? s.score : 0,
        recordId: s.recordId,
        isPackage: s.isPackage,
        voName: s.voName,
        owner: s.owner,
        department: s.department,
        shift: s.shift,
        startedAt: s.startedAt,
        durationMs: s.durationMs,
      });
    }
    console.log(`🔍 [FIND-BY-RECORD] completed-audit-stat fallback count=${fallbackCount} (scanned ${stats.length})`);
  }

  console.log(`🔍 [FIND-BY-RECORD] total=${out.length}`);
  return out.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
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
  const hidden = await getHiddenFindingIds(orgId);
  const all = await listStored<ChargebackEntry>("chargeback-entry", orgId);
  return all.filter((e) => e.ts >= since && e.ts <= until && !hidden.has(e.findingId));
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
  const hidden = await getHiddenFindingIds(orgId);
  const all = await listStored<WireDeductionEntry>("wire-deduction-entry", orgId);
  return all.filter((e) => e.ts >= since && e.ts <= until && !hidden.has(e.findingId));
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
  return withTiming("getStats", () => _getStatsRaw(orgId));
}

async function _getStatsRaw(orgId: OrgId): Promise<{
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

  // Active = a row whose step has reported in within the last STALE_MS.
  // Anything older almost certainly crashed/timed out without calling
  // untrackActive, so it's not actually running on QStash anymore. We
  // filter stale rows out of the dashboard view AND fire-and-forget
  // delete them so they don't keep accumulating across reads.
  const STALE_MS = 5 * 60 * 1000;
  const activeRows = await listStoredWithKeys<Record<string, unknown>>("active-tracking", orgId);
  const active: Record<string, unknown>[] = [];
  const staleFindingIds: string[] = [];
  for (const { key, value } of activeRows) {
    const ts = Number(value?.ts ?? 0);
    const ageMs = ts > 0 ? now - ts : Number.POSITIVE_INFINITY;
    const findingId = (value?.findingId as string) || String(key[key.length - 1]);
    if (ageMs <= STALE_MS) {
      active.push({ ...value, findingId });
    } else {
      staleFindingIds.push(findingId);
    }
  }
  if (staleFindingIds.length > 0) {
    queueMicrotask(async () => {
      for (const fid of staleFindingIds) {
        try {
          await deleteStored("active-tracking", orgId, fid);
          await deleteStored("watchdog-active", GLOBAL, fid);
        } catch { /* best-effort */ }
      }
    });
  }

  // Pull the hidden set once and filter every count surface that
  // Operations actually looks at. Dedup soft-hide doesn't delete the
  // tracking rows, so without this the "Completed (24h)" / Errors /
  // Retries counters all double-count duplicates we already pruned.
  // `active-tracking` is the live in-pipeline set — by definition not
  // yet a candidate for dedup, so leave it unfiltered.
  const hidden = await getHiddenFindingIds(orgId);
  const isHidden = (v: unknown): boolean => {
    const fid = String((v as Record<string, unknown> | undefined)?.findingId ?? "");
    return !!fid && hidden.has(fid);
  };

  const completedAll = await listStoredByCompletedAt<{ ts?: number; findingId?: string }>(
    "completed-audit-stat", orgId, cutoff, now,
    { limit: Number.MAX_SAFE_INTEGER, fieldName: "ts" },
  );
  const completed = completedAll.filter((v) => !isHidden(v));
  const completedCount = completed.length;
  const completedTs: number[] = completed.map((v) => Number(v?.ts ?? 0));

  const errorsRaw = await listStored<Record<string, unknown>>("error-tracking", orgId);
  const errors = errorsRaw.filter((v) => !isHidden(v));
  const errorsTs: number[] = [];
  for (const v of errors) {
    const ts = Number(v?.ts ?? 0);
    if (ts >= cutoff) errorsTs.push(ts);
  }

  const retriesRaw = await listStored<Record<string, unknown>>("retry-tracking", orgId);
  const retries = retriesRaw.filter((v) => !isHidden(v));
  const retriesTs: number[] = [];
  for (const v of retries) {
    const ts = Number(v?.ts ?? 0);
    if (ts >= cutoff) retriesTs.push(ts);
  }

  return { active, completedCount, errors, retries, completedTs, errorsTs, retriesTs };
}
