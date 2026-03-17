/** Judge-specific KV operations: queue, locks, decisions, appeal stats. */

import { getFinding, saveFinding, getAllAnswersForFinding, getTranscript, backfillUtteranceTimes, fireWebhook, getBadgeStats, updateBadgeStats, getEarnedBadges, awardBadge, awardXp } from "../lib/kv.ts";
import { orgKey } from "../lib/org.ts";
import type { OrgId } from "../lib/org.ts";
import { checkBadges } from "../shared/badges.ts";
import type { BadgeDef } from "../shared/badges.ts";

let _kv: Deno.Kv | undefined;

async function kv(): Promise<Deno.Kv> {
  if (!_kv) _kv = await Deno.openKv();
  return _kv;
}

// -- Types --

export interface JudgeItem {
  findingId: string;
  questionIndex: number;
  header: string;
  populated: string;
  thinking: string;
  defense: string;
  answer: string; // current answer (Yes or No) so the judge sees what was decided
  appealType?: string;
}

export interface JudgeDecision extends JudgeItem {
  decision: "uphold" | "overturn";
  reason?: "error" | "logic" | "fragment" | "transcript";
  judge: string;
  decidedAt: number;
}

export interface AppealRecord {
  findingId: string;
  appealedAt: number;
  status: "pending" | "complete";
  judgedBy?: string;
  auditor?: string;
  comment?: string;
  appealedQuestions?: string[];
}

export interface AppealStats {
  totalAppeals: number;
  overturned: number;
  upheld: number;
}

export interface AppealHistory {
  findingId: string;
  auditor: string;
  judgedBy: string;
  originalScore: number;
  finalScore: number;
  overturns: number;
  timestamp: number;
}

// -- Queue Population --

export async function populateJudgeQueue(
  orgId: OrgId,
  findingId: string,
  answeredQuestions: Array<{ answer: string; header: string; populated: string; thinking: string; defense: string }>,
  appealType?: string,
) {
  const db = await kv();

  // Queue ALL questions, not just "No" answers
  const items = answeredQuestions.map((q, i) => ({ ...q, index: i }));
  if (items.length === 0) return;

  const atomic = db.atomic();
  for (const q of items) {
    const item: JudgeItem = {
      findingId,
      questionIndex: q.index,
      header: q.header,
      populated: q.populated,
      thinking: q.thinking,
      defense: q.defense,
      answer: q.answer,
      ...(appealType ? { appealType } : {}),
    };
    atomic.set(orgKey(orgId, "judge-pending", findingId, q.index), item);
  }
  atomic.set(orgKey(orgId, "judge-audit-pending", findingId), items.length);
  await atomic.commit();

  console.log(`[JUDGE] ${findingId}: Queued ${items.length} items for judge review`);
}

// -- Claim Next Item --
// Design: items are atomically MOVED from judge-pending → judge-active/{judge}
// on claim. Once moved, no other judge can see it.

const ACTIVE_TTL = 30 * 60 * 1000; // 30 minutes

export const BUFFER_SIZE = 5;

export interface JudgeBufferItem extends JudgeItem {
  auditRemaining: number;
  transcript: { raw: string; diarized: string; utteranceTimes?: number[] } | null;
  appealComment?: string;
  reviewedBy?: string;
}

// Recording re-audit types should never reach the judge queue.
const SKIP_APPEAL_TYPES = new Set(["different-recording", "additional-recording", "upload-recording"]);

export async function claimNextItem(orgId: OrgId, judge: string): Promise<{
  buffer: JudgeBufferItem[];
  remaining: number;
}> {
  const db = await kv();
  const now = Date.now();

  // Helper: atomically claim up to `count` items from pending (skipping disposed appeal types)
  async function claimFromPending(count: number): Promise<JudgeItem[]> {
    const claimed: JudgeItem[] = [];
    const iter = db.list<JudgeItem>({ prefix: orgKey(orgId, "judge-pending") });
    for await (const entry of iter) {
      if (entry.value.appealType && SKIP_APPEAL_TYPES.has(entry.value.appealType)) {
        await db.delete(entry.key);
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

  // Helper: enrich a JudgeItem into a JudgeBufferItem (add transcript + auditRemaining + appealComment)
  async function enrich(item: JudgeItem): Promise<JudgeBufferItem> {
    let transcript = await getTranscript(orgId, item.findingId);
    if (transcript && !transcript.utteranceTimes?.length) {
      transcript = await backfillUtteranceTimes(orgId, item.findingId, transcript);
    }
    const counterEntry = await db.get<number>(orgKey(orgId, "judge-audit-pending", item.findingId));
    let appealComment: string | undefined;
    let enrichedAppealType = item.appealType;
    const finding = await getFinding(orgId, item.findingId);
    if (finding) {
      const f = finding as Record<string, any>;
      if (f.appealType && !item.appealType) enrichedAppealType = f.appealType;
      if (f.appealComment) appealComment = f.appealComment;
    }
    const reviewedBy = finding?.answeredQuestions?.find((q: any) => q.reviewedBy)?.reviewedBy as string | undefined;
    return {
      ...item,
      ...(enrichedAppealType ? { appealType: enrichedAppealType } : {}),
      auditRemaining: counterEntry.value ?? 0,
      transcript,
      ...(appealComment ? { appealComment } : {}),
      ...(reviewedBy ? { reviewedBy } : {}),
    };
  }

  // 1. Sweep expired active claims from OTHER judges back to pending
  const allActiveIter = db.list<JudgeItem & { claimedAt: number }>({
    prefix: orgKey(orgId, "judge-active"),
  });
  for await (const entry of allActiveIter) {
    const val = entry.value;
    // Skip this judge's own items
    const keyParts = entry.key as Deno.KvKeyPart[];
    if (keyParts[2] === judge) continue;
    if (val.claimedAt && (now - val.claimedAt) > ACTIVE_TTL) {
      const pendingKey = orgKey(orgId, "judge-pending", val.findingId, val.questionIndex);
      const { claimedAt: _, ...baseItem } = val;
      const res = await db.atomic()
        .check(entry)
        .delete(entry.key)
        .set(pendingKey, baseItem as JudgeItem)
        .commit();
      if (res.ok) {
        console.log(`[JUDGE] Reclaimed expired active item ${val.findingId}/${val.questionIndex}`);
      }
    }
  }

  // 2. Collect existing active items for this judge
  const activeItems: JudgeItem[] = [];
  const activeIter = db.list<JudgeItem & { claimedAt: number }>({
    prefix: orgKey(orgId, "judge-active", judge),
  });
  for await (const entry of activeIter) {
    activeItems.push(entry.value);
  }

  // 3. Top up from pending if needed
  if (activeItems.length < BUFFER_SIZE) {
    const more = await claimFromPending(BUFFER_SIZE - activeItems.length);
    activeItems.push(...more);
  }

  // 4. Enrich all items with transcript + auditRemaining + appealComment
  const buffer: JudgeBufferItem[] = [];
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
  decision: "uphold" | "overturn",
  judge: string,
  reason?: "error" | "logic" | "fragment" | "transcript",
  clientCombo?: number,
  clientLevel?: number,
): Promise<{ success: boolean; auditComplete: boolean; newBadges: BadgeDef[] }> {
  const db = await kv();

  // Load active item for this judge
  const activeKey = orgKey(orgId, "judge-active", judge, findingId, questionIndex);
  const activeEntry = await db.get<JudgeItem & { claimedAt: number }>(activeKey);

  let decidedItem: JudgeItem;
  if (activeEntry.value) {
    const { claimedAt: _, ...baseItem } = activeEntry.value;
    decidedItem = baseItem as JudgeItem;
  } else {
    // Fallback: check pending directly (undo path / legacy)
    const pendingKey = orgKey(orgId, "judge-pending", findingId, questionIndex);
    const pendingEntry = await db.get<JudgeItem>(pendingKey);
    if (!pendingEntry.value) {
      return { success: false, auditComplete: false, newBadges: [] };
    }
    decidedItem = pendingEntry.value;
    // Use pending path
    const decided: JudgeDecision = { ...decidedItem, decision, ...(reason ? { reason } : {}), judge, decidedAt: Date.now() };
    const counterKey = orgKey(orgId, "judge-audit-pending", findingId);
    const counterEntry = await db.get<number>(counterKey);
    const newCount = (counterEntry.value ?? 1) - 1;
    const atomic = db.atomic().check(pendingEntry).delete(pendingKey).delete(orgKey(orgId, "judge-lock", findingId, questionIndex)).set(orgKey(orgId, "judge-decided", findingId, questionIndex), decided);
    if (newCount <= 0) atomic.delete(counterKey); else atomic.set(counterKey, newCount);
    const res = await atomic.commit();
    if (!res.ok) return { success: false, auditComplete: false, newBadges: [] };
    if (newCount <= 0) postJudgedAudit(orgId, findingId, judge).catch((err) => console.error(`[JUDGE] ${findingId}: Completion failed:`, err));
    return { success: true, auditComplete: newCount <= 0, newBadges: [] };
  }

  const decided: JudgeDecision = {
    ...decidedItem,
    decision,
    ...(reason ? { reason } : {}),
    judge,
    decidedAt: Date.now(),
  };

  const counterKey = orgKey(orgId, "judge-audit-pending", findingId);
  const counterEntry = await db.get<number>(counterKey);
  const currentCount = counterEntry.value ?? 1;
  const newCount = currentCount - 1;

  const atomic = db.atomic()
    .check(activeEntry)
    .delete(activeKey)
    .set(orgKey(orgId, "judge-decided", findingId, questionIndex), decided);

  if (newCount <= 0) {
    atomic.delete(counterKey);
  } else {
    atomic.set(counterKey, newCount);
  }

  const res = await atomic.commit();
  if (!res.ok) {
    console.warn(`[JUDGE] recordDecision CONFLICT: ${findingId}/${questionIndex} — atomic commit failed`);
    return { success: false, auditComplete: false, newBadges: [] };
  }

  const auditComplete = newCount <= 0;
  console.log(`[JUDGE] ✅ recordDecision: ${findingId}/${questionIndex} = ${decision}${auditComplete ? " (audit complete)" : ""}`);

  if (auditComplete) {
    postJudgedAudit(orgId, findingId, judge).catch((err) =>
      console.error(`[JUDGE] ${findingId}: ❌ Completion failed:`, err)
    );
  }

  // Badge checking is off the critical path — fire and forget so the judge gets instant response
  (async () => {
    try {
      const stats = await getBadgeStats(orgId, judge);
      stats.totalDecisions++;
      if (decision === "overturn") {
        stats.totalOverturns++;
        stats.consecutiveUpholds = 0;
      } else {
        stats.consecutiveUpholds++;
      }
      if (clientCombo != null && clientCombo > stats.bestCombo) stats.bestCombo = clientCombo;
      if (clientLevel != null && clientLevel > stats.level) stats.level = clientLevel;
      const today = new Date().toISOString().slice(0, 10);
      if (stats.lastActiveDate !== today) {
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        stats.dayStreak = stats.lastActiveDate === yesterday ? stats.dayStreak + 1 : 1;
        stats.lastActiveDate = today;
      }
      await updateBadgeStats(orgId, judge, stats);

      const earned = await getEarnedBadges(orgId, judge);
      const earnedSet = new Set(earned.map((b) => b.badgeId));
      const newBadges = checkBadges("judge", stats, earnedSet);

      let badgeXp = 0;
      for (const badge of newBadges) {
        await awardBadge(orgId, judge, badge);
        badgeXp += badge.xpReward;
      }
      await awardXp(orgId, judge, 10 + badgeXp, "judge");
    } catch (err) {
      console.error(`[JUDGE] Badge check error for ${judge}:`, err);
    }
  })();

  return { success: true, auditComplete, newBadges: [] };
}

// -- Go Back (Undo) --

export async function undoDecision(
  orgId: OrgId,
  judge: string,
): Promise<{
  buffer: JudgeBufferItem[];
  remaining: number;
}> {
  const db = await kv();

  // Release all current active items held by this judge (put back in pending)
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

  if (!latestDecided) {
    return { buffer: [], remaining: 0 };
  }

  const decided = latestDecided.entry.value;
  const { findingId, questionIndex } = decided;
  const item: JudgeItem = {
    findingId: decided.findingId,
    questionIndex: decided.questionIndex,
    header: decided.header,
    populated: decided.populated,
    thinking: decided.thinking,
    defense: decided.defense,
    answer: decided.answer,
  };

  const counterKey = orgKey(orgId, "judge-audit-pending", findingId);
  const counterEntry = await db.get<number>(counterKey);
  const newCount = (counterEntry.value ?? 0) + 1;

  // Move: decided → active (assigned to this judge)
  const activeKey = orgKey(orgId, "judge-active", judge, findingId, questionIndex);
  const atomic = db.atomic()
    .check(latestDecided.entry)
    .check(counterEntry)
    .delete(latestDecided.entry.key)
    .set(activeKey, { ...item, claimedAt: Date.now() })
    .set(counterKey, newCount);

  const res = await atomic.commit();
  if (!res.ok) {
    return { buffer: [], remaining: 0 };
  }

  // Delegate to claimNextItem for full buffer (restored item is first active)
  return claimNextItem(orgId, judge);
}

// -- Audit Completion --

async function postJudgedAudit(orgId: OrgId, findingId: string, judgedBy: string) {
  const db = await kv();

  const finding = await getFinding(orgId, findingId);
  if (!finding) {
    console.error(`[JUDGE] ${findingId}: Finding not found for completion`);
    return;
  }

  const allAnswers = await getAllAnswersForFinding(orgId, findingId);
  const answers = allAnswers.length > 0 ? allAnswers : (finding.answeredQuestions ?? []);

  // Load all decided items for this finding
  const decisions: JudgeDecision[] = [];
  const iter = db.list<JudgeDecision>({ prefix: orgKey(orgId, "judge-decided", findingId) });
  for await (const entry of iter) {
    decisions.push(entry.value);
  }

  // Normalize answer check
  const isYes = (a: string) => {
    const s = String(a ?? "").trim().toLowerCase();
    return s.startsWith("yes") || s === "true" || s === "y" || s === "1";
  };

  // Apply overturns: flip the answer
  let overturns = 0;
  const correctedAnswers = answers.map((a: any, i: number) => {
    const decision = decisions.find((d) => d.questionIndex === i);
    if (decision?.decision === "overturn") {
      overturns++;
      const flippedAnswer = isYes(a.answer) ? "No" : "Yes";
      return { ...a, answer: flippedAnswer, judgedBy: decision.judge, judgeAction: "overturn", judgeReason: decision.reason ?? null };
    }
    if (decision?.decision === "uphold") {
      return { ...a, judgedBy: decision.judge, judgeAction: "uphold" };
    }
    return a;
  });
  const originalYes = answers.filter((a: any) => isYes(a.answer)).length;
  const total = answers.length;
  const originalScore = total > 0 ? Math.round((originalYes / total) * 100) : 0;

  const finalYes = correctedAnswers.filter((a: any) => isYes(a.answer)).length;
  const finalScore = total > 0 ? Math.round((finalYes / total) * 100) : 0;

  // Update finding with corrected answers
  finding.answeredQuestions = correctedAnswers;
  await saveFinding(orgId, finding);

  // Update appeal record
  const appealEntry = await db.get<AppealRecord>(orgKey(orgId, "appeal", findingId));
  if (appealEntry.value) {
    await db.set(orgKey(orgId, "appeal", findingId), {
      ...appealEntry.value,
      status: "complete",
      judgedBy,
    });
  }

  // Update auditor stats -- use the finding owner as the auditor
  const auditor = finding.owner ?? "unknown";
  const statsKey = orgKey(orgId, "appeal-stats", auditor);
  const statsEntry = await db.get<AppealStats>(statsKey);
  const currentStats = statsEntry.value ?? { totalAppeals: 0, overturned: 0, upheld: 0 };
  await db.set(statsKey, {
    totalAppeals: currentStats.totalAppeals + 1,
    overturned: currentStats.overturned + overturns,
    upheld: currentStats.upheld + (decisions.length - overturns),
  });

  // Save history entry
  const history: AppealHistory = {
    findingId,
    auditor,
    judgedBy,
    originalScore,
    finalScore,
    overturns,
    timestamp: Date.now(),
  };
  await db.set(orgKey(orgId, "appeal-history", findingId), history);

  console.log(`[JUDGE] ${findingId}: Appeal complete - ${overturns} overturns, score ${originalScore}% -> ${finalScore}%`);

  fireWebhook(orgId, "judge", {
    findingId,
    finding,
    judgedBy,
    auditor,
    originalScore,
    finalScore,
    overturns,
    totalQuestions: total,
    decisions: decisions.map((d) => ({
      questionIndex: d.questionIndex,
      decision: d.decision,
      reason: d.reason ?? null,
      header: d.header,
    })),
  });
}


// -- Stats --

export async function getJudgeStats(orgId: OrgId): Promise<{ pending: number; decided: number }> {
  const db = await kv();
  let pending = 0;
  let decided = 0;

  for await (const _ of db.list({ prefix: orgKey(orgId, "judge-pending") })) pending++;
  for await (const _ of db.list({ prefix: orgKey(orgId, "judge-decided") })) decided++;

  return { pending, decided };
}

// -- Appeal Stats --

export async function getAppealStats(orgId: OrgId): Promise<{
  totalAppeals: number;
  completed: number;
  pending: number;
  overturns: number;
  upheld: number;
  byAuditor: Array<{ auditor: string; totalAppeals: number; overturned: number; upheld: number }>;
}> {
  const db = await kv();

  let totalAppeals = 0;
  let completed = 0;
  let pending = 0;

  const appealIter = db.list<AppealRecord>({ prefix: orgKey(orgId, "appeal") });
  for await (const entry of appealIter) {
    totalAppeals++;
    if (entry.value.status === "complete") completed++;
    else pending++;
  }

  let overturns = 0;
  let upheld = 0;
  const byAuditor: Array<{ auditor: string; totalAppeals: number; overturned: number; upheld: number }> = [];

  const statsIter = db.list<AppealStats>({ prefix: orgKey(orgId, "appeal-stats") });
  for await (const entry of statsIter) {
    // key is [orgId, "appeal-stats", auditor] so auditor is at index 2
    const auditor = String(entry.key[2]);
    const stats = entry.value;
    overturns += stats.overturned;
    upheld += stats.upheld;
    byAuditor.push({
      auditor,
      totalAppeals: stats.totalAppeals,
      overturned: stats.overturned,
      upheld: stats.upheld,
    });
  }

  return { totalAppeals, completed, pending, overturns, upheld, byAuditor };
}

// -- Judge Dashboard Data --

export async function getJudgeDashboardData(orgId: OrgId): Promise<{
  queue: { pending: number; decided: number };
  appeals: {
    total: number; completed: number; pending: number;
    overturns: number; upheld: number;
    overturnRate: string;
  };
  byAuditor: Array<{ auditor: string; totalAppeals: number; overturned: number; upheld: number; overturnRate: string }>;
  recentAppeals: AppealHistory[];
  byJudge: Array<{ judge: string; decisions: number; overturns: number; upholds: number }>;
}> {
  const db = await kv();

  // Queue stats
  let pending = 0;
  let decided = 0;
  for await (const _ of db.list({ prefix: orgKey(orgId, "judge-pending") })) pending++;
  for await (const _ of db.list({ prefix: orgKey(orgId, "judge-decided") })) decided++;

  // Appeal records
  let totalAppeals = 0;
  let completedAppeals = 0;
  let pendingAppeals = 0;
  const appealIter = db.list<AppealRecord>({ prefix: orgKey(orgId, "appeal") });
  for await (const entry of appealIter) {
    totalAppeals++;
    if (entry.value.status === "complete") completedAppeals++;
    else pendingAppeals++;
  }

  // Per-auditor stats
  let overturns = 0;
  let upheld = 0;
  const byAuditor: Array<{ auditor: string; totalAppeals: number; overturned: number; upheld: number; overturnRate: string }> = [];
  const statsIter = db.list<AppealStats>({ prefix: orgKey(orgId, "appeal-stats") });
  for await (const entry of statsIter) {
    // key is [orgId, "appeal-stats", auditor] so auditor is at index 2
    const auditor = String(entry.key[2]);
    const stats = entry.value;
    overturns += stats.overturned;
    upheld += stats.upheld;
    const total = stats.overturned + stats.upheld;
    byAuditor.push({
      auditor,
      totalAppeals: stats.totalAppeals,
      overturned: stats.overturned,
      upheld: stats.upheld,
      overturnRate: total > 0 ? ((stats.overturned / total) * 100).toFixed(1) + "%" : "N/A",
    });
  }

  const totalDecisions = overturns + upheld;
  const overturnRate = totalDecisions > 0 ? ((overturns / totalDecisions) * 100).toFixed(1) + "%" : "N/A";

  // Recent appeal history
  const recentAppeals: AppealHistory[] = [];
  const historyIter = db.list<AppealHistory>({ prefix: orgKey(orgId, "appeal-history") });
  for await (const entry of historyIter) {
    recentAppeals.push(entry.value);
  }
  recentAppeals.sort((a, b) => b.timestamp - a.timestamp);

  // Per-judge stats (from decided entries)
  const judgeMap = new Map<string, { decisions: number; overturns: number; upholds: number }>();
  const decidedIter = db.list<JudgeDecision>({ prefix: orgKey(orgId, "judge-decided") });
  for await (const entry of decidedIter) {
    const j = entry.value.judge;
    const existing = judgeMap.get(j) ?? { decisions: 0, overturns: 0, upholds: 0 };
    existing.decisions++;
    if (entry.value.decision === "overturn") existing.overturns++;
    else existing.upholds++;
    judgeMap.set(j, existing);
  }
  const byJudge = Array.from(judgeMap.entries()).map(([judge, stats]) => ({ judge, ...stats }));

  return {
    queue: { pending, decided },
    appeals: { total: totalAppeals, completed: completedAppeals, pending: pendingAppeals, overturns, upheld, overturnRate },
    byAuditor,
    recentAppeals: recentAppeals.slice(0, 50),
    byJudge,
  };
}

// -- Appeal Record --

export async function clearJudgeQueue(orgId: OrgId): Promise<{ cleared: number }> {
  const db = await kv();
  let cleared = 0;

  const prefixes = [
    orgKey(orgId, "judge-pending"),
    orgKey(orgId, "judge-audit-pending"),
    orgKey(orgId, "judge-lock"),
    orgKey(orgId, "judge-active"),
  ];

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

  console.log(`[JUDGE] clearJudgeQueue: deleted ${cleared} KV entries for org ${orgId}`);
  return { cleared };
}

export async function getAppeal(orgId: OrgId, findingId: string): Promise<AppealRecord | null> {
  const db = await kv();
  const entry = await db.get<AppealRecord>(orgKey(orgId, "appeal", findingId));
  return entry.value;
}

export async function saveAppeal(orgId: OrgId, record: AppealRecord) {
  const db = await kv();
  await db.set(orgKey(orgId, "appeal", record.findingId), record);
}
