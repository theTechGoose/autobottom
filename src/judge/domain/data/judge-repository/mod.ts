/** Judge queue repository — appeals, decisions, queue ops.
 *  Ported from main:judge/kv.ts — claimNextItem, undoDecision, adminDeleteFinding
 *  full-cleanup. Legacy aliases preserve controller dynamic-import call sites. */

import { getKv, orgKey } from "@core/data/deno-kv/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";
import type { JudgeDecision, AppealRecord } from "@core/dto/types.ts";
import { getFinding, getTranscript } from "@audit/domain/data/audit-repository/mod.ts";
import {
  deleteChargebackEntry,
  deleteWireDeductionEntry,
  deleteAuditDoneIndexEntry,
  deleteCompletedStat,
  getChargebackEntries,
  getWireDeductionEntries,
  saveChargebackEntry,
  saveWireDeductionEntry,
  queryAuditDoneIndex,
} from "@audit/domain/data/stats-repository/mod.ts";

const ACTIVE_TTL = 30 * 60 * 1000;
const BUFFER_SIZE = 5;

// Recording re-audit types should never reach the judge queue — if they slip in
// we auto-dismiss them during claim.
const SKIP_APPEAL_TYPES = new Set(["different-recording", "additional-recording", "upload-recording"]);

export interface JudgeItem {
  findingId: string;
  questionIndex: number;
  header: string;
  populated: string;
  thinking: string;
  defense: string;
  answer: string;
  appealType?: string;
  recordingIdField?: string;
  recordingId?: string;
}

export interface JudgeBufferItem extends JudgeItem {
  auditRemaining: number;
  transcript: { raw: string; diarized: string; utteranceTimes?: number[] } | null;
  appealComment?: string;
  reviewedBy?: string;
  recordId?: string;
  recordMeta?: {
    guestName?: string;
    spouseName?: string;
    maritalStatus?: string;
    roomTypeMaxOccupancy?: string;
    destination?: string;
    arrivalDate?: string;
    departureDate?: string;
    totalWGS?: string;
    totalMCC?: string;
    officeName?: string;
    totalAmountPaid?: string;
    hasMCC?: string;
    mspSubscription?: string;
  };
}

// ── Queue Population ─────────────────────────────────────────────────────────

export async function populateJudgeQueue(
  orgId: OrgId, findingId: string, questions: any[], appealType?: string,
  recordingIdField?: string, recordingId?: string,
): Promise<void> {
  const db = await getKv();
  const atomic = db.atomic();
  let count = 0;
  for (const [i, q] of questions.entries()) {
    const idx = q._origIdx ?? i;
    const item: JudgeItem = {
      findingId, questionIndex: idx, header: q.header ?? "", populated: q.populated ?? "",
      thinking: q.thinking ?? "", defense: q.defense ?? "", answer: q.answer ?? "",
      ...(appealType ? { appealType } : {}),
      ...(recordingIdField ? { recordingIdField } : {}),
      ...(recordingId ? { recordingId } : {}),
    };
    atomic.set(orgKey(orgId, "judge-pending", findingId, idx), item);
    count++;
  }
  atomic.set(orgKey(orgId, "judge-audit-pending", findingId), count);
  await atomic.commit();
  console.log(`✅ [JUDGE] ${findingId}: Queued ${count} items for judge review`);
}

// ── Decision Recording — saves full JudgeItem so undo can restore ────────────

export async function recordJudgeDecision(
  orgId: OrgId, findingId: string, questionIndex: number,
  decision: "uphold" | "overturn", judge: string, reason?: string,
): Promise<{ remaining: number }> {
  const db = await getKv();

  // Load full item from active (or pending) so decided record preserves context
  const activeKey = orgKey(orgId, "judge-active", judge, findingId, questionIndex);
  const pendingKey = orgKey(orgId, "judge-pending", findingId, questionIndex);
  let baseItem: JudgeItem | null = null;
  const activeEntry = await db.get<JudgeItem & { claimedAt?: number }>(activeKey);
  if (activeEntry.value) {
    const { claimedAt: _, ...rest } = activeEntry.value;
    baseItem = rest as JudgeItem;
  } else {
    const pendingEntry = await db.get<JudgeItem>(pendingKey);
    if (pendingEntry.value) baseItem = pendingEntry.value;
  }
  if (!baseItem) {
    baseItem = {
      findingId, questionIndex,
      header: "", populated: "", thinking: "", defense: "", answer: "No",
    };
  }

  const decidedRecord: JudgeDecision = {
    ...baseItem,
    decision,
    judge,
    ...(reason ? { reason: reason as JudgeDecision["reason"] } : {}),
    decidedAt: Date.now(),
  };
  await db.set(orgKey(orgId, "judge-decided", findingId, questionIndex), decidedRecord);
  await db.delete(activeKey);
  const counterKey = orgKey(orgId, "judge-audit-pending", findingId);
  const counter = (await db.get<number>(counterKey)).value ?? 1;
  const newCount = Math.max(0, counter - 1);
  await db.set(counterKey, newCount);
  return { remaining: newCount };
}

// ── Claim Next Item — port of main:judge/kv.ts:166-285 ───────────────────────

async function sweepExpiredActiveClaims(orgId: OrgId, excludeJudge?: string): Promise<number> {
  const db = await getKv();
  const now = Date.now();
  let reclaimed = 0;
  const iter = db.list<JudgeItem & { claimedAt: number }>({ prefix: orgKey(orgId, "judge-active") });
  for await (const entry of iter) {
    const val = entry.value;
    if (excludeJudge) {
      const keyParts = entry.key as Deno.KvKeyPart[];
      if (keyParts[2] === excludeJudge) continue;
    }
    if (val.claimedAt && (now - val.claimedAt) > ACTIVE_TTL) {
      const pendingKey = orgKey(orgId, "judge-pending", val.findingId, val.questionIndex);
      const { claimedAt: _, ...baseItem } = val;
      const res = await db.atomic()
        .check(entry)
        .delete(entry.key)
        .set(pendingKey, baseItem as JudgeItem)
        .commit();
      if (res.ok) {
        reclaimed++;
        console.log(`[JUDGE] Reclaimed expired active item ${val.findingId}/${val.questionIndex}`);
      }
    }
  }
  return reclaimed;
}

// Post-completion hook. Main does substantial work here (update finding status,
// emit events, chargeback updates). On branch, keeping this as a log-only
// helper matches existing recordJudgeDecision behavior, which doesn't yet do
// those side-effects. If/when gamification + event emission are ported, wire
// them in here. Safe no-op today.
async function postJudgedAudit(_orgId: OrgId, findingId: string, judge: string): Promise<void> {
  console.log(`[JUDGE] ${findingId}: audit completed by ${judge}`);
}

export async function claimNextItem(
  orgId: OrgId,
  judge: string,
): Promise<{ buffer: JudgeBufferItem[]; remaining: number }> {
  const db = await getKv();
  const now = Date.now();

  async function claimFromPending(count: number): Promise<JudgeItem[]> {
    const claimed: JudgeItem[] = [];
    const iter = db.list<JudgeItem>({ prefix: orgKey(orgId, "judge-pending") });
    for await (const entry of iter) {
      if (entry.value.appealType && SKIP_APPEAL_TYPES.has(entry.value.appealType)) {
        const skipFid = entry.value.findingId;
        const counterKey = orgKey(orgId, "judge-audit-pending", skipFid);
        const counterEntry = await db.get<number>(counterKey);
        const newCount = (counterEntry.value ?? 1) - 1;
        const skipAtomic = db.atomic().delete(entry.key);
        if (newCount <= 0) skipAtomic.delete(counterKey);
        else skipAtomic.set(counterKey, newCount);
        await skipAtomic.commit();
        if (newCount <= 0) {
          postJudgedAudit(orgId, skipFid, "system").catch((err) =>
            console.error(`[JUDGE] ${skipFid}: ❌ SKIP completion failed:`, err));
        }
        continue;
      }
      const activeKey = orgKey(orgId, "judge-active", judge, entry.value.findingId, entry.value.questionIndex);
      const res = await db.atomic()
        .check(entry)
        .delete(entry.key)
        .set(activeKey, { ...entry.value, claimedAt: now })
        .commit();
      if (res.ok) {
        claimed.push(entry.value);
        if (claimed.length >= count) break;
      }
    }
    return claimed;
  }

  async function enrich(item: JudgeItem): Promise<JudgeBufferItem> {
    const transcript = await getTranscript(orgId, item.findingId);
    const counterEntry = await db.get<number>(orgKey(orgId, "judge-audit-pending", item.findingId));
    let appealComment: string | undefined;
    let enrichedAppealType = item.appealType;
    const finding = await getFinding(orgId, item.findingId);
    if (finding) {
      const f = finding as Record<string, any>;
      if (f.appealType && !item.appealType) enrichedAppealType = f.appealType;
      if (f.appealComment) appealComment = f.appealComment;
    }
    const reviewedBy = (finding?.answeredQuestions as any[] | undefined)?.find(
      (q: any) => q.reviewedBy,
    )?.reviewedBy as string | undefined;
    let recordId: string | undefined;
    let recordMeta: JudgeBufferItem["recordMeta"] | undefined;
    if (finding) {
      const rec = (finding as any).record as Record<string, unknown> ?? {};
      recordId = String(rec.RecordId ?? "") || undefined;
      const isPackage = item.recordingIdField === "GenieNumber";
      recordMeta = isPackage ? {
        guestName: rec.GuestName ? String(rec.GuestName) : undefined,
        maritalStatus: rec["67"] ? String(rec["67"]) : undefined,
        officeName: rec.OfficeName ? String(rec.OfficeName) : undefined,
        totalAmountPaid: rec["145"] ? String(rec["145"]) : undefined,
        hasMCC: rec["345"] ? String(rec["345"]) : undefined,
        mspSubscription: rec["306"] ? String(rec["306"]) : undefined,
      } : {
        guestName: rec.GuestName ? String(rec.GuestName) : (rec["32"] ? String(rec["32"]) : undefined),
        spouseName: rec["33"] ? String(rec["33"]) : undefined,
        maritalStatus: rec["49"] ? String(rec["49"]) : undefined,
        roomTypeMaxOccupancy: rec["297"] ? String(rec["297"]) : undefined,
        destination: rec.DestinationDisplay ? String(rec.DestinationDisplay) : (rec["314"] ? String(rec["314"]) : undefined),
        arrivalDate: rec["8"] ? String(rec["8"]) : undefined,
        departureDate: rec["10"] ? String(rec["10"]) : undefined,
        totalWGS: rec["460"] ? String(rec["460"]) : undefined,
        totalMCC: rec["594"] ? String(rec["594"]) : undefined,
      };
    }
    return {
      ...item,
      ...(enrichedAppealType ? { appealType: enrichedAppealType } : {}),
      auditRemaining: counterEntry.value ?? 0,
      transcript,
      ...(appealComment ? { appealComment } : {}),
      ...(reviewedBy ? { reviewedBy } : {}),
      ...(recordId ? { recordId } : {}),
      ...(recordMeta ? { recordMeta } : {}),
    };
  }

  // 1. Sweep expired active claims from OTHER judges back to pending
  await sweepExpiredActiveClaims(orgId, judge);

  // 2. Collect existing active items for this judge
  const activeItems: JudgeItem[] = [];
  const activeIter = db.list<JudgeItem & { claimedAt: number }>({
    prefix: orgKey(orgId, "judge-active", judge),
  });
  for await (const entry of activeIter) activeItems.push(entry.value);

  // 3. Top up from pending if needed
  if (activeItems.length < BUFFER_SIZE) {
    const more = await claimFromPending(BUFFER_SIZE - activeItems.length);
    activeItems.push(...more);
  }

  // 4. Enrich all items
  const buffer: JudgeBufferItem[] = [];
  for (const item of activeItems) buffer.push(await enrich(item));

  return { buffer, remaining: 0 };
}

// ── Undo Decision — port of main:judge/kv.ts:409-475 ─────────────────────────

export async function undoDecision(
  orgId: OrgId,
  judge: string,
): Promise<{ buffer: JudgeBufferItem[]; remaining: number }> {
  const db = await getKv();

  // Release all current active items held by this judge
  const activeIter = db.list<JudgeItem & { claimedAt: number }>({
    prefix: orgKey(orgId, "judge-active", judge),
  });
  for await (const entry of activeIter) {
    const { claimedAt: _, ...baseItem } = entry.value;
    await db.atomic()
      .check(entry)
      .delete(entry.key)
      .set(orgKey(orgId, "judge-pending", entry.value.findingId, entry.value.questionIndex), baseItem as JudgeItem)
      .commit();
  }

  // Find the most recent decision by this judge
  let latestDecided: { entry: Deno.KvEntry<JudgeDecision>; decidedAt: number } | null = null;
  const decidedIter = db.list<JudgeDecision>({ prefix: orgKey(orgId, "judge-decided") });
  for await (const entry of decidedIter) {
    if (entry.value.judge === judge) {
      if (!latestDecided || entry.value.decidedAt > latestDecided.decidedAt) {
        latestDecided = { entry, decidedAt: entry.value.decidedAt };
      }
    }
  }
  if (!latestDecided) return { buffer: [], remaining: 0 };

  const decided = latestDecided.entry.value;
  const { findingId, questionIndex } = decided;
  const item: JudgeItem = {
    findingId: decided.findingId,
    questionIndex: decided.questionIndex,
    header: decided.header ?? "",
    populated: decided.populated ?? "",
    thinking: decided.thinking ?? "",
    defense: decided.defense ?? "",
    answer: decided.answer ?? "No",
    ...(decided.appealType ? { appealType: decided.appealType } : {}),
    ...(decided.recordingIdField ? { recordingIdField: decided.recordingIdField } : {}),
    ...(decided.recordingId ? { recordingId: decided.recordingId } : {}),
  };

  const counterKey = orgKey(orgId, "judge-audit-pending", findingId);
  const counterEntry = await db.get<number>(counterKey);
  const newCount = (counterEntry.value ?? 0) + 1;
  const activeKey = orgKey(orgId, "judge-active", judge, findingId, questionIndex);

  const res = await db.atomic()
    .check(latestDecided.entry)
    .check(counterEntry)
    .delete(latestDecided.entry.key)
    .set(activeKey, { ...item, claimedAt: Date.now() })
    .set(counterKey, newCount)
    .commit();
  if (!res.ok) return { buffer: [], remaining: 0 };

  return claimNextItem(orgId, judge);
}

// ── Appeal CRUD ──────────────────────────────────────────────────────────────

export async function getAppeal(orgId: OrgId, findingId: string): Promise<AppealRecord | null> {
  return (await (await getKv()).get<AppealRecord>(orgKey(orgId, "appeal", findingId))).value;
}

export async function saveAppeal(orgId: OrgId, record: AppealRecord): Promise<void> {
  await (await getKv()).set(orgKey(orgId, "appeal", record.findingId), record);
}

export async function deleteAppeal(orgId: OrgId, fid: string): Promise<void> {
  await (await getKv()).delete(orgKey(orgId, "appeal", fid));
}

// ── Stats ────────────────────────────────────────────────────────────────────

export async function getJudgeStats(orgId: OrgId): Promise<{ pending: number; decided: number }> {
  const db = await getKv();
  let pending = 0, decided = 0;
  for await (const _ of db.list({ prefix: orgKey(orgId, "judge-pending") })) pending++;
  for await (const _ of db.list({ prefix: orgKey(orgId, "judge-decided") })) decided++;
  return { pending, decided };
}

// ── Dismiss / Clear ──────────────────────────────────────────────────────────

export async function dismissFindingFromJudgeQueue(orgId: OrgId, fid: string): Promise<{ dismissed: number }> {
  const db = await getKv();
  let dismissed = 0;
  for await (const entry of db.list({ prefix: orgKey(orgId, "judge-pending", fid) })) {
    await db.delete(entry.key);
    dismissed++;
  }
  for await (const entry of db.list({ prefix: orgKey(orgId, "judge-active") })) {
    const v = entry.value as any;
    if (v?.findingId === fid) { await db.delete(entry.key); dismissed++; }
  }
  return { dismissed };
}

export async function clearJudgeQueue(orgId: OrgId): Promise<{ cleared: number }> {
  const db = await getKv();
  let cleared = 0;
  for await (const entry of db.list({ prefix: orgKey(orgId, "judge-pending") })) { await db.delete(entry.key); cleared++; }
  for await (const entry of db.list({ prefix: orgKey(orgId, "judge-active") })) { await db.delete(entry.key); cleared++; }
  return { cleared };
}

// ── Admin delete finding — full-cleanup port of main:judge/kv.ts:1294+ ───────

export async function adminDeleteFinding(orgId: OrgId, findingId: string): Promise<void> {
  const db = await getKv();

  // Look up completedAt from audit-done-idx (best effort) for index cleanup
  let completedAt = Date.now();
  for await (const entry of db.list<{ findingId: string; completedAt: number }>({ prefix: orgKey(orgId, "audit-done-idx") })) {
    if (entry.value?.findingId === findingId) { completedAt = entry.value.completedAt; break; }
  }

  // Collect all secondary-index keys to delete
  const keys: Deno.KvKey[] = [];
  for await (const entry of db.list({ prefix: orgKey(orgId, "review-pending", findingId) })) keys.push(entry.key);
  for await (const entry of db.list({ prefix: orgKey(orgId, "review-decided", findingId) })) keys.push(entry.key);
  for await (const entry of db.list<{ findingId?: string }>({ prefix: orgKey(orgId, "review-active") })) {
    if (entry.value?.findingId === findingId) keys.push(entry.key);
  }
  keys.push(orgKey(orgId, "review-audit-pending", findingId));
  keys.push(orgKey(orgId, "review-done", findingId));
  for await (const entry of db.list({ prefix: orgKey(orgId, "judge-pending", findingId) })) keys.push(entry.key);
  for await (const entry of db.list({ prefix: orgKey(orgId, "judge-decided", findingId) })) keys.push(entry.key);
  for await (const entry of db.list<{ findingId?: string }>({ prefix: orgKey(orgId, "judge-active") })) {
    if (entry.value?.findingId === findingId) keys.push(entry.key);
  }
  keys.push(orgKey(orgId, "judge-audit-pending", findingId));
  keys.push(orgKey(orgId, "manager-queue", findingId));
  keys.push(orgKey(orgId, "appeal", findingId));
  keys.push(orgKey(orgId, "appeal-history", findingId));
  for await (const entry of db.list<{ findingId: string }>({ prefix: orgKey(orgId, "review-undo-idx") })) {
    if (entry.value?.findingId === findingId) keys.push(entry.key);
  }
  // Also delete the chunked audit-finding entries
  for await (const entry of db.list({ prefix: orgKey(orgId, "audit-finding", findingId) })) keys.push(entry.key);
  // And active-tracking
  keys.push(orgKey(orgId, "active-tracking", findingId));

  // Batch delete in groups of 10 (KV atomic limit)
  const BATCH = 10;
  for (let i = 0; i < keys.length; i += BATCH) {
    const atomic = db.atomic();
    for (const key of keys.slice(i, i + BATCH)) atomic.delete(key);
    await atomic.commit();
  }

  await deleteChargebackEntry(orgId, findingId).catch(() => {});
  await deleteWireDeductionEntry(orgId, findingId).catch(() => {});
  await deleteAuditDoneIndexEntry(orgId, findingId, completedAt).catch(() => {});
  await deleteCompletedStat(orgId, findingId).catch(() => {});

  console.log(`[ADMIN-DELETE] 🗑️ ${findingId}: cleaned ${keys.length} KV entries + cb/wire/audit-done-idx/completed-stat`);
}

// ── Appeal re-audit cleanup — like adminDeleteFinding minus finding chunks ───

/** Remove the old finding from every queue / index when an agent files a
 *  recording-swap appeal (Option B/C). The finding itself is kept (soft-delete
 *  via reAuditedAt) so the report still renders, but reviewers/judges stop
 *  seeing it and chargeback/wire entries are cleared. Port of
 *  main:judge/kv.ts:1253 cleanupFindingFromIndices. */
export async function cleanupFindingFromIndices(orgId: OrgId, findingId: string): Promise<void> {
  const db = await getKv();
  let completedAt = Date.now();
  for await (const entry of db.list<{ findingId: string; completedAt: number }>({ prefix: orgKey(orgId, "audit-done-idx") })) {
    if (entry.value?.findingId === findingId) { completedAt = entry.value.completedAt; break; }
  }
  const keys: Deno.KvKey[] = [];
  for await (const entry of db.list({ prefix: orgKey(orgId, "review-pending", findingId) })) keys.push(entry.key);
  for await (const entry of db.list({ prefix: orgKey(orgId, "review-decided", findingId) })) keys.push(entry.key);
  for await (const entry of db.list<{ findingId?: string }>({ prefix: orgKey(orgId, "review-active") })) {
    if (entry.value?.findingId === findingId) keys.push(entry.key);
  }
  keys.push(orgKey(orgId, "review-audit-pending", findingId));
  keys.push(orgKey(orgId, "review-done", findingId));
  for await (const entry of db.list({ prefix: orgKey(orgId, "judge-pending", findingId) })) keys.push(entry.key);
  for await (const entry of db.list({ prefix: orgKey(orgId, "judge-decided", findingId) })) keys.push(entry.key);
  for await (const entry of db.list<{ findingId?: string }>({ prefix: orgKey(orgId, "judge-active") })) {
    if (entry.value?.findingId === findingId) keys.push(entry.key);
  }
  keys.push(orgKey(orgId, "judge-audit-pending", findingId));
  keys.push(orgKey(orgId, "manager-queue", findingId));
  keys.push(orgKey(orgId, "appeal", findingId));
  keys.push(orgKey(orgId, "appeal-history", findingId));
  for await (const entry of db.list<{ findingId: string }>({ prefix: orgKey(orgId, "review-undo-idx") })) {
    if (entry.value?.findingId === findingId) keys.push(entry.key);
  }
  const BATCH = 10;
  for (let i = 0; i < keys.length; i += BATCH) {
    const atomic = db.atomic();
    for (const key of keys.slice(i, i + BATCH)) atomic.delete(key);
    await atomic.commit();
  }
  await deleteChargebackEntry(orgId, findingId).catch(() => {});
  await deleteWireDeductionEntry(orgId, findingId).catch(() => {});
  await deleteCompletedStat(orgId, findingId).catch(() => {});
  await deleteAuditDoneIndexEntry(orgId, findingId, completedAt).catch(() => {});
  console.log(`[CLEANUP] 🗑️ ${findingId}: indices cleared (${keys.length} KV entries + cb/wire/stat/done-idx)`);
}

// ── Legacy-compatible aliases ────────────────────────────────────────────────

export const claimNextItemLegacy = claimNextItem;
export const undoDecisionLegacy = undoDecision;
export const adminDeleteFindingLegacy = adminDeleteFinding;

// ── Backfill chargeback/wire entries from current finding state ──────────────

function _isYes(a: string | undefined): boolean {
  const s = String(a ?? "").trim().toLowerCase();
  return s.startsWith("yes") || s === "true" || s === "y" || s === "1";
}

/** Re-derive chargeback + wire entries from each finding's current answers.
 *  Handles review/judge flips that changed the score after initial write.
 *  Port of main:judge/kv.ts:935-998. */
export async function backfillChargebackEntries(
  orgId: OrgId,
  since: number,
  until: number,
): Promise<{ scanned: number; cbUpdated: number; cbDeleted: number; wireUpdated: number }> {
  let scanned = 0, cbUpdated = 0, cbDeleted = 0, wireUpdated = 0;

  const wireEntries = await getWireDeductionEntries(orgId, since, until);
  const cbEntries = await getChargebackEntries(orgId, since, until);

  for (const wireEntry of wireEntries) {
    scanned++;
    const finding = await getFinding(orgId, wireEntry.findingId);
    if (!finding) continue;
    const answers = finding.answeredQuestions ?? [];
    if (answers.length === 0) continue;
    const finalYes = answers.filter((a: any) => _isYes(a.answer)).length;
    const finalScore = answers.length > 0 ? Math.round((finalYes / answers.length) * 100) : 0;
    await saveWireDeductionEntry(orgId, {
      ...wireEntry,
      score: finalScore,
      totalSuccess: finalYes,
      questionsAudited: answers.length,
    });
    wireUpdated++;
  }

  for (const cbEntry of cbEntries) {
    scanned++;
    const finding = await getFinding(orgId, cbEntry.findingId);
    if (!finding) continue;
    const answers = finding.answeredQuestions ?? [];
    if (answers.length === 0) continue;
    const finalYes = answers.filter((a: any) => _isYes(a.answer)).length;
    const finalScore = answers.length > 0 ? Math.round((finalYes / answers.length) * 100) : 0;
    const failedQHeaders = answers
      .filter((a: any) => !_isYes(a.answer))
      .map((a: any) => a.header)
      .filter(Boolean);
    if (failedQHeaders.length === 0) {
      await deleteChargebackEntry(orgId, cbEntry.findingId);
      cbDeleted++;
    } else {
      await saveChargebackEntry(orgId, { ...cbEntry, score: finalScore, failedQHeaders });
      cbUpdated++;
    }
  }

  return { scanned, cbUpdated, cbDeleted, wireUpdated };
}

// ── Find duplicate findings by RecordId ──────────────────────────────────────

export interface DedupCandidate {
  id: string;
  recordKey: string;
  ts: number;
  reviewed: boolean;
  keep: boolean;
}

export interface DedupPlan {
  scanned: number;
  groups: number;
  orphaned: number;
  toDelete: DedupCandidate[];
}

function _extractRecordId(raw: string): string {
  return (
    raw.match(/"RecordId"\s*:\s*(\d+)/)?.[1] ||
    raw.match(/"recordingId"\s*:\s*"([^"]+)"/)?.[1] ||
    ""
  );
}

/** Scan audit-done-idx in [since, until], group by QB RecordId, mark losers.
 *  Port of main:judge/kv.ts:1090-1171. */
export async function findDuplicates(
  orgId: OrgId,
  since: number,
  until: number,
): Promise<DedupPlan> {
  const db = await getKv();
  const indexEntries = await queryAuditDoneIndex(orgId, since, until);

  type Entry = { id: string; recordKey: string; ts: number; reviewed: boolean };
  const inRange: Entry[] = [];
  const needChunk: typeof indexEntries = [];

  for (const e of indexEntries) {
    if (e.recordId) {
      inRange.push({
        id: e.findingId,
        recordKey: e.recordId,
        ts: e.completedAt,
        reviewed: e.reason === "reviewed",
      });
    } else {
      needChunk.push(e);
    }
  }

  // Fallback: chunk-0 lookup for legacy entries missing recordId in the index
  const orphaned: typeof needChunk = [];
  const BATCH = 50;
  for (let i = 0; i < needChunk.length; i += BATCH) {
    const batch = needChunk.slice(i, i + BATCH);
    const chunk0s = await Promise.all(
      batch.map((e) => db.get<string>(orgKey(orgId, "audit-finding", e.findingId, 0))),
    );
    for (let j = 0; j < batch.length; j++) {
      const raw = chunk0s[j].value;
      const idx = batch[j];
      if (!raw) { orphaned.push(idx); continue; }
      const recordKey = _extractRecordId(raw);
      if (!recordKey) continue;
      inRange.push({
        id: idx.findingId,
        recordKey,
        ts: idx.completedAt,
        reviewed: idx.reason === "reviewed",
      });
    }
  }

  // Group by RecordId, winner = reviewed > unreviewed, then newest
  const groups = new Map<string, Entry[]>();
  for (const e of inRange) {
    const g = groups.get(e.recordKey) ?? [];
    g.push(e);
    groups.set(e.recordKey, g);
  }

  const toDelete: DedupCandidate[] = [];
  let dupGroups = 0;
  for (const [, group] of groups) {
    if (group.length <= 1) continue;
    dupGroups++;
    group.sort((a, b) => {
      if (a.reviewed !== b.reviewed) return a.reviewed ? -1 : 1;
      return b.ts - a.ts;
    });
    toDelete.push({ ...group[0], keep: true });
    for (const dup of group.slice(1)) toDelete.push({ ...dup, keep: false });
  }

  for (const e of orphaned) {
    toDelete.push({ id: e.findingId, recordKey: e.findingId, ts: e.completedAt, reviewed: false, keep: false });
  }

  console.log(`[DEDUP] dry-run org=${orgId} scanned=${inRange.length} dupGroups=${dupGroups} toDelete=${toDelete.filter((d) => !d.keep).length} orphaned=${orphaned.length}`);
  return { scanned: inRange.length, groups: dupGroups, orphaned: orphaned.length, toDelete };
}

/** Delete the losers identified by findDuplicates. Port of
 *  main:judge/kv.ts:1172-1252 (adminDeleteFinding shares the same cleanup). */
export async function deleteDuplicates(
  orgId: OrgId,
  plan: DedupPlan,
  onProgress?: (deleted: number, total: number, findingId: string) => void,
): Promise<{ deleted: number }> {
  const losers = plan.toDelete.filter((d) => !d.keep);
  let deleted = 0;
  for (const dup of losers) {
    await adminDeleteFinding(orgId, dup.id).catch((err) =>
      console.error(`[DEDUP] ❌ failed to delete ${dup.id}:`, err),
    );
    deleted++;
    onProgress?.(deleted, losers.length, dup.id);
  }
  console.log(`[DEDUP] ✅ done org=${orgId} deleted=${deleted}/${losers.length}`);
  return { deleted };
}

// ── Legacy aliases for data-maintenance functions ────────────────────────────

export const backfillChargebackEntriesLegacy = backfillChargebackEntries;
export const findDuplicatesLegacy = findDuplicates;
export const deleteDuplicatesLegacy = deleteDuplicates;
