/** Record-ID deduplication — retire duplicate AUDITS of the same QuickBase record.
 *
 *  Context: one QB record id = one booking = exactly one audit, forever. But
 *  audit creation has no idempotency, so a re-fired record spawns a second/third
 *  independent finding for the same booking. Each becomes its own review-queue
 *  item, reviewer credit, and chargeback/wire "payroll" row — the same call gets
 *  reviewed twice and pay gets doubled.
 *
 *  The existing Deduplicate tool (collapseDuplicateIndexRows) groups audit-done-idx
 *  rows by FINDING id and only collapses duplicate rows of ONE finding. This module
 *  is the second pass: it groups by RECORD id, picks the one finding to keep, and
 *  fully retires the losers.
 *
 *  Keeper priority over the FULL set of a record's findings:
 *    1. Scored 100% ON ENTRY (reason === "perfect_score", never reviewed) → wins.
 *    2. Else completed a review (reviewedBy set / reason === "reviewed") → wins.
 *    3. Else the latest-audited (max startedAt) → wins.
 *    Latest startedAt breaks any tie within a tier.
 *
 *  Eviction is "strip to inert, keep the raw audit": the loser is removed from
 *  every count, queue, stat, index, and — critically — the chargeback + wire
 *  payroll rows, and marked hidden(duplicate). The audit-finding body is KEPT as a
 *  recovery parachute (recoverable via restore-finding). This mirrors the re-audit
 *  soft-delete compose at reaudit/mod.ts:84-95, plus a lock release + hidden mark.
 *
 *  All keeper signals read straight off AuditDoneIndexEntry — no 200KB finding
 *  loads during the scan. Reviewer credit / XP / throughput need no undo: they are
 *  derived from the audit-done-idx row that gets removed.
 */
import type { OrgId } from "@core/data/deno-kv/mod.ts";
import { deleteStored, getStored, listStoredByCompletedAt, listStoredWithKeys } from "@core/data/firestore/mod.ts";
import type { AuditDoneIndexEntry } from "@core/dto/types.ts";
import { getHiddenFindingIds, markFindingHidden, pickCanonicalIndexRow } from "@audit/domain/data/stats-repository/mod.ts";
import { cleanupFindingFromIndices } from "@judge/domain/data/judge-repository/mod.ts";
import { decrementForFinding } from "@audit/domain/data/question-stats-repository/mod.ts";
import { deleteFailedFindingRows } from "@audit/domain/data/failed-finding-repository/mod.ts";
import { getFinding } from "@audit/domain/data/audit-repository/mod.ts";

// ── Keeper rule (pure) ───────────────────────────────────────────────────────

const isEntry100 = (m: AuditDoneIndexEntry) => m.reason === "perfect_score";
const isReviewed = (m: AuditDoneIndexEntry) => m.reason === "reviewed" || !!m.reviewedBy;
/** The stable AUDIT timestamp. completedAt/doneAt are re-keyed to the REVIEW
 *  time on reviewed rows, so only startedAt reflects when the audit ran. */
const auditTs = (m: AuditDoneIndexEntry) => m.startedAt ?? m.completedAt ?? 0;

/** Pick the index of the finding to KEEP among a record's canonical rows.
 *  entry-100 beats reviewed beats latest; latest startedAt breaks ties within a
 *  tier (strict `>` keeps the first on an exact tie — deterministic). Pure. */
export function pickRecordKeeper(
  members: AuditDoneIndexEntry[],
): { keeperIdx: number; reason: "entry_100" | "reviewed" | "latest" } {
  const latestOf = (idxs: number[]) => idxs.reduce((best, i) => (auditTs(members[i]) > auditTs(members[best]) ? i : best), idxs[0]);
  const idxs = members.map((_, i) => i);
  const tier100 = idxs.filter((i) => isEntry100(members[i]));
  if (tier100.length) return { keeperIdx: latestOf(tier100), reason: "entry_100" };
  const tierReviewed = idxs.filter((i) => isReviewed(members[i]));
  if (tierReviewed.length) return { keeperIdx: latestOf(tierReviewed), reason: "reviewed" };
  return { keeperIdx: latestOf(idxs), reason: "latest" };
}

/** Reduce a record's index rows to one canonical row per findingId (a finding
 *  may carry duplicate index rows — the OTHER dedup problem — so collapse those
 *  first via the shared pickCanonicalIndexRow before comparing findings). */
function canonicalByFinding(entries: AuditDoneIndexEntry[]): AuditDoneIndexEntry[] {
  const byFinding = new Map<string, AuditDoneIndexEntry[]>();
  for (const e of entries) {
    if (!e?.findingId) continue;
    const g = byFinding.get(e.findingId) ?? [];
    g.push(e);
    byFinding.set(e.findingId, g);
  }
  const out: AuditDoneIndexEntry[] = [];
  for (const [, rows] of byFinding) out.push(rows[pickCanonicalIndexRow(rows)]);
  return out;
}

// ── Plan / diagnose types ────────────────────────────────────────────────────

export interface RecordDedupMember {
  findingId: string;
  score: number;
  startedAt?: number;
  completedAt: number;
  reviewedBy?: string;
  reason?: string;
  keep: boolean;
}
export interface RecordDedupGroup {
  recordId: string;
  keeperId: string;
  keeperReason: "entry_100" | "reviewed" | "latest";
  members: RecordDedupMember[]; // keeper first
  appealSkipped: boolean;       // a member has a pending appeal — left untouched
}
export interface RecordDedupPlan {
  scannedRows: number;
  groups: RecordDedupGroup[];   // ALL groups (actionable + appeal-skipped)
  recordsWithDupes: number;     // actionable records (≥1 loser, not appeal-skipped)
  losers: number;               // total losers to evict
  appealSkips: number;
}
export interface RecordDedupDiagnosis {
  since: number;
  until: number;
  scannedRows: number;
  recordsWithDupes: number;
  losersToEvict: number;
  appealSkips: number;
  sampleTotal: number;
  sampleGroups: RecordDedupGroup[]; // top N by group size
}
export interface RecordEvictResult {
  scannedRows: number;
  recordsWithDupes: number;
  losers: number;
  evicted: number;
  chargebacksRemoved: number;
  wiresRemoved: number;
  appealSkips: number;
  failed: number;
  failedIds: string[];
}

function toMember(m: AuditDoneIndexEntry, keep: boolean): RecordDedupMember {
  return {
    findingId: m.findingId,
    score: m.score,
    startedAt: m.startedAt,
    completedAt: m.completedAt,
    reviewedBy: m.reviewedBy,
    reason: m.reason,
    keep,
  };
}

// ── Planner (shared by diagnose + execute so preview == action) ───────────────

/** Scan audit-done-idx over [since, until] ONCE, group every row by record id
 *  (a finding's rows all share its recordId), and for every record with >1
 *  finding in range pick the keeper + losers. Already-hidden findings (prior
 *  runs' losers) are excluded up front. Records with a pending appeal are
 *  surfaced but left untouched.
 *
 *  Single-scan by design: an earlier version re-resolved each candidate record
 *  via findAuditsByRecordId (a ~90-day scan PER record) and blew Deno Deploy's
 *  ~30s inline limit on real data. The keeper is chosen from the audits in the
 *  window, so — like the row pass — a record whose duplicates straddle the range
 *  is only partly seen; widen the range for a full sweep. Duplicates are created
 *  within minutes and reviewed within days, so any window covering the cluster
 *  captures them together.
 *
 *  Execute reuses this plan then evicts losers in the background lane (not inline),
 *  so the per-loser O(N) helper scans are not bound by the inline limit. */
export async function planDuplicateRecords(orgId: OrgId, since: number, until: number): Promise<RecordDedupPlan> {
  const rows = await listStoredByCompletedAt<AuditDoneIndexEntry>(
    "audit-done-idx",
    orgId,
    since,
    until,
    { limit: Number.MAX_SAFE_INTEGER, fieldName: "completedAt" },
  );
  const scannedRows = rows.length;

  // Exclude already-retired (hidden) findings so a re-run never re-evicts a
  // prior run's losers. One cheap cached read for the whole plan.
  const hidden = await getHiddenFindingIds(orgId);

  // Group EVERY scanned row by recordId in a single in-memory pass — no
  // per-record re-scan. A finding's rows all carry the same recordId, so
  // grouping then canonicalizing per finding yields the record's in-window set.
  const byRecord = new Map<string, AuditDoneIndexEntry[]>();
  for (const e of rows) {
    if (!e?.findingId || hidden.has(e.findingId)) continue;
    const rid = e.recordId ? String(e.recordId) : "";
    if (!rid) continue;
    const g = byRecord.get(rid) ?? [];
    g.push(e);
    byRecord.set(rid, g);
  }

  const groups: RecordDedupGroup[] = [];
  let losers = 0;
  let appealSkips = 0;

  for (const [rid, recRows] of byRecord) {
    const members = canonicalByFinding(recRows);
    if (members.length <= 1) continue; // only one audit for this record in range

    if (members.some((m) => m.appealStatus === "pending")) {
      appealSkips++;
      groups.push({
        recordId: rid,
        keeperId: "",
        keeperReason: "latest",
        members: members.map((m) => toMember(m, false)),
        appealSkipped: true,
      });
      continue;
    }

    const { keeperIdx, reason } = pickRecordKeeper(members);
    losers += members.length - 1;
    const memberViews = members
      .map((m, i) => toMember(m, i === keeperIdx))
      .sort((a, b) => (a.keep === b.keep ? 0 : a.keep ? -1 : 1)); // keeper first
    groups.push({
      recordId: rid,
      keeperId: members[keeperIdx].findingId,
      keeperReason: reason,
      members: memberViews,
      appealSkipped: false,
    });
  }

  const recordsWithDupes = groups.filter((g) => !g.appealSkipped).length;
  return { scannedRows, groups, recordsWithDupes, losers, appealSkips };
}

/** Read-only preview. Same planner as execute; slices the top groups for display. */
export async function diagnoseDuplicateRecords(orgId: OrgId, since: number, until: number): Promise<RecordDedupDiagnosis> {
  const plan = await planDuplicateRecords(orgId, since, until);
  const sample = [...plan.groups].sort((a, b) => b.members.length - a.members.length).slice(0, 40);
  return {
    since,
    until,
    scannedRows: plan.scannedRows,
    recordsWithDupes: plan.recordsWithDupes,
    losersToEvict: plan.losers,
    appealSkips: plan.appealSkips,
    sampleTotal: plan.groups.length,
    sampleGroups: sample,
  };
}

// ── Eviction ─────────────────────────────────────────────────────────────────

/** Release any lingering review locks for a finding. cleanupFindingFromIndices
 *  covers every other review store but not the lock table. */
async function releaseLocksForFinding(orgId: OrgId, findingId: string): Promise<void> {
  const locks = await listStoredWithKeys<{ reviewer?: string }>("review-lock", orgId);
  for (const { key } of locks) {
    if (key[0] === findingId) await deleteStored("review-lock", orgId, ...key);
  }
}

/** Retire ONE losing duplicate finding "top to bottom" while KEEPING the raw
 *  audit body. Returns whether it removed a chargeback / wire payroll row (for
 *  reporting). Mirrors the re-audit soft-delete compose plus lock release +
 *  hidden mark. Order matters: mark hidden FIRST so even a mid-way failure still
 *  leaves the finding excluded from every report + payroll read. */
export async function evictDuplicateFinding(
  orgId: OrgId,
  findingId: string,
  hiddenBy: string,
): Promise<{ hadChargeback: boolean; hadWire: boolean }> {
  const [cb, wire, finding] = await Promise.all([
    getStored("chargeback-entry", orgId, findingId),
    getStored("wire-deduction-entry", orgId, findingId),
    getFinding(orgId, findingId),
  ]);

  await markFindingHidden(orgId, findingId, hiddenBy, "duplicate");
  await cleanupFindingFromIndices(orgId, findingId);
  if (finding) {
    await decrementForFinding(orgId, finding as Record<string, unknown>)
      .catch((e) => console.warn(`[DEDUP-REC] ${findingId} question-fail decrement failed:`, e));
  }
  await deleteFailedFindingRows(orgId, findingId)
    .catch((e) => console.warn(`[DEDUP-REC] ${findingId} failed-finding delete failed:`, e));
  await releaseLocksForFinding(orgId, findingId);

  return { hadChargeback: cb !== null, hadWire: wire !== null };
}

/** Build the record plan, then (execute) evict every loser one at a time, paced
 *  50ms apart with progress. Dry run returns the plan totals with evicted=0. */
export async function evictDuplicateRecords(
  orgId: OrgId,
  since: number,
  until: number,
  opts?: { execute?: boolean; hiddenBy?: string; onProgress?: (evicted: number, total: number) => void },
): Promise<RecordEvictResult> {
  const execute = !!opts?.execute;
  const hiddenBy = opts?.hiddenBy ?? "dedup";
  const plan = await planDuplicateRecords(orgId, since, until);

  const loserIds: string[] = [];
  for (const g of plan.groups) {
    if (g.appealSkipped) continue;
    for (const m of g.members) if (!m.keep) loserIds.push(m.findingId);
  }

  const result: RecordEvictResult = {
    scannedRows: plan.scannedRows,
    recordsWithDupes: plan.recordsWithDupes,
    losers: loserIds.length,
    evicted: 0,
    chargebacksRemoved: 0,
    wiresRemoved: 0,
    appealSkips: plan.appealSkips,
    failed: 0,
    failedIds: [],
  };
  if (!execute) return result;

  for (const fid of loserIds) {
    try {
      const { hadChargeback, hadWire } = await evictDuplicateFinding(orgId, fid, hiddenBy);
      result.evicted++;
      if (hadChargeback) result.chargebacksRemoved++;
      if (hadWire) result.wiresRemoved++;
    } catch (e) {
      result.failed++;
      result.failedIds.push(fid);
      console.error(`[DEDUP-REC] evict ${fid} failed:`, e);
    }
    opts?.onProgress?.(result.evicted, loserIds.length);
    await new Promise((r) => setTimeout(r, 50));
  }
  return result;
}
