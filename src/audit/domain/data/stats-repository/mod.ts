/** Stats repository — pipeline tracking, audit-done-idx, chargeback/wire entries.
 *  Firestore-backed via setStored* helpers. */

import {
  getStored, setStored, deleteStored, listStored, listStoredWithKeys, listStoredWithKeysAll, listStoredKeysAll, listStoredByIdPrefix, listStoredByCompletedAt, withTiming,
} from "@core/data/firestore/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";
import type { AuditDoneIndexEntry, ChargebackEntry, WireDeductionEntry, AppealRecord } from "@core/dto/types.ts";
import { getFinding, saveFinding } from "@audit/domain/data/audit-repository/mod.ts";

const DAY_MS = 86_400_000;

/** How fresh an `active-tracking` row must be to count as "running now" on the
 *  admin dashboard's Active panel. Purely a DISPLAY filter. */
export const ACTIVE_DISPLAY_STALE_MS = 5 * 60 * 1000;

/** How old an `active-tracking` row must be before the dashboard read is
 *  allowed to DELETE it. Must stay comfortably larger than the watchdog's
 *  STUCK_THRESHOLD_MS (and than its hourly tick) — the watchdog recovers stuck
 *  findings by reading these rows, so reaping one early makes the finding
 *  permanently unrecoverable. Six hours ≈ six watchdog attempts before the
 *  evidence is discarded, which also bounds re-publish loops on a finding that
 *  can never succeed. Enforced by a unit test against the watchdog constant. */
export const ACTIVE_REAP_MS = 6 * 60 * 60 * 1000;

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

/** The index/stat dimension fields that EVERY completed-audit writer derives
 *  identically from the finding doc. Extracted (like [[deriveQbRecordId]]) so
 *  step-finalize, postJudgedAudit, the review-queue flip writers, and the
 *  repair path can't silently drift in how they parse voName/department/shift.
 *  NOTE: score, completedAt, completed, reason, and durationMs are deliberately
 *  NOT here — each path resolves score/timing with its own semantics (finalize's
 *  auto-complete logic vs judge's finalScore vs review's reviewScore), so the
 *  caller supplies those explicitly. */
export interface IndexMeta {
  recordId?: string;
  recordingId?: string;
  isPackage: boolean;
  voName?: string;
  owner?: string;
  department?: string;
  shift?: string;
  startedAt?: number;
  wgs?: boolean;
  mcc?: boolean;
  /** QuickBase "Related Employee2" (fid 143) — the numeric employee record
   *  behind VoName. The ONLY unambiguous person key: names collide (two
   *  Mariah Browns, one ODR one WST) and so do emails (both Mariahs share
   *  mariahb@; one address is listed on ten separate employee records).
   *  Empty string = looked and QuickBase had none. Undefined = this row
   *  predates the field — audits finalized before it was pulled, which need
   *  a QuickBase-backed backfill, not a finding re-read. */
  employeeId?: string;
}

/** WGS/MCC sale flags from the finding record. Date-legs: QB field 460
 *  ("Total WGS") and 594 ("Total MCC") — hold a dollar amount (e.g. "169") or
 *  "yes" when sold, empty/"0"/"no" when not. Packages: field 345 is the MCC
 *  flag; WGS doesn't exist on packages. (The review queue's VerdictPanel uses
 *  this amount semantic; the report page's old `=== "yes"` check misread
 *  amount-valued records as not-sold.) */
export function saleFlagsFromFinding(finding: Record<string, any> | null | undefined): { wgs: boolean; mcc: boolean } {
  const rec = ((finding as any)?.record as Record<string, any>) ?? {};
  const isPackage = (finding as any)?.recordingIdField === "GenieNumber";
  const sold = (v: unknown): boolean => {
    const s = String(v ?? "").trim().toLowerCase();
    return s !== "" && s !== "0" && s !== "no" && s !== "false";
  };
  return isPackage
    ? { wgs: false, mcc: sold(rec["345"]) }
    : { wgs: sold(rec["460"]), mcc: sold(rec["594"]) };
}

export function buildIndexMeta(finding: Record<string, any> | null | undefined): IndexMeta {
  const rec = ((finding as any)?.record as Record<string, any>) ?? {};
  const isPackage = (finding as any)?.recordingIdField === "GenieNumber";
  const rawVo = String(rec.VoName ?? "");
  const voName = (rawVo.includes(" - ") ? rawVo.split(" - ").slice(1).join(" - ").trim() : rawVo.trim()) || undefined;
  return {
    recordId: deriveQbRecordId(finding),
    // Genie recording #. Previously omitted, so review/judge index rows had a
    // blank recordingId — which is why recording-keyed reads/grouping couldn't
    // match a reviewed finding to its original audit row.
    recordingId: String((finding as any)?.recordingId ?? "") || undefined,
    isPackage,
    voName,
    owner: (finding as any)?.owner as string | undefined,
    department: String(isPackage ? (rec.OfficeName ?? "") : (rec.ActivatingOffice ?? "")) || undefined,
    shift: isPackage ? undefined : String(rec.Shift ?? "") || undefined,
    startedAt: (finding as any)?.startedAt as number | undefined,
    // Left undefined (not "") when the record has no RelatedEmployeeId at all,
    // so a backfill can tell "audited before we pulled fid 143" apart from
    // "QuickBase genuinely has no employee on this record".
    employeeId: rec.RelatedEmployeeId != null ? String(rec.RelatedEmployeeId) : undefined,
    ...saleFlagsFromFinding(finding),
  };
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
  // Paged (uncapped) scan — plain listStoredWithKeys caps at 1000 rows, and
  // this set only ever grows. Once prod passed 1000 hidden findings the cap
  // silently un-hid every one past the limit: dedup losers, retired duplicates
  // and re-audit losers all reappeared in reports, dashboards and the failed-
  // audit lists, looking like unreviewed sub-100% audits nobody could action.
  // Measured 2026-08-07: 4095 audit-hidden docs, 1000 loaded — ~3000 ghosts.
  //
  // KEYS-ONLY on purpose. markFindingHidden is the sole writer and always keys
  // by [findingId], so the body carries nothing this Set needs. select:__name__
  // holds the response near ~100 bytes/row, which keeps an uncapped scan
  // CHEAPER per row than the capped body scan it replaces — this runs on
  // report/dashboard/queue paths behind a 30s cache, so payload size here is
  // what protects the Firestore stream pool from the wedge described on
  // listStoredKeysAll.
  const rows = await listStoredKeysAll("audit-hidden", orgId);
  const ids = new Set<string>();
  for (const { key } of rows) {
    if (typeof key[0] === "string" && key[0]) ids.add(key[0]);
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
  // TTL matches ACTIVE_REAP_MS so the cross-org backup the watchdog reads
  // stays alive exactly as long as the primary `active-tracking` row does.
  // At the old 2h it expired while the primary was still recoverable.
  await setStored("watchdog-active", GLOBAL, [findingId], { orgId, findingId, step, ts: Date.now() }, { expireInMs: ACTIVE_REAP_MS });
}

/** Mark a handler invocation as finished WITHOUT marking the whole audit as
 *  complete. Removes the active-tracking row so the dashboard's "Active"
 *  panel reflects only currently-executing handlers (capped by QStash
 *  parallelism), not "audits anywhere in the pipeline". The audit-level
 *  lifecycle is tracked separately by trackCompleted/terminateFinding. */
export async function untrackHandler(orgId: OrgId, findingId: string): Promise<void> {
  await deleteStored("active-tracking", orgId, findingId);
}

/** Clear BOTH tracking rows for a finding. The watchdog reads `active-tracking`
 *  AND the `watchdog-active` backup, so clearing only the first would let a
 *  finished/terminated finding resurface from the backup on every hourly tick
 *  until its TTL expired. Used by the watchdog's stale-row cleanup; the normal
 *  pipeline exit path goes through trackCompleted, which already clears both. */
export async function untrackForWatchdog(orgId: OrgId, findingId: string): Promise<void> {
  await deleteStored("active-tracking", orgId, findingId);
  await deleteStored("watchdog-active", GLOBAL, findingId);
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

/** Scrub secrets from an error string before it lands in the canary store.
 *  That store is persisted (8-day TTL) and broadly readable (CANARY_SECRET-gated)
 *  and re-emitted verbatim by /canary/errors — but Deno `fetch` failures read
 *  `error sending request for url (https://…?token=…)`, so a signed/temporary
 *  recording URL can ride along. Strip URL query strings and bearer/JWT-ish
 *  tokens. Full detail still goes to the console.* lines; only the persisted
 *  copy is redacted. Centralized here so every trackError caller is covered. */
export function redactErrorMessage(msg: string): string {
  return msg
    .replace(/(https?:\/\/[^\s?#)]+)\?[^\s#)]*/g, "$1?<redacted>")
    .replace(/(https?:\/\/)[^@\s/]+@/g, "$1<redacted>@")
    .replace(/\b(bearer\s+)[A-Za-z0-9._\-]+/gi, "$1<redacted>")
    .replace(/\beyJ[A-Za-z0-9._\-]{10,}/g, "<redacted-jwt>");
}

/** Read-path dedup identity for an error row: finding + step + ts. NOTE: the
 *  trackError write key is a *different* string (it leads with ts for
 *  time-sortable Firestore doc keys) — they encode the same tuple but must not
 *  be assumed to share a format. */
export function errorIdentity(r: { findingId: string; step: string; ts: number }): string {
  return `${r.findingId}|${r.step}|${r.ts}`;
}

export async function trackError(orgId: OrgId, findingId: string, step: string, error: string): Promise<void> {
  // Key on ts + finding + step so two distinct same-finding failures (e.g. genie
  // primary vs secondary) that land in the same millisecond don't overwrite each
  // other. The read path (canary-errors) dedups via errorIdentity() on the same
  // tuple. One Date.now() for both the key prefix and the stored ts so they can
  // never skew. (Key leads with ts for time-sortable doc keys — see errorIdentity.)
  const now = Date.now();
  await setStored(
    "error-tracking", orgId, [`${now}-${findingId}-${step}`],
    { findingId, step, error: redactErrorMessage(error), ts: now },
    { expireInMs: ERROR_RETENTION_MS },
  );
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

/** Like [[trackError]] but DEDUPED to one row per finding + step + UTC-day, via
 *  a deterministic day-bucketed key. For a permanently-failing, repeatedly-
 *  re-driven step — e.g. a dead Genie recording that step-init re-attempts every
 *  10 min up to MAX_GENIE_RETRIES, plus hourly watchdog re-drives — this turns
 *  ~8 dashboard rows into one per finding+step+day instead of one per re-drive.
 *
 *  Why a deterministic key instead of [[trackError]]'s Date.now()-keyed rows +
 *  a read-then-write dedup check: concurrent re-drives idempotently collide on
 *  the SAME doc (last-write-wins) rather than racing a check-then-write that
 *  could let both writers through, and there's no O(rows) listStored scan in the
 *  hot retry path. last-write-wins keeps `ts`/`error` reflecting the most recent
 *  attempt, so the row's "When" + 24h-window membership track the latest failure.
 *
 *  Read paths are unaffected: every consumer (getErrorsInWindow, _getStatsRaw,
 *  clearErrors) reads the row VALUES (findingId/step/ts/error), never the key. */
export async function trackErrorOnce(orgId: OrgId, findingId: string, step: string, error: string): Promise<void> {
  const now = Date.now();
  const dayBucket = Math.floor(now / DAY_MS);
  await setStored(
    "error-tracking", orgId, [`${findingId}-${step}-day${dayBucket}`],
    { findingId, step, error: redactErrorMessage(error), ts: now },
    { expireInMs: ERROR_RETENTION_MS },
  );
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
  // Stamp the live appeal state onto the row so reports can filter by appeal
  // status without hydrating the appeal doc at send time. Recomputed on every
  // (re)write — completion / review / judge / flip / file-appeal all re-call
  // this — so it never goes stale. A genuine "no appeal" (read OK → null) → "none";
  // a transient read FAILURE preserves whatever the row already had rather than
  // silently downgrading a pending/complete appeal to "none".
  let appealStatus = entry.appealStatus;
  try {
    const appeal = await getStored<AppealRecord>("appeal", orgId, entry.findingId);
    appealStatus = !appeal ? "none" : appeal.status === "pending" ? "pending" : "complete";
  } catch (err) {
    console.warn(`⚠️ [WRITE-DONE-IDX] ${entry.findingId}: appeal read failed — keeping appealStatus=${appealStatus ?? "unknown"}:`, err);
  }
  const toWrite = appealStatus !== undefined ? { ...entry, appealStatus } : { ...entry };
  await setStored("audit-done-idx", orgId, [padTs(entry.completedAt), entry.findingId], toWrite);
  return true;
}

/** Lazily backfill WGS/MCC sale flags onto audit-done-idx entries that predate
 *  them, at most `max` findings per call — bounded, so a read path can never
 *  trigger unbounded hydration (that pattern has crashed prod before). Mutates
 *  the passed entries in place (so the caller's SWR-cached array converges
 *  too) AND persists each patched row under its own [padTs, findingId] key.
 *  Entries whose finding is gone get {wgs:false, mcc:false} to stop re-tries;
 *  transient errors leave the entry untouched for the next call. */
export async function backfillSaleFlags(orgId: OrgId, entries: AuditDoneIndexEntry[], max = 20): Promise<number> {
  const stale = entries.filter((e) => e.wgs === undefined && e.findingId).slice(0, max);
  if (stale.length === 0) return 0;
  // One finding read per unique findingId (dup index rows share the fetch).
  const findings = new Map<string, Promise<Record<string, any> | null>>();
  for (const e of stale) {
    if (!findings.has(e.findingId)) findings.set(e.findingId, getFinding(orgId, e.findingId));
  }
  await Promise.all(stale.map(async (entry) => {
    try {
      const finding = await findings.get(entry.findingId)!;
      const flags = finding ? saleFlagsFromFinding(finding) : { wgs: false, mcc: false };
      Object.assign(entry, flags);
      await setStored("audit-done-idx", orgId, [padTs(entry.completedAt), entry.findingId], { ...entry });
    } catch { /* transient — retried on a later call */ }
  }));
  return stale.length;
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
  const meta = buildIndexMeta(finding);
  if (!meta.recordId) return { repaired: false, reason: "no-record-id" };

  const completedAt = (finding.completedAt as number | undefined) ?? Date.now();
  const durationMs = meta.startedAt ? completedAt - meta.startedAt : undefined;
  const qs = finding.answeredQuestions as Array<{ answer?: string }> | undefined;
  const score = typeof finding.reviewScore === "number"
    ? finding.reviewScore
    : (qs?.length ? Math.round((qs.filter((q) => q.answer === "Yes").length / qs.length) * 100) : 0);

  // completed-audit-stat keys embed Date.now(), so trackCompleted is NOT
  // idempotent on findingId — calling it when a row already exists appends a
  // duplicate (double-counts in "Recently Completed" + aggregates). Only write
  // if the finding has no stat row. A paged scan, NOT deleteCompletedStat,
  // because the latter caps at 1000 rows and misses recent rows on a large org.
  const statRows = await listStoredByCompletedAt<{ findingId?: string }>(
    "completed-audit-stat", orgId, 0, Date.now(), { limit: Number.MAX_SAFE_INTEGER, fieldName: "ts" },
  );
  if (!statRows.some((s) => s.findingId === findingId)) {
    await trackCompleted(orgId, findingId, { ...meta, durationMs, score }, { assumeFinished: true });
  }
  // audit-done-idx is keyed [padTs(completedAt), findingId] → re-writing is
  // idempotent (overwrites the same doc), so this is always safe to re-assert.
  await writeAuditDoneIndex(orgId, {
    findingId, completedAt, score, completed: true, durationMs, ...meta,
  }, { assumeFinished: true });
  console.log(`🔧 [REPAIR-RECORD-IDX] ${findingId}: re-asserted index rows under recordId=${meta.recordId} score=${score}%`);
  return { repaired: true, recordId: meta.recordId };
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
 *  where we don't trust the previous run's timestamp.
 *
 *  The scan MUST be the uncapped/paged one. Plain listStoredWithKeys stops at
 *  1000 rows; against an index of 80k+ that silently matched nothing and the
 *  function returned 0 while every row survived. */
export async function deleteAuditDoneIdxByFindingId(orgId: OrgId, findingId: string): Promise<number> {
  const rows = await listStoredWithKeysAll<AuditDoneIndexEntry>("audit-done-idx", orgId);
  let removed = 0;
  for (const { key, value } of rows) {
    if (value?.findingId === findingId) {
      await deleteStored("audit-done-idx", orgId, ...key);
      removed++;
    }
  }
  return removed;
}

/** Epoch-ms from a timestamp field that may be stored either way. Findings are
 *  NOT consistent here: reviewer-finalize writes `reviewedAt` as a ms number,
 *  the two admin pencil-flip paths write it as an ISO string. A bare
 *  `Number(isoString)` is NaN, which silently (a) keyed the flip's row at
 *  completedAt instead of review time and (b) made the sibling cleanup below
 *  skip the reviewer's row — leaving one finding with two rows at two
 *  different scores, so audit-history disagreed with the report. Parse both. */
function toEpochMs(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : Date.parse(v);
  }
  return NaN;
}

/** Where this finding's index row was last written. The row key embeds a
 *  MUTABLE timestamp (`reviewedAt`), so a second review action moves the key
 *  and orphans the previous row — and the old key is not recoverable from the
 *  finding, which now only carries the NEW reviewedAt. This pointer is that
 *  missing breadcrumb: one tiny doc per finding, read+written alongside the
 *  row, so the writer can always point-delete exactly where it last wrote. */
const DONE_IDX_KEY_PTR = "audit-done-idx-key";

/** Write a finding's audit-done-idx row AND guarantee it is the ONLY row for
 *  that finding. Canonical key = `reviewedAt ?? completedAt`: a reviewed
 *  finding indexes at its review time (reviewer-throughput buckets on that),
 *  everything else at audit-completion time. Every OTHER row for the finding is
 *  point-deleted — the sibling at the other timestamp, plus wherever the last
 *  write left one (see DONE_IDX_KEY_PTR) — so a finding can never accumulate
 *  rows at two scores. Use in every post-completion writer (review / judge /
 *  flips) instead of bare writeAuditDoneIndex.
 *
 *  Pass the finding doc reflecting the post-action state (e.g. the corrected
 *  finding with reviewedAt set) so the canonical timestamp resolves correctly.
 *
 *  `completed` is OPTIONAL and omitting it INHERITS the existing row's value.
 *  A writer that only knows the score (judge overturn, admin pencil-flip) must
 *  omit it rather than derive `score === 100`: deriving downgrades an already-
 *  finalized audit to completed:false, which silently drops it from every
 *  weekly report (email-report-engine filters on `e.completed && e.doneAt`). */
export async function writeSoleAuditDoneIndex(
  orgId: OrgId,
  finding: Record<string, any> | null | undefined,
  entry: Omit<AuditDoneIndexEntry, "completedAt" | "completed"> & { completed?: boolean },
  opts?: { assumeFinished?: boolean },
): Promise<boolean> {
  const completedAt = toEpochMs(finding?.completedAt);
  const reviewedAt = toEpochMs(finding?.reviewedAt);
  const canonicalTs = Number.isFinite(reviewedAt) ? reviewedAt
    : Number.isFinite(completedAt) ? completedAt
    : NaN;
  if (!Number.isFinite(canonicalTs)) {
    // Malformed finding (no finite completedAt/reviewedAt): don't mint an
    // arbitrary wall-clock key — that would create an orphan row in a random
    // time bucket that the sibling-cleanup can't pair and collapse can't reunite.
    // Surface the data defect and skip; callers treat this write as best-effort.
    console.warn(`[DONE-IDX] ${entry.findingId}: no finite completedAt/reviewedAt — skipping sole-index write (malformed finding)`);
    return false;
  }
  // Merge over any existing row so fields the new writer omits survive —
  // notably reviewedBy/reviewHandleMs when a JUDGE or FLIP overwrites a
  // previously-reviewed finding's row (those entries carry the new score but
  // not the reviewer attribution), and `completed` on an audit a human already
  // finalized.
  //
  // The canonical key alone is NOT enough. Callers stamp a fresh
  // `reviewedAt` on the finding immediately before calling us (see
  // adminFlipQuestion), which moves the canonical key — so the row we are
  // merging over sits at the PREVIOUS timestamp, not this one. Reading only
  // the new key found nothing, `completed` fell back to false, and a
  // pencil-flip on a reviewed audit quietly dropped it out of every weekly
  // report (those filter on `e.completed && e.doneAt`) while audit history
  // still showed it REVIEWED. Fall back to where the last write actually put
  // the row (the key pointer), then to the finding's completedAt.
  const lastKey = await getStored<{ ts: number }>(DONE_IDX_KEY_PTR, orgId, entry.findingId).catch(() => null);
  const readAt = async (ts: number | undefined) =>
    ts != null && Number.isFinite(ts)
      ? await getStored<AuditDoneIndexEntry>("audit-done-idx", orgId, padTs(ts), entry.findingId).catch(() => null)
      : null;
  const existing = await readAt(canonicalTs)
    ?? await readAt(lastKey?.ts)
    ?? await readAt(completedAt);
  const wrote = await writeAuditDoneIndex(
    orgId,
    {
      ...(existing ?? {}),
      ...entry,
      completedAt: canonicalTs,
      // Spelled out rather than left to the spread so an explicit
      // `completed: undefined` can't punch a hole in the inherited value.
      completed: entry.completed ?? existing?.completed ?? false,
    } as AuditDoneIndexEntry,
    opts,
  );
  // Only prune once the new row is actually down — a skipped write (status
  // guard) must not leave the finding with no row at all.
  if (!wrote) return wrote;
  // Every place a row for this finding could be: the two timestamps the finding
  // still carries, plus wherever the previous write put one.
  await pruneStaleDoneIdxRows(orgId, entry.findingId, canonicalTs, [completedAt, reviewedAt, lastKey?.ts]);
  return wrote;
}

/** Delete every audit-done-idx row for `findingId` that is NOT at `canonicalTs`,
 *  then stamp the key pointer at `canonicalTs`.
 *
 *  A row's key embeds a timestamp, so "the same finding, written again under a
 *  different timestamp" silently becomes a SECOND row rather than an overwrite.
 *  Candidate keys come from two places: whatever timestamps the caller still
 *  knows about (passed in), and the pointer — the only record of where the
 *  LAST write landed once the finding's own timestamps have moved on.
 *
 *  Best-effort by design: a failed delete leaves a duplicate for the dedup
 *  sweep to collect, which is strictly better than failing the caller's write. */
export async function pruneStaleDoneIdxRows(
  orgId: OrgId,
  findingId: string,
  canonicalTs: number,
  candidates: Array<number | undefined> = [],
): Promise<void> {
  const pointer = await getStored<{ ts: number }>(DONE_IDX_KEY_PTR, orgId, findingId).catch(() => null);
  for (const ts of new Set([...candidates, pointer?.ts])) {
    if (typeof ts === "number" && Number.isFinite(ts) && ts !== canonicalTs) {
      await deleteAuditDoneIndexEntry(orgId, findingId, ts).catch((e) =>
        console.warn(`[DONE-IDX] ${findingId}: stale row cleanup failed (non-fatal): ${(e as Error).message}`));
    }
  }
  await setStored(DONE_IDX_KEY_PTR, orgId, [findingId], { ts: canonicalTs }).catch((e) =>
    console.warn(`[DONE-IDX] ${findingId}: key-pointer write failed (non-fatal): ${(e as Error).message}`));
}

/** Delete a finding's audit-done-idx row(s) by KEY, using the same candidate
 *  timestamps pruneStaleDoneIdxRows uses: whatever the finding still carries
 *  plus the pointer recording where the last write landed. Also clears the
 *  pointer, since the finding is being removed from the index entirely.
 *
 *  This exists because the obvious implementation — scan the index for rows
 *  with this findingId — needs the UNCAPPED scan, and a re-audit is not the
 *  place to walk 80k rows. Callers that hold the finding doc already know
 *  every key its row could be under, so no scan is needed at all.
 *
 *  Returns how many keys were deleted. Best-effort per key. */
export async function deleteDoneIdxRowsForFinding(
  orgId: OrgId,
  findingId: string,
  finding: Record<string, any> | null | undefined,
): Promise<number> {
  const pointer = await getStored<{ ts: number }>(DONE_IDX_KEY_PTR, orgId, findingId).catch(() => null);
  const candidates = new Set<number>();
  for (const ts of [toEpochMs(finding?.completedAt), toEpochMs(finding?.reviewedAt), pointer?.ts]) {
    if (typeof ts === "number" && Number.isFinite(ts)) candidates.add(ts);
  }
  let deleted = 0;
  for (const ts of candidates) {
    try {
      await deleteAuditDoneIndexEntry(orgId, findingId, ts);
      deleted++;
    } catch (e) {
      console.warn(`[DONE-IDX] ${findingId}: row delete at ts=${ts} failed (non-fatal): ${(e as Error).message}`);
    }
  }
  await deleteStored(DONE_IDX_KEY_PTR, orgId, findingId).catch(() => {});
  return deleted;
}

/** Stamp email sent/opened onto a finding's audit-done-idx row so the audit
 *  tables can render an "Email Opened" column for free.
 *
 *  Point write, no scan: the row's timestamp comes from the key pointer this
 *  module already maintains (DONE_IDX_KEY_PTR), so this is two gets and one set
 *  regardless of index size. Called from the email send + open-pixel paths,
 *  which are low-frequency — NOT from any render path.
 *
 *  Fields merge over the existing row and never clear it: a second open must
 *  not wipe emailSentAt, and re-stamping is idempotent because both fields are
 *  first-write-wins upstream. Best-effort by design — losing an open marker is
 *  a cosmetic column, never a reason to fail a send or a pixel request. */
export async function stampEmailOnDoneIdx(
  orgId: OrgId,
  findingId: string,
  patch: { emailSentAt?: number; emailOpenedAt?: number },
  opts: { at?: number } = {},
): Promise<boolean> {
  try {
    // Candidate row timestamps, cheapest and most certain first. The key
    // pointer alone is NOT enough: it is only written by writeSoleAuditDoneIndex
    // (review / judge / flip / appeal), so rows finalized straight through
    // step-finalize have none — measured 2026-08-10, 100% of rows under a week
    // old had a pointer and 0% of older ones did. Depending on it silently
    // skipped ~7k of 8.7k rows in the first backfill.
    const candidates: number[] = [];
    const push = (v: unknown) => {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0 && !candidates.includes(n)) candidates.push(n);
    };
    // Caller-supplied (a backfill already holds the row and its completedAt).
    push(opts.at);
    const pointer = await getStored<{ ts: number }>(DONE_IDX_KEY_PTR, orgId, findingId).catch(() => null);
    push(pointer?.ts);

    for (const ts of candidates) {
      const existing = await getStored<AuditDoneIndexEntry>("audit-done-idx", orgId, padTs(ts), findingId).catch(() => null);
      if (!existing) continue;
      const merged: AuditDoneIndexEntry = {
        ...existing,
        ...(patch.emailSentAt != null && existing.emailSentAt == null ? { emailSentAt: patch.emailSentAt } : {}),
        ...(patch.emailOpenedAt != null && existing.emailOpenedAt == null ? { emailOpenedAt: patch.emailOpenedAt } : {}),
      };
      await setStored("audit-done-idx", orgId, [padTs(ts), findingId], merged);
      return true;
    }

    // Last resort — the live open path has no timestamp in hand and the finding
    // is the only place left to learn it. One extra read, on a route that fires
    // once per email open, never on a render path.
    const finding = await getFinding(orgId, findingId).catch(() => null);
    if (!finding) return false;
    const fromFinding: number[] = [];
    for (const v of [(finding as any).reviewedAt, (finding as any).completedAt]) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0 && !candidates.includes(n)) fromFinding.push(n);
    }
    for (const ts of fromFinding) {
      const existing = await getStored<AuditDoneIndexEntry>("audit-done-idx", orgId, padTs(ts), findingId).catch(() => null);
      if (!existing) continue;
      const merged: AuditDoneIndexEntry = {
        ...existing,
        ...(patch.emailSentAt != null && existing.emailSentAt == null ? { emailSentAt: patch.emailSentAt } : {}),
        ...(patch.emailOpenedAt != null && existing.emailOpenedAt == null ? { emailOpenedAt: patch.emailOpenedAt } : {}),
      };
      await setStored("audit-done-idx", orgId, [padTs(ts), findingId], merged);
      return true;
    }
    return false;
  } catch (err) {
    console.warn(`⚠️ [DONE-IDX] ${findingId}: email stamp failed (non-fatal):`, err);
    return false;
  }
}

/** Among multiple audit-done-idx rows for ONE finding, pick the index of the
 *  row to KEEP, per the operator's rule: the reviewed/judged row wins, else the
 *  most recent (by doneAt, then completedAt). */
export function pickCanonicalIndexRow(rows: AuditDoneIndexEntry[]): number {
  let best = 0;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i], b = rows[best];
    const aReviewed = a.reason === "reviewed" || !!a.reviewedBy;
    const bReviewed = b.reason === "reviewed" || !!b.reviewedBy;
    if (aReviewed !== bReviewed) { if (aReviewed) best = i; continue; }
    // Same reviewed status (incl. two reviewed rows): newest doneAt/completedAt
    // wins. Strict `>` means an exact-timestamp tie keeps `best` unchanged, so
    // the earliest-scanned row (lowest index in the ascending completedAt scan)
    // is kept — deterministic, just tied to scan order.
    const aTs = a.doneAt ?? a.completedAt ?? 0;
    const bTs = b.doneAt ?? b.completedAt ?? 0;
    if (aTs > bTs) best = i;
  }
  return best;
}

export interface CollapseResult {
  scanned: number;            // total index rows scanned in range
  findingsWithDupes: number;  // findings that had >1 row
  rowsKept: number;           // one keeper per duplicated finding
  staleRows: number;          // redundant rows found
  rowsDeleted: number;        // redundant rows actually removed (execute mode)
  failed: number;
  failedIds: string[];        // findingIds whose stale-row delete threw
}

/** Raw scan of audit-done-idx in [since, until], grouped by findingId. Single
 *  source of truth shared by collapseDuplicateIndexRows (the destructive run)
 *  and diagnoseDuplicates (the read-only preview) so the two can never drift —
 *  what Diagnose shows is exactly the set Execute acts on. Includes hidden rows
 *  (we only ever delete redundant extras, never touch hidden state). */
export async function scanAndGroupByFinding(
  orgId: OrgId,
  since: number,
  until: number,
): Promise<{ rows: AuditDoneIndexEntry[]; byFinding: Map<string, AuditDoneIndexEntry[]> }> {
  const rows = await listStoredByCompletedAt<AuditDoneIndexEntry>(
    "audit-done-idx", orgId, since, until,
    { limit: Number.MAX_SAFE_INTEGER, fieldName: "completedAt" },
  );
  const byFinding = new Map<string, AuditDoneIndexEntry[]>();
  for (const r of rows) {
    if (!r?.findingId) continue;
    const g = byFinding.get(r.findingId) ?? [];
    g.push(r);
    byFinding.set(r.findingId, g);
  }
  return { rows, byFinding };
}

/** Collapse duplicate audit-done-idx rows so each finding keeps exactly ONE row
 *  (the reviewed/judged one, else the newest). Deletes only redundant rows by
 *  exact key — NEVER hides a finding, so no audit data is lost. Dry-run by
 *  default (execute:false just counts). When the keeper lacks recordingId but a
 *  sibling carries it, the keeper is re-written with it backfilled. `deleteRow`
 *  is injectable so the failure path is testable.
 *
 *  Range note: a finding is only collapsible when BOTH of its rows fall in
 *  [since, until]; for a full sweep use a wide range. */
export async function collapseDuplicateIndexRows(
  orgId: OrgId,
  since: number,
  until: number,
  opts?: {
    execute?: boolean;
    onProgress?: (deleted: number, total: number) => void;
    deleteRow?: (orgId: OrgId, findingId: string, completedAt: number) => Promise<void>;
  },
): Promise<CollapseResult> {
  const execute = !!opts?.execute;
  const deleteRow = opts?.deleteRow ?? deleteAuditDoneIndexEntry;
  const { rows, byFinding } = await scanAndGroupByFinding(orgId, since, until);

  // Plan first (stable totals + accurate dry-run counts), then act.
  let findingsWithDupes = 0;
  const staleList: Array<{ findingId: string; completedAt: number }> = [];
  const backfills: Array<{ row: AuditDoneIndexEntry; recordingId: string }> = [];
  for (const [findingId, group] of byFinding) {
    if (group.length <= 1) continue;
    findingsWithDupes++;
    const keepIdx = pickCanonicalIndexRow(group);
    const keeper = group[keepIdx];
    group.forEach((r, i) => { if (i !== keepIdx) staleList.push({ findingId, completedAt: r.completedAt }); });
    if (!keeper.recordingId) {
      const sib = group.find((r, i) => i !== keepIdx && !!r.recordingId);
      if (sib?.recordingId) backfills.push({ row: keeper, recordingId: sib.recordingId });
    }
  }
  const staleRows = staleList.length;

  let rowsDeleted = 0;
  const failedIds: string[] = [];
  if (execute) {
    for (const b of backfills) {
      await setStored("audit-done-idx", orgId, [padTs(b.row.completedAt), b.row.findingId], { ...b.row, recordingId: b.recordingId })
        .catch((e) => console.warn(`[DEDUP-ROWS] ${b.row.findingId}: recordingId backfill failed (non-fatal): ${(e as Error).message}`));
    }
    for (const s of staleList) {
      try {
        await deleteRow(orgId, s.findingId, s.completedAt);
        rowsDeleted++;
        opts?.onProgress?.(rowsDeleted, staleRows);
      } catch (err) {
        failedIds.push(s.findingId);
        console.warn(`[DEDUP-ROWS] ⚠️ delete failed for ${s.findingId}@${s.completedAt}: ${(err as Error).message}`);
      }
      // Small gap between writes — reliable under Firestore load.
      await new Promise((res) => setTimeout(res, 50));
    }
  }

  console.log(`[DEDUP-ROWS] org=${orgId} scanned=${rows.length} findingsWithDupes=${findingsWithDupes} staleRows=${staleRows} deleted=${rowsDeleted} failed=${failedIds.length} execute=${execute}`);
  return {
    scanned: rows.length,
    findingsWithDupes,
    rowsKept: findingsWithDupes,
    staleRows,
    rowsDeleted,
    failed: failedIds.length,
    failedIds,
  };
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
  // Server-side date range on `ts`, NOT a full-store scan.
  //
  // This used to read every chargeback-entry the org had ever written and filter
  // the window in memory. That was the fix for an older bug (plain listStored
  // truncates at 1000, which silently emptied the reports once the store grew
  // past the cap) — but it traded truncation for unbounded growth. At ~15k docs
  // the weekly Sheets cron was killed mid-scan on 2026-08-18: it claimed the
  // week, died 29s in, and posted nothing. `ts` is a top-level field on these
  // docs, so the same field-range query audit-done-idx already uses applies
  // here. Measured on prod for one week: 541 entries either way, 4.6s → 0.23s.
  //
  // Uncapped limit so the range still cannot truncate — the paged reader walks
  // every page in the window. The `ts` bounds are re-checked below because the
  // range is the query's contract, not its guarantee.
  const rows = await listStoredByCompletedAt<ChargebackEntry>(
    "chargeback-entry", orgId, since, until,
    { limit: Number.MAX_SAFE_INTEGER, fieldName: "ts" },
  );
  return rows.filter((e) => e && e.ts >= since && e.ts <= until && !hidden.has(e.findingId));
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
  // Server-side date range on `ts` — see getChargebackEntries. This store is
  // still small enough that the old full scan finished, but it grows the same
  // way and would fail the same way.
  const rows = await listStoredByCompletedAt<WireDeductionEntry>(
    "wire-deduction-entry", orgId, since, until,
    { limit: Number.MAX_SAFE_INTEGER, fieldName: "ts" },
  );
  return rows.filter((e) => e && e.ts >= since && e.ts <= until && !hidden.has(e.findingId));
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

// Return type mirrors _getStatsRaw exactly (incl. genuineErrors24h /
// recoveredErrors24h) so the public signature can't drift from what the
// implementation actually returns — the dashboard + smk tests read those
// 24h count fields.
export async function getStats(orgId: OrgId): Promise<Awaited<ReturnType<typeof _getStatsRaw>>> {
  return withTiming("getStats", () => _getStatsRaw(orgId));
}

async function _getStatsRaw(orgId: OrgId): Promise<{
  active: Record<string, unknown>[];
  completedCount: number;
  errors: Record<string, unknown>[];
  genuineErrors24h: number;
  recoveredErrors24h: number;
  retries: Record<string, unknown>[];
  completedTs: number[];
  errorsTs: number[];
  retriesTs: number[];
}> {
  const now = Date.now();
  const cutoff = now - DAY_MS;

  // Active = a row whose step has reported in within the last
  // ACTIVE_DISPLAY_STALE_MS. Anything older almost certainly crashed/timed out
  // without calling untrackActive, so it's not actually running on QStash
  // anymore and we hide it from the dashboard view.
  //
  // HIDING IS NOT DELETING. This read used to delete every row older than 5
  // minutes, which silently disarmed the watchdog: the watchdog only re-
  // publishes rows older than 30 minutes and only runs hourly, so the row it
  // needed was always swept 25+ minutes before it looked. A multi-genie audit
  // hung at "transcribing" for 4 days with zero recovery attempts and zero
  // WATCHDOG log lines (QqzfObJYP5aibL_YT6AHX, 2026-08-20) because of exactly
  // this. Rows now survive until ACTIVE_REAP_MS, which is deliberately several
  // watchdog ticks wide so every stuck finding gets multiple recovery attempts
  // before its evidence is thrown away.
  const activeRows = await listStoredWithKeys<Record<string, unknown>>("active-tracking", orgId);
  const active: Record<string, unknown>[] = [];
  const staleFindingIds: string[] = [];
  for (const { key, value } of activeRows) {
    const ts = Number(value?.ts ?? 0);
    const ageMs = ts > 0 ? now - ts : Number.POSITIVE_INFINITY;
    const findingId = (value?.findingId as string) || String(key[key.length - 1]);
    if (ageMs <= ACTIVE_DISPLAY_STALE_MS) {
      active.push({ ...value, findingId });
    } else if (ageMs > ACTIVE_REAP_MS) {
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

  // Tag every error row `recovered` (see isFindingRecovered) so the dashboard
  // can badge a caught-and-continue blip apart from a genuine fault, and derive
  // `genuineErrors24h` — the authoritative non-recovered, in-window fault count
  // for the headline card. (Don't make the card derive its count from the row
  // list: error-tracking has an 8-day TTL, so `errors` is NOT the 24h set.)
  // Dedup getFinding by findingId; error volume is low and getStats is behind a
  // 5s memo, so the per-finding read is cheap.
  const recoveredById = new Map<string, boolean>();
  let genuineErrors24h = 0;
  let recoveredErrors24h = 0;
  for (const v of errors) {
    const fid = String(v?.findingId ?? "");
    if (fid) {
      if (!recoveredById.has(fid)) recoveredById.set(fid, await isFindingRecovered(orgId, fid));
      v.recovered = recoveredById.get(fid);
    }
    // A blank-findingId row can't be classified (recovered stays undefined) and
    // is deliberately counted as a genuine fault — fail-loud, so an
    // unattributable error never hides from the headline. In practice tracked
    // errors always carry a real findingId (trackError skips "<unknown>"), so
    // this is defensive. Both counts are window-matched (24h) for the card.
    if (Number(v?.ts ?? 0) >= cutoff) {
      if (v.recovered) recoveredErrors24h++;
      else genuineErrors24h++;
    }
  }

  const retriesRaw = await listStored<Record<string, unknown>>("retry-tracking", orgId);
  const retries = retriesRaw.filter((v) => !isHidden(v));
  const retriesTs: number[] = [];
  for (const v of retries) {
    const ts = Number(v?.ts ?? 0);
    if (ts >= cutoff) retriesTs.push(ts);
  }

  // The "Recent Errors (24h)" dashboard table feed: only GENUINE faults from the
  // last 24h — i.e. errors that actually broke a run. The full `errors` set above
  // (8-day TTL, includes recovered/self-healed blips) still drives the recovered
  // tagging + the genuineErrors24h/recoveredErrors24h headline counts and
  // errorsTs (the activity chart, which wants all error activity). Only the
  // displayed table is narrowed, so old rows age out on the 24h boundary and a
  // finished/terminated audit's transient blip never reads as a failure.
  // NOTE: DashboardTables ALSO re-filters `!recovered` defensively — both layers
  // are intentional; don't "simplify" either away (the frontend can't see this
  // backend filter, and this can't see callers that bypass the dashboard feed).
  const displayErrors = errors.filter((v) => Number(v?.ts ?? 0) >= cutoff && !v.recovered);

  return { active, completedCount, errors: displayErrors, genuineErrors24h, recoveredErrors24h, retries, completedTs, errorsTs, retriesTs };
}
