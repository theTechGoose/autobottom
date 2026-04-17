/** Review queue service — FIFO ordering, claim/decide/back logic.
 *  Pure business logic for queue operations. KV interactions via getKv().
 *
 *  Ported from production main:review/kv.ts — claimNextItem, undoDecision,
 *  adminFlipFinding, previewFinding, backfillFromFinished. The `*Legacy`
 *  aliases at the bottom preserve the controllers' dynamic-import call sites. */

import { getKv, orgKey } from "@core/data/deno-kv/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";
import type { ReviewItem, ReviewDecision } from "@core/dto/types.ts";
import {
  getFinding,
  saveFinding,
  getTranscript,
  saveBatchAnswers,
  getAllAnswersForFinding,
} from "@audit/domain/data/audit-repository/mod.ts";
import {
  writeAuditDoneIndex,
  updateCompletedStatScore,
  deleteChargebackEntry,
  deleteWireDeductionEntry,
} from "@audit/domain/data/stats-repository/mod.ts";

const ACTIVE_TTL = 30 * 60 * 1000; // 30 minutes

/** Review buffer item — ReviewItem enriched with audit-context fields. */
export interface BufferItem extends ReviewItem {
  auditRemaining: number;
  transcript: { raw: string; diarized: string; utteranceTimes?: number[] } | null;
}

// ── Queue population ─────────────────────────────────────────────────────────

export async function populateReviewQueue(
  orgId: OrgId,
  findingId: string,
  answeredQuestions: Array<{ answer: string; header: string; populated: string; thinking: string; defense: string }>,
  recordingIdField?: string,
  recordId?: string,
  recordMeta?: ReviewItem["recordMeta"],
  completedAt?: number,
): Promise<void> {
  const db = await getKv();
  const noAnswers = answeredQuestions
    .map((q, i) => ({ ...q, index: i }))
    .filter((q) => q.answer === "No");

  if (noAnswers.length === 0) return;

  const atomic = db.atomic();
  for (const [reviewIdx, q] of noAnswers.entries()) {
    const item: ReviewItem = {
      findingId,
      questionIndex: q.index,
      reviewIndex: reviewIdx + 1,
      totalForFinding: noAnswers.length,
      header: q.header,
      populated: q.populated,
      thinking: q.thinking,
      defense: q.defense,
      answer: q.answer,
      ...(completedAt != null ? { completedAt } : {}),
      ...(recordingIdField ? { recordingIdField } : {}),
      ...(recordId ? { recordId } : {}),
      ...(recordMeta ? { recordMeta } : {}),
    };
    atomic.set(orgKey(orgId, "review-pending", findingId, q.index), item);
  }
  atomic.set(orgKey(orgId, "review-audit-pending", findingId), noAnswers.length);
  await atomic.commit();
  console.log(`✅ [REVIEW] ${findingId}: Queued ${noAnswers.length} items for review`);
}

// ── FIFO selection (pure logic) ──────────────────────────────────────────────

export interface PendingItem<T = ReviewItem> {
  key: Deno.KvKey;
  value: T;
}

/**
 * Select the oldest finding from pending items. Pure function.
 * Items without completedAt get ts=0 (highest priority — drain first).
 */
export function selectOldestFinding(
  items: Array<{ value: ReviewItem }>,
  allowedTypes?: string[],
): { targetFindingId: string | null; indices: number[] } {
  const findingTimestamps = new Map<string, number>();
  const indexByFinding = new Map<string, number[]>();

  for (let i = 0; i < items.length; i++) {
    const item = items[i].value;
    if (allowedTypes) {
      const isPackage = item.recordingIdField === "GenieNumber";
      const itemType = isPackage ? "package" : "date-leg";
      if (!allowedTypes.includes(itemType)) continue;
    }
    const fid = item.findingId;
    if (!indexByFinding.has(fid)) indexByFinding.set(fid, []);
    indexByFinding.get(fid)!.push(i);
    const ts = item.completedAt ?? 0;
    if (!findingTimestamps.has(fid) || ts < findingTimestamps.get(fid)!) {
      findingTimestamps.set(fid, ts);
    }
  }

  let targetFindingId: string | null = null;
  let oldestTs = Infinity;
  for (const [fid, ts] of findingTimestamps) {
    if (ts < oldestTs) { oldestTs = ts; targetFindingId = fid; }
  }

  const indices = targetFindingId ? (indexByFinding.get(targetFindingId) ?? []) : [];
  return { targetFindingId, indices };
}

// ── Claim next item — port of main:review/kv.ts:183-326 ──────────────────────

async function enrichItem(
  orgId: OrgId,
  item: ReviewItem,
  sharedTranscript?: BufferItem["transcript"],
): Promise<BufferItem> {
  const db = await getKv();
  const transcript = sharedTranscript !== undefined
    ? sharedTranscript
    : await getTranscript(orgId, item.findingId);
  const counterEntry = await db.get<number>(orgKey(orgId, "review-audit-pending", item.findingId));
  return { ...item, auditRemaining: counterEntry.value ?? 0, transcript };
}

export async function claimNextItem(
  orgId: OrgId,
  reviewer: string,
  allowedTypes?: string[],
): Promise<{ buffer: BufferItem[]; remaining: number }> {
  const db = await getKv();
  const now = Date.now();

  // 1. Sweep expired active claims from OTHER reviewers back to pending
  const allActiveIter = db.list<ReviewItem & { claimedAt: number }>({
    prefix: orgKey(orgId, "review-active"),
  });
  for await (const entry of allActiveIter) {
    const val = entry.value;
    const keyParts = entry.key as Deno.KvKeyPart[];
    if (keyParts[2] === reviewer) continue;
    if (val.claimedAt && (now - val.claimedAt) > ACTIVE_TTL) {
      const pendingKey = orgKey(orgId, "review-pending", val.findingId, val.questionIndex);
      const { claimedAt: _, ...baseItem } = val;
      const res = await db.atomic()
        .check(entry)
        .delete(entry.key)
        .set(pendingKey, baseItem as ReviewItem)
        .commit();
      if (res.ok) {
        console.log(`[REVIEW] Reclaimed expired active item ${val.findingId}/${val.questionIndex}`);
      }
    }
  }

  // 2. Collect existing active items for this reviewer
  const activeItems: ReviewItem[] = [];
  const activeIter = db.list<ReviewItem & { claimedAt: number }>({
    prefix: orgKey(orgId, "review-active", reviewer),
  });
  for await (const entry of activeIter) {
    activeItems.push(entry.value);
  }

  // 3. Legacy migration: if active items span multiple findings, keep the one with most items
  if (activeItems.length > 0) {
    const findingCounts = new Map<string, number>();
    for (const item of activeItems) findingCounts.set(item.findingId, (findingCounts.get(item.findingId) ?? 0) + 1);
    if (findingCounts.size > 1) {
      let bestFid = ""; let bestCount = 0;
      for (const [fid, count] of findingCounts) { if (count > bestCount) { bestFid = fid; bestCount = count; } }
      for (const item of activeItems) {
        if (item.findingId !== bestFid) {
          const activeKey = orgKey(orgId, "review-active", reviewer, item.findingId, item.questionIndex);
          const pendingKey = orgKey(orgId, "review-pending", item.findingId, item.questionIndex);
          const entry = await db.get<ReviewItem & { claimedAt: number }>(activeKey);
          if (entry.value) {
            const { claimedAt: _, ...baseItem } = entry.value;
            await db.atomic().check(entry).delete(activeKey).set(pendingKey, baseItem as ReviewItem).commit();
          }
        }
      }
      const kept = activeItems.filter((i) => i.findingId === bestFid);
      activeItems.length = 0;
      activeItems.push(...kept);
      console.log(`[REVIEW] Legacy migration: kept ${kept.length} items for ${bestFid}, released rest`);
    }
  }

  // 4. If reviewer already has active items, return them (locked into this audit)
  if (activeItems.length > 0) {
    activeItems.sort((a, b) => a.reviewIndex - b.reviewIndex);
    const transcript = await getTranscript(orgId, activeItems[0].findingId);
    const buffer: BufferItem[] = [];
    for (const item of activeItems) buffer.push(await enrichItem(orgId, item, transcript));
    return { buffer, remaining: 0 };
  }

  // 5. No active items — claim ALL pending items for the OLDEST audit (FIFO by completedAt)
  const findingTimestamps = new Map<string, number>();
  const pendingByFinding = new Map<string, Deno.KvEntry<ReviewItem>[]>();
  const pendingIter = db.list<ReviewItem>({ prefix: orgKey(orgId, "review-pending") });
  for await (const entry of pendingIter) {
    if (allowedTypes) {
      const isPackage = entry.value.recordingIdField === "GenieNumber";
      const itemType = isPackage ? "package" : "date-leg";
      if (!allowedTypes.includes(itemType)) continue;
    }
    const fid = entry.value.findingId;
    if (!pendingByFinding.has(fid)) pendingByFinding.set(fid, []);
    pendingByFinding.get(fid)!.push(entry);
    const ts = entry.value.completedAt ?? 0;
    if (!findingTimestamps.has(fid) || ts < findingTimestamps.get(fid)!) {
      findingTimestamps.set(fid, ts);
    }
  }

  let targetFindingId: string | null = null;
  let oldestTs = Infinity;
  for (const [fid, ts] of findingTimestamps) {
    if (ts < oldestTs) { oldestTs = ts; targetFindingId = fid; }
  }
  const pendingEntries = targetFindingId ? (pendingByFinding.get(targetFindingId) ?? []) : [];
  if (pendingEntries.length === 0) return { buffer: [], remaining: 0 };

  // Claim in batches of 3 (each claim = check + delete + set = 3 mutations, KV atomic max 10)
  const claimed: ReviewItem[] = [];
  for (let i = 0; i < pendingEntries.length; i += 3) {
    const batch = pendingEntries.slice(i, i + 3);
    let atomic = db.atomic();
    for (const entry of batch) {
      atomic = atomic
        .check(entry)
        .delete(entry.key)
        .set(
          orgKey(orgId, "review-active", reviewer, entry.value.findingId, entry.value.questionIndex),
          { ...entry.value, claimedAt: now },
        );
    }
    const res = await atomic.commit();
    if (res.ok) for (const entry of batch) claimed.push(entry.value);
  }

  if (claimed.length === 0) return { buffer: [], remaining: 0 };

  claimed.sort((a, b) => a.reviewIndex - b.reviewIndex);
  const transcript = await getTranscript(orgId, claimed[0].findingId);
  const buffer: BufferItem[] = [];
  for (const item of claimed) buffer.push(await enrichItem(orgId, item, transcript));
  console.log(`[REVIEW] ${reviewer}: Claimed ${claimed.length} items for audit ${targetFindingId}`);
  return { buffer, remaining: 0 };
}

// ── Decision recording — stores full ReviewItem so undoDecision can restore ──

export async function recordDecision(
  orgId: OrgId,
  findingId: string,
  questionIndex: number,
  decision: "confirm" | "flip",
  reviewer: string,
): Promise<{ remaining: number }> {
  const db = await getKv();
  const now = Date.now();

  // Load full item from active so the decided record includes header/populated/etc.
  // Fallback to pending if the undo path restored it there.
  const activeKey = orgKey(orgId, "review-active", reviewer, findingId, questionIndex);
  const pendingKey = orgKey(orgId, "review-pending", findingId, questionIndex);
  let baseItem: ReviewItem | null = null;
  const activeEntry = await db.get<ReviewItem & { claimedAt?: number }>(activeKey);
  if (activeEntry.value) {
    const { claimedAt: _, ...rest } = activeEntry.value;
    baseItem = rest as ReviewItem;
  } else {
    const pendingEntry = await db.get<ReviewItem>(pendingKey);
    if (pendingEntry.value) baseItem = pendingEntry.value;
  }
  if (!baseItem) {
    // Last-resort minimal record — preserves backwards compatibility
    baseItem = {
      findingId, questionIndex,
      reviewIndex: 0, totalForFinding: 0,
      header: "", populated: "", thinking: "", defense: "", answer: "No",
    };
  }

  const decisionRecord: ReviewDecision = { ...baseItem, decision, reviewer, decidedAt: now };
  await db.set(orgKey(orgId, "review-decided", findingId, questionIndex), decisionRecord);

  // Undo index — keyed by (reverse-chronological) so listing gives newest first
  const undoIdxKey = orgKey(
    orgId, "review-undo-idx", reviewer,
    String(9_000_000_000_000_000 - now).padStart(16, "0"),
  );
  await db.set(undoIdxKey, { findingId, questionIndex });

  // Remove from active
  await db.delete(activeKey);

  // Decrement pending counter
  const counterKey = orgKey(orgId, "review-audit-pending", findingId);
  const counter = await db.get<number>(counterKey);
  const newCount = Math.max(0, (counter.value ?? 1) - 1);
  await db.set(counterKey, newCount);

  console.log(`✅ [REVIEW] ${findingId}/${questionIndex}: ${decision} by ${reviewer} (${newCount} remaining)`);
  return { remaining: newCount };
}

// ── Undo decision — port of main:review/kv.ts:452-550 ────────────────────────

export async function undoDecision(
  orgId: OrgId,
  reviewer: string,
  allowedTypes?: string[],
): Promise<{ buffer: BufferItem[]; remaining: number }> {
  const db = await getKv();

  // Determine current audit findingId from active items
  let currentFindingId: string | null = null;
  const activeIter = db.list<ReviewItem & { claimedAt: number }>({
    prefix: orgKey(orgId, "review-active", reviewer),
  });
  for await (const entry of activeIter) {
    currentFindingId = entry.value.findingId;
    break;
  }

  // Walk undo index newest-first looking for a decided entry that's still eligible
  let decidedEntry: Deno.KvEntry<ReviewDecision> | null = null;
  let undoIdxEntryKey: Deno.KvKey | null = null;
  const idxIter = db.list<{ findingId: string; questionIndex: number }>(
    { prefix: orgKey(orgId, "review-undo-idx", reviewer) },
    { limit: 20 },
  );
  for await (const idxEntry of idxIter) {
    const { findingId: fid, questionIndex: qIdx } = idxEntry.value;
    if (currentFindingId && fid !== currentFindingId) continue;
    const counterCheck = await db.get<number>(orgKey(orgId, "review-audit-pending", fid));
    if (counterCheck.value === null) continue;
    const candidate = await db.get<ReviewDecision>(orgKey(orgId, "review-decided", fid, qIdx));
    if (!candidate.value || candidate.value.reviewer !== reviewer) continue;
    decidedEntry = candidate;
    undoIdxEntryKey = idxEntry.key;
    break;
  }

  // Fallback: full scan scoped to current finding
  if (!decidedEntry) {
    const myDecisions: { entry: Deno.KvEntry<ReviewDecision>; decidedAt: number }[] = [];
    const decidedIter = db.list<ReviewDecision>({ prefix: orgKey(orgId, "review-decided") });
    for await (const entry of decidedIter) {
      if (entry.value.reviewer !== reviewer) continue;
      if (currentFindingId && entry.value.findingId !== currentFindingId) continue;
      myDecisions.push({ entry, decidedAt: entry.value.decidedAt });
    }
    myDecisions.sort((a, b) => b.decidedAt - a.decidedAt);
    for (const candidate of myDecisions) {
      const counterCheck = await db.get<number>(orgKey(orgId, "review-audit-pending", candidate.entry.value.findingId));
      if (counterCheck.value !== null) { decidedEntry = candidate.entry; break; }
    }
  }

  if (!decidedEntry) return { buffer: [], remaining: 0 };

  const decided = decidedEntry.value;
  const { findingId, questionIndex } = decided;
  const item: ReviewItem = {
    findingId: decided.findingId,
    questionIndex: decided.questionIndex,
    reviewIndex: decided.reviewIndex ?? 1,
    totalForFinding: decided.totalForFinding ?? 1,
    header: decided.header ?? "",
    populated: decided.populated ?? "",
    thinking: decided.thinking ?? "",
    defense: decided.defense ?? "",
    answer: decided.answer ?? "No",
    ...(decided.recordingIdField ? { recordingIdField: decided.recordingIdField } : {}),
    ...(decided.recordId ? { recordId: decided.recordId } : {}),
    ...(decided.recordMeta ? { recordMeta: decided.recordMeta } : {}),
    ...(decided.completedAt != null ? { completedAt: decided.completedAt } : {}),
  };

  const counterKey = orgKey(orgId, "review-audit-pending", findingId);
  const counterEntry = await db.get<number>(counterKey);
  const newCount = (counterEntry.value ?? 0) + 1;
  const activeKey = orgKey(orgId, "review-active", reviewer, findingId, questionIndex);

  const atomic = db.atomic()
    .check(decidedEntry)
    .check(counterEntry)
    .delete(decidedEntry.key)
    .set(activeKey, { ...item, claimedAt: Date.now() })
    .set(counterKey, newCount);
  if (undoIdxEntryKey) atomic.delete(undoIdxEntryKey);

  const res = await atomic.commit();
  if (!res.ok) return { buffer: [], remaining: 0 };

  return claimNextItem(orgId, reviewer, allowedTypes);
}

// ── Admin-flip finding — set all "No" answers to "Yes" ───────────────────────

export async function adminFlipFinding(
  orgId: OrgId,
  findingId: string,
): Promise<{ success: boolean; score: number }> {
  const db = await getKv();
  const finding = await getFinding(orgId, findingId);
  if (!finding) return { success: false, score: 0 };

  const allAnswers = await getAllAnswersForFinding(orgId, findingId);
  const answers = allAnswers.length > 0 ? allAnswers : (finding.answeredQuestions ?? []);
  const corrected = answers.map((a: any) =>
    a.answer === "No" ? { ...a, answer: "Yes", reviewAction: "admin-flip" } : a,
  );
  const score = 100;

  finding.answeredQuestions = corrected;
  (finding as Record<string, unknown>).reviewedAt = new Date().toISOString();
  (finding as Record<string, unknown>).reviewScore = score;
  await saveFinding(orgId, finding);
  await saveBatchAnswers(orgId, findingId, 0, corrected);

  // Clean up review queue entries
  const keys: Deno.KvKey[] = [];
  for await (const entry of db.list({ prefix: orgKey(orgId, "review-pending", findingId) })) keys.push(entry.key);
  for await (const entry of db.list({ prefix: orgKey(orgId, "review-decided", findingId) })) keys.push(entry.key);
  for await (const entry of db.list<{ findingId?: string }>({ prefix: orgKey(orgId, "review-active") })) {
    if (entry.value?.findingId === findingId) keys.push(entry.key);
  }
  keys.push(orgKey(orgId, "review-audit-pending", findingId));
  for (let i = 0; i < keys.length; i += 10) {
    const batch = keys.slice(i, i + 10);
    const atomic = db.atomic();
    for (const key of batch) atomic.delete(key);
    await atomic.commit();
  }

  // Mark reviewed + update indices
  await db.set(orgKey(orgId, "review-done", findingId), { reviewedAt: new Date().toISOString() });

  const completedAt = ((finding as Record<string, unknown>).completedAt as number | undefined) ?? Date.now();
  const rec = (finding as any).record as Record<string, any> ?? {};
  const isPackage = finding.recordingIdField === "GenieNumber";
  const rawVo = String(rec.VoName ?? "");
  const voName = rawVo.includes(" - ") ? rawVo.split(" - ").slice(1).join(" - ").trim() : rawVo.trim();
  try {
    await writeAuditDoneIndex(orgId, {
      findingId,
      completedAt,
      score,
      completed: true,
      doneAt: Date.now(),
      reason: "reviewed",
      recordId: String(rec.RecordId ?? "") || undefined,
      isPackage,
      voName: voName || undefined,
      owner: finding.owner as string | undefined,
      department: String(isPackage ? (rec.OfficeName ?? "") : (rec.ActivatingOffice ?? "")) || undefined,
      shift: isPackage ? undefined : String(rec.Shift ?? "") || undefined,
    });
  } catch { /* index write is best-effort */ }
  await updateCompletedStatScore(orgId, findingId, score);

  await deleteChargebackEntry(orgId, findingId).catch(() => {});
  await deleteWireDeductionEntry(orgId, findingId).catch(() => {});

  console.log(`[ADMIN-FLIP] ✅ ${findingId} → 100% (${keys.length} queue entries removed)`);
  return { success: true, score };
}

// ── Preview finding — admin troubleshoot, no claim/lock ──────────────────────

export async function previewFinding(orgId: OrgId, findingId: string): Promise<BufferItem[] | null> {
  const finding = await getFinding(orgId, findingId);
  if (!finding || !finding.answeredQuestions?.length) return null;
  const transcript = await getTranscript(orgId, findingId);
  const items: BufferItem[] = finding.answeredQuestions.map((q: any, i: number) => ({
    findingId,
    questionIndex: i,
    reviewIndex: i + 1,
    totalForFinding: finding.answeredQuestions!.length,
    header: q.header ?? "",
    populated: q.populated ?? "",
    thinking: q.thinking ?? "",
    defense: q.defense ?? "",
    answer: q.answer ?? "No",
    recordingIdField: (finding.record as any)?.GenieNumber != null ? "GenieNumber" : undefined,
    recordId: String((finding.record as any)?.RecordId ?? ""),
    auditRemaining: 0,
    transcript,
  }));
  return items;
}

// ── Backfill review queue from finished findings ─────────────────────────────

export async function backfillFromFinished(orgId: OrgId): Promise<{ queued: number }> {
  const db = await getKv();
  let queued = 0;

  const findingIds = new Set<string>();
  const iter = db.list({ prefix: orgKey(orgId, "audit-finding") });
  for await (const entry of iter) {
    const key = entry.key as Deno.KvKey;
    if (key.length >= 3 && typeof key[2] === "string") findingIds.add(key[2] as string);
  }

  for (const findingId of findingIds) {
    const finding = await getFinding(orgId, findingId);
    if (!finding) continue;
    if (finding.findingStatus !== "finished") continue;
    if (!finding.answeredQuestions?.length) continue;

    // Skip if review queue already has a counter for this finding
    const existingCheck = await db.get(orgKey(orgId, "review-audit-pending", findingId));
    if (existingCheck.value !== null) continue;

    // Skip if any decided items exist for this finding
    let hasDecided = false;
    for await (const _ of db.list({ prefix: orgKey(orgId, "review-decided", findingId) })) {
      hasDecided = true;
      break;
    }
    if (hasDecided) continue;

    const noAnswers = (finding.answeredQuestions as any[])
      .map((q: any, i: number) => ({ ...q, index: i }))
      .filter((q: any) => q.answer === "No");
    if (noAnswers.length === 0) continue;

    const atomic = db.atomic();
    for (const [reviewIdx, q] of noAnswers.entries()) {
      const item: ReviewItem = {
        findingId,
        questionIndex: q.index,
        reviewIndex: reviewIdx + 1,
        totalForFinding: noAnswers.length,
        header: q.header ?? "",
        populated: q.populated ?? "",
        thinking: q.thinking ?? "",
        defense: q.defense ?? "",
        answer: q.answer,
      };
      atomic.set(orgKey(orgId, "review-pending", findingId, q.index), item);
    }
    atomic.set(orgKey(orgId, "review-audit-pending", findingId), noAnswers.length);
    await atomic.commit();
    queued += noAnswers.length;
  }

  return { queued };
}

// ── Stats ────────────────────────────────────────────────────────────────────

export async function getReviewStats(orgId: OrgId): Promise<{
  pending: number;
  decided: number;
  pendingAuditCount: number;
}> {
  const db = await getKv();
  let pending = 0, decided = 0;
  const pendingFindings = new Set<string>();

  for await (const entry of db.list<ReviewItem>({ prefix: orgKey(orgId, "review-pending") })) {
    pending++;
    pendingFindings.add(entry.value.findingId);
  }
  // Items claimed by a reviewer are moved to `review-active`; they're still
  // outstanding work from a dashboard POV, so roll them into `pending`.
  for await (const entry of db.list<ReviewItem>({ prefix: orgKey(orgId, "review-active") })) {
    pending++;
    pendingFindings.add(entry.value.findingId);
  }
  for await (const _entry of db.list({ prefix: orgKey(orgId, "review-decided") })) {
    decided++;
  }
  return { pending, decided, pendingAuditCount: pendingFindings.size };
}

// ── Reviewed finding IDs ─────────────────────────────────────────────────────

export async function getReviewedFindingIds(orgId: OrgId): Promise<Set<string>> {
  const db = await getKv();
  const ids = new Set<string>();
  const iter = db.list<{ reviewedAt: string }>({ prefix: orgKey(orgId, "review-done") });
  for await (const entry of iter) {
    const key = entry.key as Deno.KvKeyPart[];
    ids.add(String(key[key.length - 1]));
  }
  return ids;
}

// ── Clear queue ──────────────────────────────────────────────────────────────

export async function clearReviewQueue(orgId: OrgId): Promise<{ cleared: number }> {
  const db = await getKv();
  let cleared = 0;
  for await (const entry of db.list({ prefix: orgKey(orgId, "review-pending") })) {
    await db.delete(entry.key);
    cleared++;
  }
  for await (const entry of db.list({ prefix: orgKey(orgId, "review-active") })) {
    await db.delete(entry.key);
    cleared++;
  }
  return { cleared };
}

// ── Legacy-compatible aliases (preserve controller dynamic-import call sites) ─

export const claimNextItemLegacy = claimNextItem;
export const undoDecisionLegacy = undoDecision;
export const previewFindingLegacy = previewFinding;
export const backfillFromFinishedLegacy = backfillFromFinished;
export const adminFlipFindingLegacy = adminFlipFinding;
