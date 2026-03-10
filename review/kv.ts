/** Review-specific KV operations: queue, locks, settings, completion. All keys are org-scoped. */

import { orgKey } from "../lib/org.ts";
import type { OrgId } from "../lib/org.ts";
import { getFinding, getAllAnswersForFinding, getTranscript, fireWebhook, getBadgeStats, updateBadgeStats, getEarnedBadges, awardBadge, awardXp } from "../lib/kv.ts";
import { populateManagerQueue } from "../manager/kv.ts";
import { checkBadges, BADGE_CATALOG } from "../shared/badges.ts";
import type { BadgeDef } from "../shared/badges.ts";

let _kv: Deno.Kv | undefined;

async function kv(): Promise<Deno.Kv> {
  if (!_kv) _kv = await Deno.openKv();
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
  queue: { pending: number; decided: number };
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
    };
    atomic.set(orgKey(orgId, "review-pending", findingId, q.index), item);
  }
  atomic.set(orgKey(orgId, "review-audit-pending", findingId), noAnswers.length);
  await atomic.commit();

  console.log(`[REVIEW] ${findingId}: Queued ${noAnswers.length} items for review`);
}

// -- Claim Next Item --

export async function claimNextItem(orgId: OrgId, reviewer: string): Promise<{
  current: ReviewItem | null;
  transcript: { raw: string; diarized: string } | null;
  peek: ReviewItem | null;
  remaining: number;
  auditRemaining: number;
}> {
  const db = await kv();
  const now = Date.now();
  const LOCK_TTL = 30 * 60 * 1000; // 30 minutes

  let current: ReviewItem | null = null;
  let peek: ReviewItem | null = null;
  let scanned = 0;

  const iter = db.list<ReviewItem>({ prefix: orgKey(orgId, "review-pending") });
  for await (const entry of iter) {
    scanned++;
    const item = entry.value;
    const lockKey = orgKey(orgId, "review-lock", item.findingId, item.questionIndex);

    if (!current) {
      // Try to claim this item atomically — prevents two reviewers grabbing same question
      const lockEntry = await db.get(lockKey);
      const res = await db.atomic()
        .check(lockEntry)
        .set(lockKey, { claimedBy: reviewer, claimedAt: now }, { expireIn: LOCK_TTL })
        .commit();
      if (res.ok) {
        current = item;
        continue;
      }
    } else {
      // Peek: find next unlocked item to pre-load transcript, but stop after 20 candidates
      if (scanned > 20) break;
      const lockEntry = await db.get(lockKey);
      if (lockEntry.value === null) {
        peek = item;
        break;
      }
    }
  }

  const remaining = 0; // no longer scanning full queue — progress bar uses /stats baseline

  let transcript = null;
  let auditRemaining = 0;
  if (current) {
    transcript = await getTranscript(orgId, current.findingId);
    const counterEntry = await db.get<number>(orgKey(orgId, "review-audit-pending", current.findingId));
    auditRemaining = counterEntry.value ?? 0;
  }

  return { current, transcript, peek, remaining, auditRemaining };
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

  // Check lock -- if owned by another reviewer, reject. Otherwise proceed.
  const lockKey = orgKey(orgId, "review-lock", findingId, questionIndex);
  const lockEntry = await db.get<{ claimedBy: string }>(lockKey);
  if (lockEntry.value && lockEntry.value.claimedBy !== reviewer) {
    console.log(`[REVIEW] recordDecision REJECTED: lock owned by ${lockEntry.value.claimedBy}, not ${reviewer}`);
    return { success: false, auditComplete: false, newBadges: [] };
  }

  // Load pending item
  const pendingKey = orgKey(orgId, "review-pending", findingId, questionIndex);
  const pendingEntry = await db.get<ReviewItem>(pendingKey);
  if (!pendingEntry.value) {
    console.log(`[REVIEW] recordDecision REJECTED: no pending entry for ${findingId}/${questionIndex}`);
    return { success: false, auditComplete: false, newBadges: [] };
  }

  const decided: ReviewDecision = {
    ...pendingEntry.value,
    decision,
    reviewer,
    decidedAt: Date.now(),
  };

  // Load current counter
  const counterKey = orgKey(orgId, "review-audit-pending", findingId);
  const counterEntry = await db.get<number>(counterKey);
  const currentCount = counterEntry.value ?? 1;
  const newCount = currentCount - 1;

  // Write decided + delete pending + delete lock + update counter
  // Check pending versionstamp to prevent double-decide on concurrent requests
  const atomic = db.atomic()
    .check(pendingEntry)
    .delete(lockKey)
    .delete(pendingKey)
    .set(orgKey(orgId, "review-decided", findingId, questionIndex), decided);

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

  // Fire completion POST and populate manager queue in background if audit is complete
  if (auditComplete) {
    postCorrectedAudit(orgId, findingId).catch((err) =>
      console.error(`[REVIEW] ${findingId}: Completion POST failed:`, err)
    );
    populateManagerQueue(orgId, findingId).catch((err) =>
      console.error(`[REVIEW] ${findingId}: Manager queue population failed:`, err)
    );
  }

  // -- Badge checking (fire-and-forget style, but we await for newBadges) --
  let newBadges: BadgeDef[] = [];
  try {
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
    newBadges = checkBadges("reviewer", stats, earnedSet);

    let badgeXp = 0;
    for (const badge of newBadges) {
      await awardBadge(orgId, reviewer, badge);
      badgeXp += badge.xpReward;
    }
    // Award base XP (10 per decision) + badge bonus XP
    await awardXp(orgId, reviewer, 10 + badgeXp, "reviewer");
  } catch (err) {
    console.error(`[REVIEW] Badge check error for ${reviewer}:`, err);
  }

  return { success: true, auditComplete, newBadges };
}

// -- Go Back (Undo) --

export async function undoDecision(
  orgId: OrgId,
  reviewer: string,
): Promise<{
  restored: ReviewItem | null;
  transcript: { raw: string; diarized: string } | null;
  peek: ReviewItem | null;
  remaining: number;
  auditRemaining: number;
}> {
  const db = await kv();

  // First, release any current lock held by this reviewer
  const lockIter = db.list<{ claimedBy: string }>({ prefix: orgKey(orgId, "review-lock") });
  for await (const entry of lockIter) {
    if (entry.value.claimedBy === reviewer) {
      await db.delete(entry.key);
    }
  }

  // Find the most recent decision by this reviewer
  let latestDecided: { entry: Deno.KvEntry<ReviewDecision>; decidedAt: number } | null = null;
  const decidedIter = db.list<ReviewDecision>({ prefix: orgKey(orgId, "review-decided") });
  for await (const entry of decidedIter) {
    if (entry.value.reviewer === reviewer) {
      if (!latestDecided || entry.value.decidedAt > latestDecided.decidedAt) {
        latestDecided = { entry, decidedAt: entry.value.decidedAt };
      }
    }
  }

  if (!latestDecided) {
    return { restored: null, transcript: null, peek: null, remaining: 0, auditRemaining: 0 };
  }

  const decided = latestDecided.entry.value;
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

  // Move back: delete decided, restore to pending, increment counter
  const counterKey = orgKey(orgId, "review-audit-pending", findingId);
  const counterEntry = await db.get<number>(counterKey);
  const newCount = (counterEntry.value ?? 0) + 1;

  const atomic = db.atomic()
    .check(latestDecided.entry)
    .check(counterEntry)
    .delete(latestDecided.entry.key)
    .set(orgKey(orgId, "review-pending", findingId, questionIndex), item)
    .set(counterKey, newCount)
    .set(
      orgKey(orgId, "review-lock", findingId, questionIndex),
      { claimedBy: reviewer, claimedAt: Date.now() },
      { expireIn: 30 * 60 * 1000 },
    );

  const res = await atomic.commit();
  if (!res.ok) {
    return { restored: null, transcript: null, peek: null, remaining: 0, auditRemaining: 0 };
  }

  const transcript = await getTranscript(orgId, findingId);

  // Find peek
  let peek: ReviewItem | null = null;
  let remaining = 0;
  const pendingIter = db.list<ReviewItem>({ prefix: orgKey(orgId, "review-pending") });
  for await (const entry of pendingIter) {
    remaining++;
    if (!peek && !(entry.value.findingId === findingId && entry.value.questionIndex === questionIndex)) {
      const lk = orgKey(orgId, "review-lock", entry.value.findingId, entry.value.questionIndex);
      const lkEntry = await db.get(lk);
      if (lkEntry.value === null) {
        peek = entry.value;
      }
    }
  }

  return { restored: item, transcript, peek, remaining, auditRemaining: newCount };
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

  await fireWebhook(orgId, "terminate", {
    findingId,
    finding: { ...finding, answeredQuestions: correctedAnswers },
    correctedAnswers,
    reviewedAt: new Date().toISOString(),
  });
}

// -- Stats --

export async function getReviewStats(orgId: OrgId): Promise<{
  pending: number; decided: number;
  dateLegPending: number; packagePending: number;
  dateLegDecided: number; packageDecided: number;
}> {
  const db = await kv();
  let pending = 0, decided = 0;
  let dateLegPending = 0, packagePending = 0;
  let dateLegDecided = 0, packageDecided = 0;

  for await (const entry of db.list<ReviewItem>({ prefix: orgKey(orgId, "review-pending") })) {
    pending++;
    if (entry.value?.recordingIdField === "GenieNumber") packagePending++;
    else dateLegPending++;
  }
  for await (const entry of db.list<ReviewItem>({ prefix: orgKey(orgId, "review-decided") })) {
    decided++;
    if (entry.value?.recordingIdField === "GenieNumber") packageDecided++;
    else dateLegDecided++;
  }

  return { pending, decided, dateLegPending, packagePending, dateLegDecided, packageDecided };
}

// -- Reviewer Dashboard --

export async function getReviewerDashboardData(orgId: OrgId, reviewer: string): Promise<ReviewerDashboardData> {
  const db = await kv();

  // Count pending items
  let pending = 0;
  for await (const _ of db.list({ prefix: orgKey(orgId, "review-pending") })) pending++;

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
    queue: { pending, decided },
    personal: { totalDecisions, confirmCount, flipCount, avgDecisionSpeedMs },
    byReviewer,
    recentDecisions,
  };
}

// -- Clear Queue --

export async function clearReviewQueue(orgId: OrgId): Promise<{ cleared: number }> {
  const db = await kv();
  let cleared = 0;

  const prefixes = [
    orgKey(orgId, "review-pending"),
    orgKey(orgId, "review-audit-pending"),
    orgKey(orgId, "review-lock"),
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
