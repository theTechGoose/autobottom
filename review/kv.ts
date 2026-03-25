/** Review-specific KV operations: queue, locks, settings, completion. All keys are org-scoped. */

import { orgKey } from "../lib/org.ts";
import type { OrgId } from "../lib/org.ts";
import { getFinding, saveFinding, getAllAnswersForFinding, saveBatchAnswers, getTranscript, backfillUtteranceTimes, fireWebhook, getBadgeStats, updateBadgeStats, getEarnedBadges, awardBadge, awardXp, writeAuditDoneIndex, updateCompletedStatScore, getWireDeductionEntry, saveWireDeductionEntry } from "../lib/kv.ts";
import { populateManagerQueue } from "../manager/kv.ts";
import { checkBadges, BADGE_CATALOG } from "../shared/badges.ts";
import type { BadgeDef } from "../shared/badges.ts";

let _kv: Deno.Kv | undefined;

async function kv(): Promise<Deno.Kv> {
  if (!_kv) _kv = await Deno.openKv(Deno.env.get("KV_URL") ?? undefined);
  return _kv;
}

// -- Types --

export interface ReviewItem {
  findingId: string;
  questionIndex: number;
  reviewIndex: number;       // 1-based position within this finding's failed questions
  totalForFinding: number;   // total failed questions for this finding
  header: string;
  populated: string;
  thinking: string;
  defense: string;
  answer: string;
  recordingIdField?: string; // "GenieNumber" = package, absent/other = date leg
  recordId?: string;         // QB record ID for direct link
  recordMeta?: {
    // Date leg (internal)
    guestName?: string;
    spouseName?: string;
    maritalStatus?: string;
    roomTypeMaxOccupancy?: string;
    destination?: string;
    arrivalDate?: string;
    departureDate?: string;
    totalWGS?: string;
    totalMCC?: string;
    // Package (partner)
    officeName?: string;
    totalAmountPaid?: string;
    hasMCC?: string;
    mspSubscription?: string;
  };
}

export interface ReviewDecision extends ReviewItem {
  decision: "confirm" | "flip";
  reviewer: string;
  decidedAt: number;
}

export interface ReviewerLeaderboardEntry {
  reviewer: string;
  decisions: number;
  confirms: number;
  flips: number;
  flipRate: string;
}

export interface ReviewerDashboardData {
  queue: { pending: number; decided: number; pendingAuditCount: number };
  personal: {
    totalDecisions: number;
    confirmCount: number;
    flipCount: number;
    avgDecisionSpeedMs: number;
  };
  byReviewer: ReviewerLeaderboardEntry[];
  recentDecisions: ReviewDecision[];
}

// -- Queue Population --

export async function populateReviewQueue(
  orgId: OrgId,
  findingId: string,
  answeredQuestions: Array<{ answer: string; header: string; populated: string; thinking: string; defense: string }>,
  recordingIdField?: string,
  recordId?: string,
  recordMeta?: ReviewItem["recordMeta"],
) {
  const db = await kv();
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
      ...(recordingIdField ? { recordingIdField } : {}),
      ...(recordId ? { recordId } : {}),
      ...(recordMeta ? { recordMeta } : {}),
    };
    atomic.set(orgKey(orgId, "review-pending", findingId, q.index), item);
  }
  atomic.set(orgKey(orgId, "review-audit-pending", findingId), noAnswers.length);
  await atomic.commit();

  console.log(`[REVIEW] ${findingId}: Queued ${noAnswers.length} items for review`);
}

// -- Badge Check Helper --

async function doBadgeCheck(
  orgId: OrgId, reviewer: string,
  clientCombo?: number, clientLevel?: number, decisionSpeedMs?: number,
): Promise<BadgeDef[]> {
  const stats = await getBadgeStats(orgId, reviewer);
  stats.totalDecisions++;
  if (clientCombo != null && clientCombo > stats.bestCombo) stats.bestCombo = clientCombo;
  if (clientLevel != null && clientLevel > stats.level) stats.level = clientLevel;
  if (decisionSpeedMs != null && decisionSpeedMs > 0) {
    const total = stats.avgSpeedMs * stats.decisionsForAvg + decisionSpeedMs;
    stats.decisionsForAvg++;
    stats.avgSpeedMs = Math.round(total / stats.decisionsForAvg);
  }
  const today = new Date().toISOString().slice(0, 10);
  if (stats.lastActiveDate !== today) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    stats.dayStreak = stats.lastActiveDate === yesterday ? stats.dayStreak + 1 : 1;
    stats.lastActiveDate = today;
  }
  await updateBadgeStats(orgId, reviewer, stats);
  const earned = await getEarnedBadges(orgId, reviewer);
  const earnedSet = new Set(earned.map((b) => b.badgeId));
  const newBadges = checkBadges("reviewer", stats, earnedSet);
  let badgeXp = 0;
  for (const badge of newBadges) {
    await awardBadge(orgId, reviewer, badge);
    badgeXp += badge.xpReward;
  }
  await awardXp(orgId, reviewer, 10 + badgeXp, "reviewer");
  return newBadges;
}

// -- Claim Next Item --
// Design: items are atomically MOVED from review-pending → review-active/{reviewer}
// on claim. Once moved, no other reviewer can see it. No locks needed.

const ACTIVE_TTL = 30 * 60 * 1000; // 30 minutes — abandoned claims expire back to available pool

export const BUFFER_SIZE = 5;

export interface BufferItem extends ReviewItem {
  auditRemaining: number;
  transcript: { raw: string; diarized: string; utteranceTimes?: number[] } | null;
}

export async function claimNextItem(orgId: OrgId, reviewer: string, allowedTypes?: string[]): Promise<{
  buffer: BufferItem[];
  remaining: number;
}> {
  const db = await kv();
  const now = Date.now();

  // Helper: atomically claim up to `count` items from pending, optionally filtering by type
  async function claimFromPending(count: number): Promise<ReviewItem[]> {
    const claimed: ReviewItem[] = [];
    const iter = db.list<ReviewItem>({ prefix: orgKey(orgId, "review-pending") });
    for await (const entry of iter) {
      // Type filter: "GenieNumber" = package, anything else = date-leg
      if (allowedTypes) {
        const isPackage = entry.value.recordingIdField === "GenieNumber";
        const itemType = isPackage ? "package" : "date-leg";
        if (!allowedTypes.includes(itemType)) continue;
      }
      const activeKey = orgKey(orgId, "review-active", reviewer, entry.value.findingId, entry.value.questionIndex);
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

  // Helper: enrich a ReviewItem into a BufferItem (add transcript + auditRemaining)
  async function enrich(item: ReviewItem): Promise<BufferItem> {
    let transcript = await getTranscript(orgId, item.findingId);
    if (transcript && !transcript.utteranceTimes?.length) {
      transcript = await backfillUtteranceTimes(orgId, item.findingId, transcript);
    }
    const counterEntry = await db.get<number>(orgKey(orgId, "review-audit-pending", item.findingId));
    return { ...item, auditRemaining: counterEntry.value ?? 0, transcript };
  }

  // 1. Sweep expired active claims from OTHER reviewers back to pending
  const allActiveIter = db.list<ReviewItem & { claimedAt: number }>({
    prefix: orgKey(orgId, "review-active"),
  });
  for await (const entry of allActiveIter) {
    const val = entry.value;
    // Skip this reviewer's own items
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

  // 3. Top up from pending if needed
  if (activeItems.length < BUFFER_SIZE) {
    const more = await claimFromPending(BUFFER_SIZE - activeItems.length);
    activeItems.push(...more);
  }

  // 4. Enrich all items with transcript + auditRemaining
  const buffer: BufferItem[] = [];
  for (const item of activeItems) {
    buffer.push(await enrich(item));
  }

  return { buffer, remaining: 0 };
}

// -- Record Decision --

export async function recordDecision(
  orgId: OrgId,
  findingId: string,
  questionIndex: number,
  decision: "confirm" | "flip",
  reviewer: string,
  clientCombo?: number,
  clientLevel?: number,
  decisionSpeedMs?: number,
): Promise<{ success: boolean; auditComplete: boolean; newBadges: BadgeDef[] }> {
  const db = await kv();

  // Load active item for this reviewer
  const activeKey = orgKey(orgId, "review-active", reviewer, findingId, questionIndex);
  const activeEntry = await db.get<ReviewItem & { claimedAt: number }>(activeKey);
  if (!activeEntry.value) {
    // Fallback: check review-pending directly (undo path restores to pending with a lock)
    const pendingKey = orgKey(orgId, "review-pending", findingId, questionIndex);
    const pendingEntry = await db.get<ReviewItem>(pendingKey);
    if (!pendingEntry.value) {
      console.log(`[REVIEW] recordDecision REJECTED: no active/pending entry for ${findingId}/${questionIndex}`);
      return { success: false, auditComplete: false, newBadges: [] };
    }
    // Use pending path (legacy compat / undo restore)
    const decided: ReviewDecision = { ...pendingEntry.value, decision, reviewer, decidedAt: Date.now() };
    const counterKey = orgKey(orgId, "review-audit-pending", findingId);
    const counterEntry = await db.get<number>(counterKey);
    const currentCount = counterEntry.value ?? 1;
    const newCount = currentCount - 1;
    const undoIdxKey = orgKey(orgId, "review-undo-idx", reviewer, String(9_000_000_000_000_000 - decided.decidedAt).padStart(16, "0"));
    const atomic = db.atomic()
      .check(pendingEntry)
      .delete(pendingKey)
      .delete(orgKey(orgId, "review-lock", findingId, questionIndex))
      .set(orgKey(orgId, "review-decided", findingId, questionIndex), decided)
      .set(undoIdxKey, { findingId, questionIndex });
    if (newCount <= 0) atomic.delete(counterKey);
    else atomic.set(counterKey, newCount);
    const res = await atomic.commit();
    if (!res.ok) {
      console.log(`[REVIEW] recordDecision REJECTED: atomic commit failed (pending path) for ${findingId}/${questionIndex}`);
      return { success: false, auditComplete: false, newBadges: [] };
    }
    console.log(`[REVIEW] recordDecision OK (pending path): ${findingId}/${questionIndex} = ${decision}`);
    const auditComplete = newCount <= 0;
    if (auditComplete) {
      postCorrectedAudit(orgId, findingId).catch((err) => console.error(`[REVIEW] ${findingId}: Completion POST failed:`, err));
      populateManagerQueue(orgId, findingId).catch((err) => console.error(`[REVIEW] ${findingId}: Manager queue population failed:`, err));
    }
    // Badge checking still runs below
    let newBadges: BadgeDef[] = [];
    try { newBadges = await doBadgeCheck(orgId, reviewer, clientCombo, clientLevel, decisionSpeedMs); } catch {}
    return { success: true, auditComplete, newBadges };
  }

  // Normal active path: delete active item, write decided
  const { claimedAt: _, ...baseItem } = activeEntry.value;
  const decided: ReviewDecision = {
    ...baseItem as ReviewItem,
    decision,
    reviewer,
    decidedAt: Date.now(),
  };

  // Load current counter
  const counterKey = orgKey(orgId, "review-audit-pending", findingId);
  const counterEntry = await db.get<number>(counterKey);
  const currentCount = counterEntry.value ?? 1;
  const newCount = currentCount - 1;

  // Write decided + secondary undo index + delete active + update counter
  const undoIdxKey = orgKey(orgId, "review-undo-idx", reviewer, String(9_000_000_000_000_000 - decided.decidedAt).padStart(16, "0"));
  const atomic = db.atomic()
    .check(activeEntry)
    .delete(activeKey)
    .set(orgKey(orgId, "review-decided", findingId, questionIndex), decided)
    .set(undoIdxKey, { findingId, questionIndex });

  if (newCount <= 0) {
    atomic.delete(counterKey);
  } else {
    atomic.set(counterKey, newCount);
  }

  const res = await atomic.commit();
  if (!res.ok) {
    console.log(`[REVIEW] recordDecision REJECTED: atomic commit failed for ${findingId}/${questionIndex}`);
    return { success: false, auditComplete: false, newBadges: [] };
  }

  console.log(`[REVIEW] recordDecision OK: ${findingId}/${questionIndex} = ${decision}`);

  const auditComplete = newCount <= 0;

  if (auditComplete) {
    postCorrectedAudit(orgId, findingId).catch((err) =>
      console.error(`[REVIEW] ${findingId}: Completion POST failed:`, err)
    );
    populateManagerQueue(orgId, findingId).catch((err) =>
      console.error(`[REVIEW] ${findingId}: Manager queue population failed:`, err)
    );
  }

  let newBadges: BadgeDef[] = [];
  try { newBadges = await doBadgeCheck(orgId, reviewer, clientCombo, clientLevel, decisionSpeedMs); } catch (err) {
    console.error(`[REVIEW] Badge check error for ${reviewer}:`, err);
  }

  return { success: true, auditComplete, newBadges };
}

// -- Go Back (Undo) --

export async function undoDecision(
  orgId: OrgId,
  reviewer: string,
  allowedTypes?: string[],
): Promise<{
  buffer: BufferItem[];
  remaining: number;
}> {
  const db = await kv();

  // Release all current active items held by this reviewer (put them back in pending)
  const activeIter = db.list<ReviewItem & { claimedAt: number }>({
    prefix: orgKey(orgId, "review-active", reviewer),
  });
  for await (const entry of activeIter) {
    const { claimedAt: _, ...baseItem } = entry.value;
    await db.atomic()
      .check(entry)
      .delete(entry.key)
      .set(orgKey(orgId, "review-pending", entry.value.findingId, entry.value.questionIndex), baseItem as ReviewItem)
      .commit();
  }

  // Fast path: use per-reviewer secondary index (negated-ts keys = newest first lexicographically)
  let decidedEntry: Deno.KvEntry<ReviewDecision> | null = null;
  let undoIdxEntryKey: Deno.KvKey | null = null;

  const idxIter = db.list<{ findingId: string; questionIndex: number }>(
    { prefix: orgKey(orgId, "review-undo-idx", reviewer) },
    { limit: 20 },
  );
  for await (const idxEntry of idxIter) {
    const { findingId: fid, questionIndex: qIdx } = idxEntry.value;
    const counterCheck = await db.get<number>(orgKey(orgId, "review-audit-pending", fid));
    if (counterCheck.value === null) continue;
    const candidate = await db.get<ReviewDecision>(orgKey(orgId, "review-decided", fid, qIdx));
    if (!candidate.value || candidate.value.reviewer !== reviewer) continue;
    decidedEntry = candidate;
    undoIdxEntryKey = idxEntry.key;
    break;
  }

  // Fallback: full scan for decisions made before the index was introduced
  if (!decidedEntry) {
    const myDecisions: { entry: Deno.KvEntry<ReviewDecision>; decidedAt: number }[] = [];
    const decidedIter = db.list<ReviewDecision>({ prefix: orgKey(orgId, "review-decided") });
    for await (const entry of decidedIter) {
      if (entry.value.reviewer === reviewer) myDecisions.push({ entry, decidedAt: entry.value.decidedAt });
    }
    myDecisions.sort((a, b) => b.decidedAt - a.decidedAt);
    for (const candidate of myDecisions) {
      const counterCheck = await db.get<number>(orgKey(orgId, "review-audit-pending", candidate.entry.value.findingId));
      if (counterCheck.value !== null) { decidedEntry = candidate.entry; break; }
    }
  }

  if (!decidedEntry) {
    return { buffer: [], remaining: 0 };
  }

  const decided = decidedEntry.value;
  const { findingId, questionIndex } = decided;
  const item: ReviewItem = {
    findingId: decided.findingId,
    questionIndex: decided.questionIndex,
    reviewIndex: decided.reviewIndex ?? 1,
    totalForFinding: decided.totalForFinding ?? 1,
    header: decided.header,
    populated: decided.populated,
    thinking: decided.thinking,
    defense: decided.defense,
    answer: decided.answer,
    ...(decided.recordingIdField ? { recordingIdField: decided.recordingIdField } : {}),
    ...(decided.recordId ? { recordId: decided.recordId } : {}),
  };

  // Move back: delete decided → active (assigned to this reviewer), increment counter
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
  if (!res.ok) {
    return { buffer: [], remaining: 0 };
  }

  // Now use claimNextItem to get the full buffer (restored item is first active)
  return claimNextItem(orgId, reviewer, allowedTypes);
}

// -- Audit Completion POST --

async function postCorrectedAudit(orgId: OrgId, findingId: string) {
  const db = await kv();

  const finding = await getFinding(orgId, findingId);
  if (!finding) {
    console.error(`[REVIEW] ${findingId}: Finding not found for completion POST`);
    return;
  }

  const allAnswers = await getAllAnswersForFinding(orgId, findingId);

  // Load all decided items for this finding
  const decisions: ReviewDecision[] = [];
  const iter = db.list<ReviewDecision>({ prefix: orgKey(orgId, "review-decided", findingId) });
  for await (const entry of iter) {
    decisions.push(entry.value);
  }

  // Apply flips: change answer from "No" to "Yes" for flipped decisions
  const correctedAnswers = allAnswers.map((a: any, i: number) => {
    const decision = decisions.find((d) => d.questionIndex === i);
    if (decision?.decision === "flip") {
      return { ...a, answer: "Yes", reviewedBy: decision.reviewer, reviewAction: "flip" };
    }
    if (decision?.decision === "confirm") {
      return { ...a, reviewedBy: decision.reviewer, reviewAction: "confirm" };
    }
    return a;
  });

  const reviewedAt = new Date().toISOString();
  const yeses = correctedAnswers.filter((a: any) => a.answer === "Yes").length;
  const score = correctedAnswers.length > 0 ? Math.round((yeses / correctedAnswers.length) * 100) : 0;

  // Save corrected answers back to the finding AND overwrite batch KV.
  // The report page calls getAllAnswersForFinding which reads batch keys first;
  // if we only update finding.answeredQuestions the report still shows stale data.
  finding.answeredQuestions = correctedAnswers;
  (finding as Record<string, unknown>).reviewedAt = reviewedAt;
  (finding as Record<string, unknown>).reviewScore = score;
  await saveFinding(orgId, finding);
  // Write all corrected answers into batch 0 (single source of truth going forward).
  await saveBatchAnswers(orgId, findingId, 0, correctedAnswers);
  // Delete any remaining batch keys (1+) so getAllAnswersForFinding stops scanning at batch 0.
  // ChunkedKv uses a "_n" sentinel key; deleting it makes get() return null (i.e. "no more batches").
  for (let i = 1; i < 50; i++) {
    const sentinel = await db.get([...orgKey(orgId, "audit-answers", findingId, i), "_n"]);
    if (sentinel.value == null) break;
    await db.delete([...orgKey(orgId, "audit-answers", findingId, i), "_n"]);
  }
  // Mark this finding as reviewed so admin views can show a badge
  await db.set(orgKey(orgId, "review-done", findingId), { reviewedAt });

  // Update secondary index — audit is now fully done
  const completedAt = (finding as Record<string, unknown>).completedAt as number | undefined;
  if (completedAt) {
    try {
      await writeAuditDoneIndex(orgId, {
        findingId,
        completedAt,
        score,
        completed: true,
        doneAt: Date.now(),
        reason: "reviewed",
        recordId: String((finding as any)?.record?.RecordId ?? "") || undefined,
      });
    } catch (err) {
      console.error(`[REVIEW] ${findingId}: ❌ audit-done-idx update failed:`, err);
    }
  }

  // Update the audit history stat so the score reflects the reviewed result
  await updateCompletedStatScore(orgId, findingId, score);

  // Update wire deduction entry if this is a package (partner) audit
  const isPackage = (finding as any).recordingIdField === "GenieNumber";
  if (isPackage) {
    try {
      const wireEntry = await getWireDeductionEntry(orgId, findingId);
      if (wireEntry) {
        const totalSuccess = correctedAnswers.filter((a: any) => a.answer === "Yes").length;
        await saveWireDeductionEntry(orgId, { ...wireEntry, score, totalSuccess, questionsAudited: correctedAnswers.length });
        console.log(`[REVIEW] ${findingId}: 📋 wireDeductionEntry updated — score=${score}% totalSuccess=${totalSuccess}`);
      }
    } catch (err) {
      console.error(`[REVIEW] ${findingId}: ❌ wireDeductionEntry update failed:`, err);
    }
  }

  console.log(`[REVIEW] ${findingId}: ✅ Saved corrected finding — ${yeses}/${correctedAnswers.length} Yes = ${score}%`);

  await fireWebhook(orgId, "terminate", {
    findingId,
    finding: { ...finding, answeredQuestions: correctedAnswers },
    correctedAnswers,
    reviewedAt,
  });
}

// -- Stats --

export async function getReviewStats(orgId: OrgId): Promise<{
  pending: number; decided: number;
  pendingAuditCount: number;
  dateLegPending: number; packagePending: number;
  dateLegDecided: number; packageDecided: number;
  dateLegPendingFindings: number; packagePendingFindings: number;
}> {
  const db = await kv();
  let pending = 0, decided = 0;
  let dateLegPending = 0, packagePending = 0;
  let dateLegDecided = 0, packageDecided = 0;
  const pendingAudits = new Set<string>();
  const dateLegPendingFindingSet = new Set<string>();
  const packagePendingFindingSet = new Set<string>();

  for await (const entry of db.list<ReviewItem>({ prefix: orgKey(orgId, "review-pending") })) {
    pending++;
    const fId = entry.value?.findingId || (entry.key[2] as string);
    if (fId) pendingAudits.add(fId);
    if (entry.value?.recordingIdField === "GenieNumber") { packagePending++; if (fId) packagePendingFindingSet.add(fId); }
    else { dateLegPending++; if (fId) dateLegPendingFindingSet.add(fId); }
  }
  // Active items count as pending (in-progress, not yet decided)
  for await (const entry of db.list<ReviewItem>({ prefix: orgKey(orgId, "review-active") })) {
    pending++;
    const fId = entry.value?.findingId || (entry.key[3] as string);
    if (fId) pendingAudits.add(fId);
    if (entry.value?.recordingIdField === "GenieNumber") { packagePending++; if (fId) packagePendingFindingSet.add(fId); }
    else { dateLegPending++; if (fId) dateLegPendingFindingSet.add(fId); }
  }
  for await (const entry of db.list<ReviewItem>({ prefix: orgKey(orgId, "review-decided") })) {
    decided++;
    if (entry.value?.recordingIdField === "GenieNumber") packageDecided++;
    else dateLegDecided++;
  }

  return {
    pending, decided, pendingAuditCount: pendingAudits.size,
    dateLegPending, packagePending, dateLegDecided, packageDecided,
    dateLegPendingFindings: dateLegPendingFindingSet.size,
    packagePendingFindings: packagePendingFindingSet.size,
  };
}

export async function listReviewQueueFindings(
  orgId: OrgId,
  type?: "date-leg" | "package",
  limit = 200,
): Promise<{ items: Array<{ findingId: string; recordId?: string; voName?: string }>; total: number }> {
  const db = await kv();
  const seen = new Map<string, { findingId: string; recordId?: string; voName?: string }>();

  const addEntry = (item: ReviewItem | null | undefined) => {
    if (!item?.findingId) return;
    const isPackage = item.recordingIdField === "GenieNumber";
    if (type === "date-leg" && isPackage) return;
    if (type === "package" && !isPackage) return;
    if (!seen.has(item.findingId)) {
      const name = item.recordMeta?.guestName || item.recordMeta?.officeName;
      seen.set(item.findingId, { findingId: item.findingId, recordId: item.recordId, voName: name });
    }
  };

  for await (const entry of db.list<ReviewItem>({ prefix: orgKey(orgId, "review-pending") })) addEntry(entry.value);
  for await (const entry of db.list<ReviewItem>({ prefix: orgKey(orgId, "review-active") })) addEntry(entry.value);

  const items = Array.from(seen.values());
  return { items: items.slice(0, limit), total: items.length };
}

// -- Reviewer Dashboard --

export async function getReviewerDashboardData(orgId: OrgId, reviewer: string): Promise<ReviewerDashboardData> {
  const db = await kv();

  // Count pending + active items and unique audits
  let pending = 0;
  const dashPendingAudits = new Set<string>();
  for await (const entry of db.list<ReviewItem>({ prefix: orgKey(orgId, "review-pending") })) {
    pending++;
    const fId = entry.value?.findingId || (entry.key[2] as string);
    if (fId) dashPendingAudits.add(fId);
  }
  for await (const entry of db.list<ReviewItem>({ prefix: orgKey(orgId, "review-active") })) {
    pending++;
    const fId = entry.value?.findingId || (entry.key[3] as string);
    if (fId) dashPendingAudits.add(fId);
  }

  // Scan all decided items -- build personal list + per-reviewer map
  const myDecisions: ReviewDecision[] = [];
  const byReviewerMap = new Map<string, { confirms: number; flips: number }>();
  let decided = 0;

  const iter = db.list<ReviewDecision>({ prefix: orgKey(orgId, "review-decided") });
  for await (const entry of iter) {
    decided++;
    const d = entry.value;

    // Per-reviewer aggregation
    let stats = byReviewerMap.get(d.reviewer);
    if (!stats) { stats = { confirms: 0, flips: 0 }; byReviewerMap.set(d.reviewer, stats); }
    if (d.decision === "confirm") stats.confirms++;
    else stats.flips++;

    // Personal decisions
    if (d.reviewer === reviewer) {
      myDecisions.push(d);
    }
  }

  // Personal stats
  myDecisions.sort((a, b) => a.decidedAt - b.decidedAt);
  const totalDecisions = myDecisions.length;
  const confirmCount = myDecisions.filter((d) => d.decision === "confirm").length;
  const flipCount = myDecisions.filter((d) => d.decision === "flip").length;

  let avgDecisionSpeedMs = 0;
  if (myDecisions.length >= 2) {
    let totalGap = 0;
    for (let i = 1; i < myDecisions.length; i++) {
      totalGap += myDecisions[i].decidedAt - myDecisions[i - 1].decidedAt;
    }
    avgDecisionSpeedMs = Math.round(totalGap / (myDecisions.length - 1));
  }

  // Leaderboard sorted by total decisions desc
  const byReviewer: ReviewerLeaderboardEntry[] = [];
  for (const [name, stats] of byReviewerMap) {
    const total = stats.confirms + stats.flips;
    byReviewer.push({
      reviewer: name,
      decisions: total,
      confirms: stats.confirms,
      flips: stats.flips,
      flipRate: total > 0 ? ((stats.flips / total) * 100).toFixed(1) + "%" : "0.0%",
    });
  }
  byReviewer.sort((a, b) => b.decisions - a.decisions);

  // Recent 50 personal decisions (most recent first)
  const recentDecisions = myDecisions.slice().reverse().slice(0, 50);

  return {
    queue: { pending, decided, pendingAuditCount: dashPendingAudits.size },
    personal: { totalDecisions, confirmCount, flipCount, avgDecisionSpeedMs },
    byReviewer,
    recentDecisions,
  };
}

// -- Reviewed Findings --

export async function getReviewedFindingIds(orgId: OrgId): Promise<Set<string>> {
  const db = await kv();
  const ids = new Set<string>();
  const iter = db.list<{ reviewedAt: string }>({ prefix: orgKey(orgId, "review-done") });
  for await (const entry of iter) {
    const key = entry.key as Deno.KvKeyPart[];
    ids.add(String(key[key.length - 1]));
  }
  return ids;
}

// -- Clear Queue --

export async function clearReviewQueue(orgId: OrgId): Promise<{ cleared: number }> {
  const db = await kv();
  let cleared = 0;

  const prefixes = [
    orgKey(orgId, "review-pending"),
    orgKey(orgId, "review-audit-pending"),
    orgKey(orgId, "review-lock"),
    orgKey(orgId, "review-active"),
  ];

  // Collect all keys first, then batch-delete in groups of 10 (Deno KV atomic limit)
  const keys: Deno.KvKey[] = [];
  for (const prefix of prefixes) {
    const iter = db.list({ prefix });
    for await (const entry of iter) {
      keys.push(entry.key);
    }
  }

  const BATCH = 10;
  for (let i = 0; i < keys.length; i += BATCH) {
    const batch = keys.slice(i, i + BATCH);
    const atomic = db.atomic();
    for (const key of batch) atomic.delete(key);
    await atomic.commit();
    cleared += batch.length;
  }

  console.log(`[REVIEW] clearReviewQueue: deleted ${cleared} KV entries for org ${orgId}`);
  return { cleared };
}

// -- Backfill --

export async function backfillFromFinished(orgId: OrgId) {
  const db = await kv();
  let queued = 0;

  // Collect unique finding IDs from chunked KV keys (pattern: orgKey(orgId, "audit-finding", id, chunkIndex))
  const findingIds = new Set<string>();
  const iter = db.list({ prefix: orgKey(orgId, "audit-finding") });
  for await (const entry of iter) {
    const key = entry.key as Deno.KvKey;
    // key shape: [orgId, "audit-finding", findingId, chunkIndexOrMeta]
    if (key.length >= 3 && typeof key[2] === "string") {
      findingIds.add(key[2] as string);
    }
  }

  for (const findingId of findingIds) {
    const finding = await getFinding(orgId, findingId);
    if (!finding) continue;
    if (finding.findingStatus !== "finished") continue;
    if (!finding.answeredQuestions?.length) continue;

    // Skip if already has review items
    const existingCheck = await db.get(orgKey(orgId, "review-audit-pending", findingId));
    if (existingCheck.value !== null) continue;

    // Also check if any decided items exist
    let hasDecided = false;
    const decidedIter = db.list({ prefix: orgKey(orgId, "review-decided", findingId) });
    for await (const _ of decidedIter) {
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

/** Build a preview buffer for admin troubleshooting — no claiming, no locking. */
export async function previewFinding(orgId: OrgId, findingId: string): Promise<BufferItem[] | null> {
  const finding = await getFinding(orgId, findingId);
  if (!finding || !finding.answeredQuestions?.length) return null;

  let transcript = await getTranscript(orgId, findingId);
  if (transcript && !transcript.utteranceTimes?.length) {
    transcript = await backfillUtteranceTimes(orgId, findingId, transcript);
  }

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
