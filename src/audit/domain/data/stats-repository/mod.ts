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

/** Single source of truth for the QB record id we index a finding under.
 *  ALWAYS the QuickBase RecordId (the value the operator types into "Find by
 *  QB Record"). Falls back to a top-level `recordId` if some future caller
 *  sets one. Returned as a string so the index key matches the string the
 *  search form submits. Historically several writers derived this differently
 *  (notably review-finalize used RelatedDestinationId/GenieNumber), which made
 *  review-completed findings invisible to record search — route every writer
 *  through here so they agree. */
export function deriveQbRecordId(finding: Record<string, any> | null | undefined): string | undefined {
  return String((finding as any)?.record?.RecordId ?? (finding as any)?.recordId ?? "") || undefined;
}

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

export async function trackCompleted(
  orgId: OrgId,
  findingId: string,
  meta?: Record<string, unknown>,
  opts?: { assumeFinished?: boolean },
): Promise<void> {
  await deleteStored("active-tracking", orgId, findingId);
  await deleteStored("watchdog-active", GLOBAL, findingId);
  // Refuse to record a completed-stat row if the finding isn't actually
  // finished — defense against trackCompleted being called from a path that
  // wrote the row before step-finalize set the terminal status. The dashboard
  // "Recently Completed" panel reads completed-audit-stat, and a stale row
  // here is the exact symptom that surfaced the retry-doesn't-drain bug.
  //
  // assumeFinished: the caller has authoritatively set findingStatus="finished"
  // on the in-memory finding it just saved. Skip the re-read — a cross-isolate
  // read-after-write lag showing the pre-finished status would otherwise drop
  // this row silently, leaving the finding absent from completed-audit-stat
  // (and thus from record search) even though it finished cleanly.
  if (!opts?.assumeFinished) {
    const finding = await getFinding(orgId, findingId);
    if (finding && finding.findingStatus !== "finished") {
      console.warn(`⚠️ [TRACK-COMPLETED] ${findingId}: skipped — findingStatus=${finding.findingStatus} (expected "finished")`);
      return;
    }
  }
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

// Errors persist longer than the 24h dashboard window so the daily canary
// endpoint can read "yesterday" when queried mid-next-day (plus a week of
// history). The dashboard's Recent Errors table still filters to 24h itself.
const ERROR_RETENTION_MS = 8 * DAY_MS;

export interface ErrorRecord { findingId: string; step: string; error: string; ts: number; recovered?: boolean; }

export async function trackError(orgId: OrgId, findingId: string, step: string, error: string): Promise<void> {
  await setStored("error-tracking", orgId, [`${Date.now()}-${findingId}`], { findingId, step, error, ts: Date.now() }, { expireInMs: ERROR_RETENTION_MS });
}

/** True if a finding that recorded an error ultimately reached a terminal,
 *  non-fault end state — "finished" (delivered its audit) or "terminated"
 *  (deliberately stopped). Anything else (still in-progress, or the finding
 *  can't be read) is treated as an UNrecovered fault. Fail-safe: on a read
 *  error we return false so a real problem is surfaced, never silently hidden.
 *
 *  Used to tell a transient blip that self-healed (e.g. an init-step Firestore
 *  abort that the watchdog/QStash retry re-drove to completion) apart from a
 *  genuinely stuck audit, so the daily canary report only fails on the latter. */
export async function isFindingRecovered(orgId: OrgId, findingId: string): Promise<boolean> {
  try {
    const finding = await getFinding(orgId, findingId);
    const status = String(finding?.findingStatus ?? "");
    return status === "finished" || status === "terminated";
  } catch {
    return false;
  }
}

/** Read error-tracking rows whose ts is in [from, to), excluding hidden
 *  findings, sorted ascending by ts. Read-all + filter (errors are low-volume),
 *  matching getStats's error read.
 *
 *  With `opts.includeRecovery`, each row is tagged `recovered` via
 *  isFindingRecovered (one getFinding per DISTINCT errored finding — bounded by
 *  error volume). Opt-in so existing callers (e.g. the dashboard) pay nothing. */
export async function getErrorsInWindow(
  orgId: OrgId, from: number, to: number, opts?: { includeRecovery?: boolean },
): Promise<ErrorRecord[]> {
  const hidden = await getHiddenFindingIds(orgId);
  const rows = await listStored<Record<string, unknown>>("error-tracking", orgId);
  const out: ErrorRecord[] = [];
  for (const v of rows) {
    const findingId = String(v?.findingId ?? "");
    if (findingId && hidden.has(findingId)) continue;
    const ts = Number(v?.ts ?? 0);
    if (ts >= from && ts < to) {
      out.push({ findingId, step: String(v?.step ?? ""), error: String(v?.error ?? ""), ts });
    }
  }
  out.sort((a, b) => a.ts - b.ts);
  if (opts?.includeRecovery) {
    const recoveredById = new Map<string, boolean>();
    for (const r of out) {
      if (!recoveredById.has(r.findingId)) {
        recoveredById.set(r.findingId, await isFindingRecovered(orgId, r.findingId));
      }
      r.recovered = recoveredById.get(r.findingId);
    }
  }
  return out;
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
  // Guard against writing while the finding is mid-rebuild. If a retry put
  // the finding back into populating-questions, we don't want to "update"
  // a completed-audit-stat row that's about to be regenerated from scratch.
  const finding = await getFinding(orgId, findingId);
  if (finding && finding.findingStatus !== "finished") {
    console.warn(`⚠️ [UPDATE-STAT-SCORE] ${findingId}: skipped — findingStatus=${finding.findingStatus} (expected "finished")`);
    return;
  }
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

/** Writes the secondary index row record search + audit-history read from.
 *  Returns true if the row was written, false if the status guard skipped it —
 *  callers should not log "written" on a false return.
 *
 *  opts.assumeFinished: the caller just set findingStatus="finished" on the
 *  finding it saved. Skip the re-read so a cross-isolate read-after-write lag
 *  can't silently drop the row (the exact failure that made completed findings
 *  invisible to "Find by QB Record"). */
export async function writeAuditDoneIndex(
  orgId: OrgId,
  entry: AuditDoneIndexEntry,
  opts?: { assumeFinished?: boolean },
): Promise<boolean> {
  // Same guard as updateCompletedStatScore: if the finding isn't actually
  // finished right now, refuse the index write. Catches future callers that
  // forget to gate on status and prevents stale "Recently Completed" rows
  // for findings that are mid-rebuild.
  if (!opts?.assumeFinished) {
    const finding = await getFinding(orgId, entry.findingId);
    if (finding && finding.findingStatus !== "finished") {
      console.warn(`⚠️ [WRITE-DONE-IDX] ${entry.findingId}: skipped — findingStatus=${finding.findingStatus} (expected "finished")`);
      return false;
    }
  }
  await setStored("audit-done-idx", orgId, [padTs(entry.completedAt), entry.findingId], entry);
  return true;
}

/** Deterministically (re)write the record-search index rows for a finished
 *  finding straight from the finding document. The escape hatch for findings
 *  the search self-heal can't reach — i.e. a finding absent from BOTH
 *  audit-done-idx and completed-audit-stat (a write the finished-status guard
 *  silently dropped). The operator on the report page has the findingId, so a
 *  findingId-keyed repair can fix what a recordId-only search cannot locate.
 *  Re-asserts both rows under the correct QB RecordId. Returns what it did. */
export async function repairRecordIndexForFinding(
  orgId: OrgId,
  findingId: string,
): Promise<{ repaired: boolean; recordId?: string; reason?: string }> {
  const finding = await getFinding(orgId, findingId);
  if (!finding) return { repaired: false, reason: "finding-not-found" };
  if (finding.findingStatus !== "finished") {
    return { repaired: false, reason: `findingStatus=${finding.findingStatus}` };
  }
  const recordId = deriveQbRecordId(finding);
  if (!recordId) return { repaired: false, reason: "no-record-id" };

  const completedAt = (finding.completedAt as number | undefined) ?? Date.now();
  const isPackage = finding.recordingIdField === "GenieNumber";
  const rec = (finding.record as Record<string, any>) ?? {};
  const rawVo = String(rec.VoName ?? "");
  const voName = (rawVo.includes(" - ") ? rawVo.split(" - ").slice(1).join(" - ").trim() : rawVo.trim()) || undefined;
  const department = String(isPackage ? (rec.OfficeName ?? "") : (rec.ActivatingOffice ?? "")) || undefined;
  const shift = isPackage ? undefined : String(rec.Shift ?? "") || undefined;
  const qs = finding.answeredQuestions as Array<{ answer?: string }> | undefined;
  const score = typeof finding.reviewScore === "number"
    ? finding.reviewScore
    : (qs?.length ? Math.round((qs.filter((q) => q.answer === "Yes").length / qs.length) * 100) : 0);
  const meta = {
    recordId, isPackage, voName, owner: finding.owner, department, shift,
    startedAt: finding.startedAt as number | undefined,
    durationMs: finding.startedAt ? completedAt - (finding.startedAt as number) : undefined,
    score,
  };

  await trackCompleted(orgId, findingId, meta, { assumeFinished: true });
  await writeAuditDoneIndex(orgId, {
    findingId, completedAt, score, completed: true,
    recordId, isPackage, voName, owner: finding.owner as string | undefined, department, shift,
    startedAt: finding.startedAt as number | undefined,
    durationMs: meta.durationMs,
  }, { assumeFinished: true });
  console.log(`🔧 [REPAIR-RECORD-IDX] ${findingId}: re-asserted index rows under recordId=${recordId} score=${score}%`);
  return { repaired: true, recordId };
}

/** Read-only diagnostic: dump everything the record search depends on for one
 *  finding so we can see WHY a search misses it — whether its index rows are
 *  absent, present under a different recordId, or stored as a non-string type.
 *  Scans both indexes for the findingId (no window/hidden/recordId filter). */
export async function inspectRecordIndex(orgId: OrgId, findingId: string): Promise<{
  findingId: string;
  finding: { found: boolean; findingStatus?: string; derivedRecordId?: string; recordIdField?: string; relatedDestinationId?: string; genieNumber?: string };
  hidden: boolean;
  doneIdxRows: Array<{ recordId: unknown; recordIdType: string; completedAt: number; score?: number }>;
  completedStatRows: Array<{ recordId: unknown; recordIdType: string; ts: number; score?: number }>;
}> {
  const finding = await getFinding(orgId, findingId);
  const rec = (finding?.record as Record<string, any>) ?? {};
  const hidden = (await getHiddenFindingIds(orgId)).has(findingId);

  // Paged (uncapped) scans — plain listStored caps at ~1000 rows and would
  // falsely report "no rows" for a finding whose row sits past the cap.
  const now = Date.now();
  const doneIdx = await listStoredByCompletedAt<AuditDoneIndexEntry>(
    "audit-done-idx", orgId, 0, now, { limit: Number.MAX_SAFE_INTEGER, fieldName: "completedAt" },
  );
  const doneIdxRows = doneIdx
    .filter((e) => e.findingId === findingId)
    .map((e) => ({ recordId: e.recordId, recordIdType: typeof e.recordId, completedAt: e.completedAt, score: e.score }));

  const stats = await listStoredByCompletedAt<Record<string, unknown>>(
    "completed-audit-stat", orgId, 0, now, { limit: Number.MAX_SAFE_INTEGER, fieldName: "ts" },
  );
  const completedStatRows = stats
    .filter((s) => s.findingId === findingId)
    .map((s) => ({ recordId: s.recordId, recordIdType: typeof s.recordId, ts: Number(s.ts ?? 0), score: s.score as number | undefined }));

  return {
    findingId,
    finding: {
      found: !!finding,
      findingStatus: finding?.findingStatus,
      derivedRecordId: deriveQbRecordId(finding),
      recordIdField: rec.RecordId != null ? String(rec.RecordId) : undefined,
      relatedDestinationId: rec.RelatedDestinationId != null ? String(rec.RelatedDestinationId) : undefined,
      genieNumber: rec.GenieNumber != null ? String(rec.GenieNumber) : undefined,
    },
    hidden,
    doneIdxRows,
    completedStatRows,
  };
}

/** Surgically restore ONE finding that was wrongly soft-hidden as a duplicate:
 *  un-hide it and re-assert its index rows so it shows in record search again.
 *  Per-finding (operator-confirmed) — deliberately NOT a bulk sweep, because
 *  "sole audit for record" is an unreliable false-positive signal at scale
 *  (a legit loser can look sole when its reviewed keeper was mis-keyed under
 *  RelatedDestinationId). The operator restores specific findings they've
 *  confirmed aren't duplicates. */
export async function restoreHiddenFinding(
  orgId: OrgId,
  findingId: string,
): Promise<{ ok: boolean; wasHidden: boolean; recordId?: string; reason?: string }> {
  const wasHidden = (await getHiddenFindingIds(orgId)).has(findingId);
  await unmarkFindingHidden(orgId, findingId);
  const repair = await repairRecordIndexForFinding(orgId, findingId);
  console.log(`🔧 [RESTORE-FINDING] ${findingId}: wasHidden=${wasHidden} reindexed=${repair.repaired} recordId=${repair.recordId ?? "?"}`);
  return { ok: true, wasHidden, recordId: repair.recordId, reason: repair.repaired ? undefined : repair.reason };
}

// SWR cache for queryAuditDoneIndex. Each cold call scans audit-done-idx
// for the (from,to) window — a paginated FS read that wedges 25s under
// HTTP/2 pool contention. Without this cache, every caller paid the full
// scan every time: audit-history dashboard polls every 5s, bulk-flip
// pulls, and any future caller. With this cache, ONE caller pays the
// scan and the rest hit memory until TTL expires. Stale-while-revalidate
// means even after TTL expiry the user sees stale data instantly while a
// background refresh runs — wedge-resilient.
//
// Previously this cache lived in DashboardController._cachedQueryAuditDoneIndex
// but was private + only used by /admin/audits/data, so /admin/unreviewed-audits
// (bulk-flip) bypassed it and paid the full scan every time. Moving the
// cache to the repository function means every caller benefits transparently.
//
// Key: orgId + (from,to). TTL: 30s. Concurrent identical calls share one
// in-flight promise via _qIdxPending — prevents thundering herd.
const _qIdxCache = new Map<string, { value: AuditDoneIndexEntry[]; expiresAt: number }>();
const _qIdxPending = new Map<string, Promise<AuditDoneIndexEntry[]>>();
const Q_IDX_TTL_MS = 30_000;

/** Test-only: clear the cache. Without this tests that share an isolate
 *  would observe values populated by a prior test, breaking test isolation. */
export function _resetQueryAuditDoneIndexCacheForTests(): void {
  _qIdxCache.clear();
  _qIdxPending.clear();
}

export async function queryAuditDoneIndex(orgId: OrgId, from: number, to: number): Promise<AuditDoneIndexEntry[]> {
  const key = `${orgId}:${from}:${to}`;
  const now = Date.now();
  const cached = _qIdxCache.get(key);
  if (cached && cached.expiresAt > now) {
    console.log(`🟢 [Q-IDX-CACHE] hit key=${key} (${cached.value.length} rows)`);
    return cached.value;
  }

  // In-flight dedup: if a scan is already running for this key, await it
  // instead of starting a second one.
  let pending = _qIdxPending.get(key);
  if (!pending) {
    pending = (async () => {
      const cold = !cached;
      console.log(`${cold ? "🔴" : "🟡"} [Q-IDX-CACHE] ${cold ? "miss" : "stale"} key=${key} ${cold ? "running scan" : "serving stale + refresh-in-bg"}`);
      try {
        const result = await withTiming(`queryAuditDoneIndex from=${from} to=${to}`, () => _queryAuditDoneIndexRaw(orgId, from, to));
        _qIdxCache.set(key, { value: result, expiresAt: Date.now() + Q_IDX_TTL_MS });
        return result;
      } catch (err) {
        // If we have any cached value (even stale-by-hours), serve it instead
        // of throwing. Wedge-resilience: bulk-flip + audit-history keep
        // working through a transient FS outage as long as ONE successful
        // scan landed previously this isolate.
        if (cached) {
          console.warn(`⚠️ [Q-IDX-CACHE] scan failed, serving stale cache key=${key}:`, err);
          return cached.value;
        }
        throw err;
      } finally {
        _qIdxPending.delete(key);
      }
    })();
    _qIdxPending.set(key, pending);
  }

  // Stale-while-revalidate: have a stale entry → serve it NOW, let the
  // background refresh complete. Next call within TTL hits the new value.
  if (cached) return cached.value;
  return pending;
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

/** Scan audit-done-idx (primary) then completed-audit-stat (fallback) over a
 *  [since, now] window for rows matching `recordId`. recordId comparisons are
 *  string-normalized so a legacy number-typed value still matches the string
 *  the search form submits. Fallback hits are lazily backfilled into
 *  audit-done-idx so the next search resolves on the fast primary path. */
async function _scanRecordWindow(
  orgId: OrgId,
  recordId: string,
  hidden: Set<string>,
  since: number,
  now: number,
): Promise<AuditDoneIndexEntry[]> {
  const target = String(recordId);
  // Unlike the dashboard/report list views, this is an EXPLICIT single-record
  // lookup — do NOT drop dedup-hidden findings, surface them flagged so the
  // operator sees every audit for the record they're investigating.
  const idx = await listStoredByCompletedAt<AuditDoneIndexEntry>(
    "audit-done-idx", orgId, since, now,
    { limit: Number.MAX_SAFE_INTEGER, fieldName: "completedAt" },
  );
  const out: AuditDoneIndexEntry[] = [];
  for (const e of idx) {
    if (String(e.recordId ?? "") !== target) continue;
    out.push({ ...e, hidden: hidden.has(e.findingId) });
  }
  console.log(`🔍 [FIND-BY-RECORD] audit-done-idx primary count=${out.length} (scanned ${idx.length})`);

  // Fallback: completed-audit-stat (post-migration, audit-done-idx may be sparse
  // for old orgs, or a row was lost to the finished-status write guard).
  if (out.length === 0) {
    const stats = await listStoredByCompletedAt<CompletedStatRow>(
      "completed-audit-stat", orgId, since, now,
      { limit: Number.MAX_SAFE_INTEGER, fieldName: "ts" },
    );
    let fallbackCount = 0;
    for (const s of stats) {
      if (String(s.recordId ?? "") !== target) continue;
      fallbackCount++;
      const entry: AuditDoneIndexEntry = {
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
      };
      out.push({ ...entry, hidden: hidden.has(s.findingId) });
      // Self-heal: the finding completed (it's in completed-audit-stat) but has
      // no audit-done-idx row under this recordId. Re-assert one (clean entry,
      // without the transient hidden flag) so the next search hits the primary
      // path. Best-effort; the result is returned regardless. assumeFinished
      // because a completed-audit-stat row only exists for a finished finding.
      writeAuditDoneIndex(orgId, entry, { assumeFinished: true }).catch((err) =>
        console.warn(`⚠️ [FIND-BY-RECORD] ${s.findingId}: self-heal done-idx write failed:`, err)
      );
    }
    console.log(`🔍 [FIND-BY-RECORD] completed-audit-stat fallback count=${fallbackCount} (scanned ${stats.length})`);
  }
  return out;
}

async function _findAuditsByRecordIdRaw(orgId: OrgId, recordId: string): Promise<AuditDoneIndexEntry[]> {
  console.log(`🔍 [FIND-BY-RECORD] orgId=${orgId} recordId=${recordId} starting`);
  // Page via the (_type, _org, completedAt)-indexed scan. Primary window is
  // 90d — keeps the hot path to ~12k rows / hundreds of ms. On a miss we widen
  // to 365d once so an older (or just-outside-90d) record still resolves before
  // we report "no audits"; operators needing older still have audit-history.
  const now = Date.now();
  const hidden = await getHiddenFindingIds(orgId);

  let out = await _scanRecordWindow(orgId, recordId, hidden, now - 90 * DAY_MS, now);
  if (out.length === 0) {
    console.log(`🔍 [FIND-BY-RECORD] 90d empty — widening to 365d for recordId=${recordId}`);
    out = await _scanRecordWindow(orgId, recordId, hidden, now - 365 * DAY_MS, now);
  }

  console.log(`🔍 [FIND-BY-RECORD] total=${out.length}`);
  return out.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
}

export async function deleteAuditDoneIndexEntry(orgId: OrgId, findingId: string, completedAt: number): Promise<void> {
  await deleteStored("audit-done-idx", orgId, padTs(completedAt), findingId);
}

/** Delete every audit-done-idx entry for a findingId without needing its
 *  completedAt. Scans the index — O(N) — so prefer the keyed variant when
 *  the caller already has the timestamp. Used by the retry-drain path
 *  where we don't trust the previous run's timestamp. */
export async function deleteAuditDoneIdxByFindingId(orgId: OrgId, findingId: string): Promise<number> {
  const rows = await listStoredWithKeys<AuditDoneIndexEntry>("audit-done-idx", orgId);
  let removed = 0;
  for (const { key, value } of rows) {
    if (value?.findingId === findingId) {
      await deleteStored("audit-done-idx", orgId, ...key);
      removed++;
    }
  }
  return removed;
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
