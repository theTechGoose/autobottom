/** Review queue service — FIFO ordering, claim/decide/back logic.
 *  Pure business logic for queue operations. Firestore-backed via setStored*.
 *
 *  Atomic ops in main are downgraded to read-modify-write — race windows are
 *  acceptable given typical reviewer concurrency and idempotent finalize. */

import {
  getStored, setStored, deleteStored, listStoredWithKeys,
} from "@core/data/firestore/mod.ts";
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
import { fireWebhook } from "@admin/domain/data/admin-repository/mod.ts";

const ACTIVE_TTL = 30 * 60 * 1000;

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
  const noAnswers = answeredQuestions
    .map((q, i) => ({ ...q, index: i }))
    .filter((q) => q.answer === "No");

  if (noAnswers.length === 0) return;

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
    await setStored("review-pending", orgId, [findingId, q.index], item);
  }
  await setStored("review-audit-pending", orgId, [findingId], noAnswers.length);
  console.log(`✅ [REVIEW] ${findingId}: Queued ${noAnswers.length} items for review`);
}

// ── FIFO selection (pure) ───────────────────────────────────────────────────

export interface PendingItem<T = ReviewItem> {
  key: string[];
  value: T;
}

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

// ── Claim Next Item ─────────────────────────────────────────────────────────

async function enrichItem(
  orgId: OrgId,
  item: ReviewItem,
  sharedTranscript?: BufferItem["transcript"],
): Promise<BufferItem> {
  const transcript = sharedTranscript !== undefined
    ? sharedTranscript
    : await getTranscript(orgId, item.findingId);
  const counterVal = (await getStored<number>("review-audit-pending", orgId, item.findingId)) ?? 0;
  return { ...item, auditRemaining: counterVal, transcript };
}

export async function claimNextItem(
  orgId: OrgId,
  reviewer: string,
  allowedTypes?: string[],
): Promise<{ buffer: BufferItem[]; remaining: number }> {
  const now = Date.now();

  // 1. Sweep expired active claims from OTHER reviewers back to pending
  const allActive = await listStoredWithKeys<ReviewItem & { claimedAt: number }>("review-active", orgId);
  for (const { key, value } of allActive) {
    if (key[0] === reviewer) continue;
    if (value.claimedAt && (now - value.claimedAt) > ACTIVE_TTL) {
      const { claimedAt: _, ...baseItem } = value;
      await setStored("review-pending", orgId, [value.findingId, value.questionIndex], baseItem as ReviewItem);
      await deleteStored("review-active", orgId, ...key);
      console.log(`[REVIEW] Reclaimed expired active item ${value.findingId}/${value.questionIndex}`);
    }
  }

  // 2. Collect existing active items for this reviewer
  const myActive: ReviewItem[] = allActive
    .filter(({ key }) => key[0] === reviewer)
    .map(({ value }) => {
      const { claimedAt: _, ...rest } = value;
      return rest as ReviewItem;
    });

  // 3. Legacy migration: if active items span multiple findings, keep the largest cluster
  if (myActive.length > 0) {
    const findingCounts = new Map<string, number>();
    for (const item of myActive) findingCounts.set(item.findingId, (findingCounts.get(item.findingId) ?? 0) + 1);
    if (findingCounts.size > 1) {
      let bestFid = ""; let bestCount = 0;
      for (const [fid, count] of findingCounts) { if (count > bestCount) { bestFid = fid; bestCount = count; } }
      for (const item of myActive) {
        if (item.findingId !== bestFid) {
          await setStored("review-pending", orgId, [item.findingId, item.questionIndex], item);
          await deleteStored("review-active", orgId, reviewer, item.findingId, item.questionIndex);
        }
      }
      const kept = myActive.filter((i) => i.findingId === bestFid);
      myActive.length = 0;
      myActive.push(...kept);
      console.log(`[REVIEW] Legacy migration: kept ${kept.length} items for ${bestFid}, released rest`);
    }
  }

  // 4. If reviewer already has active items, return them (locked into this audit)
  if (myActive.length > 0) {
    myActive.sort((a, b) => a.reviewIndex - b.reviewIndex);
    const transcript = await getTranscript(orgId, myActive[0].findingId);
    const buffer: BufferItem[] = [];
    for (const item of myActive) buffer.push(await enrichItem(orgId, item, transcript));
    return { buffer, remaining: 0 };
  }

  // 5. No active items — claim ALL pending items for the OLDEST audit (FIFO by completedAt)
  const allPending = await listStoredWithKeys<ReviewItem>("review-pending", orgId);
  const findingTimestamps = new Map<string, number>();
  const pendingByFinding = new Map<string, Array<{ key: string[]; value: ReviewItem }>>();
  for (const row of allPending) {
    if (allowedTypes) {
      const isPackage = row.value.recordingIdField === "GenieNumber";
      const itemType = isPackage ? "package" : "date-leg";
      if (!allowedTypes.includes(itemType)) continue;
    }
    const fid = row.value.findingId;
    if (!pendingByFinding.has(fid)) pendingByFinding.set(fid, []);
    pendingByFinding.get(fid)!.push(row);
    const ts = row.value.completedAt ?? 0;
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

  // Non-atomic claim. Race: another reviewer could grab the same item. Acceptable.
  const claimed: ReviewItem[] = [];
  for (const { key, value } of pendingEntries) {
    await setStored("review-active", orgId, [reviewer, value.findingId, value.questionIndex], { ...value, claimedAt: now });
    await deleteStored("review-pending", orgId, ...key);
    claimed.push(value);
  }

  if (claimed.length === 0) return { buffer: [], remaining: 0 };

  claimed.sort((a, b) => a.reviewIndex - b.reviewIndex);
  const transcript = await getTranscript(orgId, claimed[0].findingId);
  const buffer: BufferItem[] = [];
  for (const item of claimed) buffer.push(await enrichItem(orgId, item, transcript));
  console.log(`[REVIEW] ${reviewer}: Claimed ${claimed.length} items for audit ${targetFindingId}`);
  return { buffer, remaining: 0 };
}

// ── Decision Recording ──────────────────────────────────────────────────────

export async function recordDecision(
  orgId: OrgId,
  findingId: string,
  questionIndex: number,
  decision: "confirm" | "flip",
  reviewer: string,
): Promise<{ remaining: number; auditComplete: boolean }> {
  const now = Date.now();

  // Load full item from active so the decided record includes header/populated/etc.
  let baseItem: ReviewItem | null = null;
  const activeVal = await getStored<ReviewItem & { claimedAt?: number }>("review-active", orgId, reviewer, findingId, questionIndex);
  if (activeVal) {
    const { claimedAt: _, ...rest } = activeVal;
    baseItem = rest as ReviewItem;
  } else {
    baseItem = await getStored<ReviewItem>("review-pending", orgId, findingId, questionIndex);
  }
  if (!baseItem) {
    baseItem = {
      findingId, questionIndex,
      reviewIndex: 0, totalForFinding: 0,
      header: "", populated: "", thinking: "", defense: "", answer: "No",
    };
  }

  const decisionRecord: ReviewDecision = { ...baseItem, decision, reviewer, decidedAt: now };
  await setStored("review-decided", orgId, [findingId, questionIndex], decisionRecord);

  // Undo index — keyed by reverse-chronological so listing gives newest first
  const undoIdxKey = String(9_000_000_000_000_000 - now).padStart(16, "0");
  await setStored("review-undo-idx", orgId, [reviewer, undoIdxKey], { findingId, questionIndex });

  await deleteStored("review-active", orgId, reviewer, findingId, questionIndex);

  const counter = (await getStored<number>("review-audit-pending", orgId, findingId)) ?? 1;
  const newCount = Math.max(0, counter - 1);
  await setStored("review-audit-pending", orgId, [findingId], newCount);

  console.log(`✅ [REVIEW] ${findingId}/${questionIndex}: ${decision} by ${reviewer} (${newCount} remaining)`);

  return { remaining: newCount, auditComplete: newCount <= 0 };
}

// ── Finalize Reviewed Audit ─────────────────────────────────────────────────

export async function finalizeReviewedAudit(
  orgId: OrgId,
  findingId: string,
  reviewer: string,
): Promise<void> {
  // Idempotency guard
  const existingDone = await getStored("review-done", orgId, findingId);
  if (existingDone) {
    console.log(`⏭️  [REVIEW] ${findingId}: already finalized, skipping`);
    return;
  }

  // Collect all decisions for this finding
  const allDecided = await listStoredWithKeys<ReviewDecision>("review-decided", orgId);
  const decisions = new Map<number, ReviewDecision>();
  for (const { key, value } of allDecided) {
    if (key[0] !== findingId) continue;
    if (value?.questionIndex != null) decisions.set(value.questionIndex, value);
  }
  if (decisions.size === 0) {
    console.warn(`⚠️  [REVIEW] ${findingId}: no decisions found at finalize — skipping`);
    return;
  }

  // Findings are chunk-stored; under a duplicate-call window the first read
  // can land between chunk writes. Retry a few times.
  let finding = await getFinding(orgId, findingId);
  for (let attempt = 1; attempt <= 3 && !finding; attempt++) {
    await new Promise((r) => setTimeout(r, 200 * attempt));
    finding = await getFinding(orgId, findingId);
  }
  if (!finding) {
    console.error(`❌ [REVIEW] ${findingId}: finding not found at finalize (after retries)`);
    return;
  }

  const answered: Array<Record<string, unknown>> = Array.isArray(finding.answeredQuestions)
    ? [...finding.answeredQuestions]
    : [];
  for (const [qIndex, d] of decisions) {
    if (qIndex < 0 || qIndex >= answered.length) continue;
    const prev = answered[qIndex] ?? {};
    const nextAnswer = d.decision === "flip" ? "Yes" : (prev as { answer?: string }).answer;
    answered[qIndex] = {
      ...prev,
      answer: nextAnswer,
      reviewAction: d.decision,
      reviewedBy: d.reviewer,
      reviewedAt: d.decidedAt,
    };
  }

  const total = answered.length || 1;
  const yeses = answered.filter((q) => String((q as { answer?: string }).answer ?? "").toLowerCase().startsWith("y")).length;
  const reviewScore = Math.round((yeses / total) * 100);
  const reviewedAt = Date.now();

  const correctedFinding = {
    ...finding,
    answeredQuestions: answered,
    reviewedAt,
    reviewScore,
  };
  await saveFinding(orgId, correctedFinding);

  await setStored("review-done", orgId, [findingId], { reviewedAt: new Date(reviewedAt).toISOString(), reviewScore, reviewedBy: reviewer });

  await writeAuditDoneIndex(orgId, {
    findingId,
    completedAt: reviewedAt,
    doneAt: reviewedAt,
    completed: true,
    reason: "reviewed",
    score: reviewScore,
    recordId: (finding.recordId ?? finding.record?.RelatedDestinationId ?? finding.record?.GenieNumber ?? "") as string,
    isPackage: finding.recordingIdField === "GenieNumber",
    reviewedBy: reviewer,
  });

  await updateCompletedStatScore(orgId, findingId, reviewScore);

  console.log(`✅ [REVIEW] ${findingId}: finalized score=${reviewScore}% (${yeses}/${total} yes) reviewer=${reviewer}`);

  await fireWebhook(orgId, "terminate", {
    findingId,
    finding: correctedFinding,
    correctedAnswers: answered,
    reviewedAt,
    reviewedBy: reviewer,
    reviewScore,
  });
}

// ── Undo Decision ───────────────────────────────────────────────────────────

export async function undoDecision(
  orgId: OrgId,
  reviewer: string,
  allowedTypes?: string[],
): Promise<{ buffer: BufferItem[]; remaining: number }> {
  // Determine current audit findingId from active items
  const myActive = await listStoredWithKeys<ReviewItem & { claimedAt: number }>("review-active", orgId);
  let currentFindingId: string | null = null;
  for (const { key, value } of myActive) {
    if (key[0] === reviewer) { currentFindingId = value.findingId; break; }
  }

  // Walk undo index newest-first looking for an eligible decided entry
  const undoRows = await listStoredWithKeys<{ findingId: string; questionIndex: number }>("review-undo-idx", orgId);
  const myUndo = undoRows.filter(({ key }) => key[0] === reviewer)
    // Keys in this index are reverse-chronological strings; sort ascending → newest first
    .sort((a, b) => String(a.key[1]).localeCompare(String(b.key[1])));

  let chosenDecided: { key: string[]; value: ReviewDecision } | null = null;
  let chosenUndoIdx: string[] | null = null;
  for (const { key, value } of myUndo.slice(0, 20)) {
    const { findingId: fid, questionIndex: qIdx } = value;
    if (currentFindingId && fid !== currentFindingId) continue;
    const counterCheck = await getStored<number>("review-audit-pending", orgId, fid);
    if (counterCheck === null) continue;
    const candidate = await getStored<ReviewDecision>("review-decided", orgId, fid, qIdx);
    if (!candidate || candidate.reviewer !== reviewer) continue;
    chosenDecided = { key: [fid, String(qIdx)], value: candidate };
    chosenUndoIdx = key;
    break;
  }

  // Fallback: full scan scoped to current finding
  if (!chosenDecided) {
    const decidedRows = await listStoredWithKeys<ReviewDecision>("review-decided", orgId);
    const myDecisions = decidedRows.filter(({ value }) =>
      value.reviewer === reviewer && (!currentFindingId || value.findingId === currentFindingId)
    );
    myDecisions.sort((a, b) => b.value.decidedAt - a.value.decidedAt);
    for (const candidate of myDecisions) {
      const counterCheck = await getStored<number>("review-audit-pending", orgId, candidate.value.findingId);
      if (counterCheck !== null) {
        chosenDecided = { key: candidate.key, value: candidate.value };
        break;
      }
    }
  }

  if (!chosenDecided) return { buffer: [], remaining: 0 };

  const decided = chosenDecided.value;
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

  const counterVal = (await getStored<number>("review-audit-pending", orgId, findingId)) ?? 0;
  await deleteStored("review-decided", orgId, ...chosenDecided.key);
  await setStored("review-active", orgId, [reviewer, findingId, questionIndex], { ...item, claimedAt: Date.now() });
  await setStored("review-audit-pending", orgId, [findingId], counterVal + 1);
  if (chosenUndoIdx) await deleteStored("review-undo-idx", orgId, ...chosenUndoIdx);

  return claimNextItem(orgId, reviewer, allowedTypes);
}

// ── Admin-flip finding — set all "No" answers to "Yes" ──────────────────────

export async function adminFlipFinding(
  orgId: OrgId,
  findingId: string,
): Promise<{ success: boolean; score: number }> {
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

  // Clean up review queue entries for this finding
  let cleared = 0;
  const pending = await listStoredWithKeys("review-pending", orgId);
  for (const { key } of pending) {
    if (key[0] === findingId) { await deleteStored("review-pending", orgId, ...key); cleared++; }
  }
  const decided = await listStoredWithKeys("review-decided", orgId);
  for (const { key } of decided) {
    if (key[0] === findingId) { await deleteStored("review-decided", orgId, ...key); cleared++; }
  }
  const active = await listStoredWithKeys<{ findingId?: string }>("review-active", orgId);
  for (const { key, value } of active) {
    if (value?.findingId === findingId) { await deleteStored("review-active", orgId, ...key); cleared++; }
  }
  await deleteStored("review-audit-pending", orgId, findingId); cleared++;

  await setStored("review-done", orgId, [findingId], { reviewedAt: new Date().toISOString() });

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

  console.log(`[ADMIN-FLIP] ✅ ${findingId} → 100% (${cleared} queue entries removed)`);
  return { success: true, score };
}

// ── Preview finding ─────────────────────────────────────────────────────────

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

// ── Backfill review queue from finished findings ────────────────────────────

export async function backfillFromFinished(orgId: OrgId): Promise<{ queued: number }> {
  let queued = 0;

  // List all audit-finding header docs (key length === 1, not chunks)
  const findingDocs = await listStoredWithKeys<unknown>("audit-finding", orgId);
  const findingIds = new Set<string>();
  for (const { key } of findingDocs) {
    // Skip chunk docs (their key has more parts than just findingId)
    if (key.length === 1) findingIds.add(String(key[0]));
  }

  for (const findingId of findingIds) {
    const finding = await getFinding(orgId, findingId);
    if (!finding) continue;
    if (finding.findingStatus !== "finished") continue;
    if (!finding.answeredQuestions?.length) continue;

    // Skip if review queue already has a counter for this finding
    const existingCounter = await getStored("review-audit-pending", orgId, findingId);
    if (existingCounter !== null) continue;

    // Skip if any decided items exist for this finding
    const allDecided = await listStoredWithKeys("review-decided", orgId);
    const hasDecided = allDecided.some(({ key }) => key[0] === findingId);
    if (hasDecided) continue;

    const noAnswers = (finding.answeredQuestions as any[])
      .map((q: any, i: number) => ({ ...q, index: i }))
      .filter((q: any) => q.answer === "No");
    if (noAnswers.length === 0) continue;

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
      await setStored("review-pending", orgId, [findingId, q.index], item);
    }
    await setStored("review-audit-pending", orgId, [findingId], noAnswers.length);
    queued += noAnswers.length;
  }

  return { queued };
}

// ── Stats ────────────────────────────────────────────────────────────────────

export async function getReviewStats(orgId: OrgId): Promise<{
  pending: number;
  decided: number;
  pendingAuditCount: number;
  dateLegPending: number;
  dateLegDecided: number;
  packagePending: number;
  packageDecided: number;
}> {
  let dateLegPending = 0, packagePending = 0;
  let dateLegDecided = 0, packageDecided = 0;
  const pendingFindings = new Set<string>();

  const bumpPending = (item: ReviewItem) => {
    if (item.recordingIdField === "GenieNumber") packagePending++;
    else dateLegPending++;
    pendingFindings.add(item.findingId);
  };

  const pending = await listStoredWithKeys<ReviewItem>("review-pending", orgId);
  for (const { value } of pending) bumpPending(value);
  const active = await listStoredWithKeys<ReviewItem>("review-active", orgId);
  for (const { value } of active) bumpPending(value);
  const decided = await listStoredWithKeys<ReviewItem>("review-decided", orgId);
  for (const { value } of decided) {
    if (value.recordingIdField === "GenieNumber") packageDecided++;
    else dateLegDecided++;
  }

  return {
    pending: dateLegPending + packagePending,
    decided: dateLegDecided + packageDecided,
    pendingAuditCount: pendingFindings.size,
    dateLegPending, dateLegDecided,
    packagePending, packageDecided,
  };
}

// ── Reviewed finding IDs ─────────────────────────────────────────────────────

export async function getReviewedFindingIds(orgId: OrgId): Promise<Set<string>> {
  const ids = new Set<string>();
  const rows = await listStoredWithKeys<{ reviewedAt: string }>("review-done", orgId);
  for (const { key } of rows) ids.add(String(key[0]));
  return ids;
}

// ── Clear queue ──────────────────────────────────────────────────────────────

export async function clearReviewQueue(orgId: OrgId): Promise<{ cleared: number }> {
  let cleared = 0;
  for (const { key } of await listStoredWithKeys("review-pending", orgId)) {
    await deleteStored("review-pending", orgId, ...key); cleared++;
  }
  for (const { key } of await listStoredWithKeys("review-active", orgId)) {
    await deleteStored("review-active", orgId, ...key); cleared++;
  }
  return { cleared };
}

// ── Legacy aliases ──────────────────────────────────────────────────────────

export const claimNextItemLegacy = claimNextItem;
export const undoDecisionLegacy = undoDecision;
export const previewFindingLegacy = previewFinding;
export const backfillFromFinishedLegacy = backfillFromFinished;
export const adminFlipFindingLegacy = adminFlipFinding;
