/** Judge-specific KV operations: queue, locks, decisions, appeal stats. */

import { Kv } from "../../../../core/data/kv/kv.ts";
import type { OrgId } from "../../../../core/data/kv/org.ts";
import { checkBadges } from "../../../../core/business/badges/mod.ts";
import type { BadgeDef } from "../../../../core/business/badges/mod.ts";

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
  const db = (await Kv.getInstance()).db;

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
    atomic.set(Kv.orgKey(orgId, "judge-pending", findingId, q.index), item);
  }
  atomic.set(Kv.orgKey(orgId, "judge-audit-pending", findingId), items.length);
  await atomic.commit();

  console.log(`[JUDGE] ${findingId}: Queued ${items.length} items for judge review`);
}

// -- Claim Next Item --

export async function claimNextItem(orgId: OrgId, judge: string): Promise<{
  current: (JudgeItem & { appealComment?: string }) | null;
  transcript: { raw: string; diarized: string } | null;
  peek: JudgeItem | null;
  remaining: number;
  auditRemaining: number;
}> {
  const kvInst = await Kv.getInstance();
  const db = kvInst.db;
  const now = Date.now();
  const LOCK_TTL = 30 * 60 * 1000;

  let current: JudgeItem | null = null;
  let peek: JudgeItem | null = null;
  let remaining = 0;

  const iter = db.list<JudgeItem>({ prefix: Kv.orgKey(orgId, "judge-pending") });
  for await (const entry of iter) {
    remaining++;
    const item = entry.value;
    const lockKey = Kv.orgKey(orgId, "judge-lock", item.findingId, item.questionIndex);

    if (!current) {
      const lockEntry = await db.get(lockKey);
      const res = await db.atomic()
        .check(lockEntry)
        .set(lockKey, { claimedBy: judge, claimedAt: now }, { expireIn: LOCK_TTL })
        .commit();

      if (res.ok) {
        current = item;
        continue;
      }
    } else if (!peek) {
      const lockEntry = await db.get(lockKey);
      if (lockEntry.value === null) {
        peek = item;
      }
    }

    // Don't break early -- continue iterating to get accurate remaining count
  }

  if (current) remaining--;

  let transcript = null;
  let auditRemaining = 0;
  let enrichedCurrent: (JudgeItem & { appealComment?: string }) | null = current;
  if (current) {
    transcript = await kvInst.getTranscript(orgId, current.findingId);
    const counterEntry = await db.get<number>(Kv.orgKey(orgId, "judge-audit-pending", current.findingId));
    auditRemaining = counterEntry.value ?? 0;

    // Enrich with appeal metadata from finding if not already on the item
    if (!current.appealType) {
      const finding = await kvInst.getFinding(orgId, current.findingId);
      if (finding) {
        const f = finding as Record<string, any>;
        if (f.appealType) {
          enrichedCurrent = { ...current, appealType: f.appealType };
        }
        if (f.appealComment) {
          enrichedCurrent = { ...(enrichedCurrent ?? current), appealComment: f.appealComment };
        }
      }
    } else {
      // appealType is on the item, but we still need appealComment from finding
      const finding = await kvInst.getFinding(orgId, current.findingId);
      if (finding) {
        const f = finding as Record<string, any>;
        if (f.appealComment) {
          enrichedCurrent = { ...current, appealComment: f.appealComment };
        }
      }
    }
  }

  return { current: enrichedCurrent, transcript, peek, remaining, auditRemaining };
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
  const kvInst = await Kv.getInstance();
  const db = kvInst.db;

  const lockKey = Kv.orgKey(orgId, "judge-lock", findingId, questionIndex);
  const lockEntry = await db.get<{ claimedBy: string }>(lockKey);
  if (lockEntry.value && lockEntry.value.claimedBy !== judge) {
    return { success: false, auditComplete: false, newBadges: [] };
  }

  const pendingKey = Kv.orgKey(orgId, "judge-pending", findingId, questionIndex);
  const pendingEntry = await db.get<JudgeItem>(pendingKey);
  if (!pendingEntry.value) {
    return { success: false, auditComplete: false, newBadges: [] };
  }

  const decided: JudgeDecision = {
    ...pendingEntry.value,
    decision,
    ...(reason ? { reason } : {}),
    judge,
    decidedAt: Date.now(),
  };

  const counterKey = Kv.orgKey(orgId, "judge-audit-pending", findingId);
  const counterEntry = await db.get<number>(counterKey);
  const currentCount = counterEntry.value ?? 1;
  const newCount = currentCount - 1;

  const atomic = db.atomic()
    .delete(lockKey)
    .delete(pendingKey)
    .set(Kv.orgKey(orgId, "judge-decided", findingId, questionIndex), decided);

  if (newCount <= 0) {
    atomic.delete(counterKey);
  } else {
    atomic.set(counterKey, newCount);
  }

  const res = await atomic.commit();
  if (!res.ok) {
    return { success: false, auditComplete: false, newBadges: [] };
  }

  console.log(`[JUDGE] recordDecision OK: ${findingId}/${questionIndex} = ${decision}`);

  const auditComplete = newCount <= 0;

  if (auditComplete) {
    postJudgedAudit(orgId, findingId, judge).catch((err) =>
      console.error(`[JUDGE] ${findingId}: Completion failed:`, err)
    );
  }

  // -- Badge checking --
  let newBadges: BadgeDef[] = [];
  try {
    const stats = await kvInst.getBadgeStats(orgId, judge);
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
    await kvInst.updateBadgeStats(orgId, judge, stats);

    const earned = await kvInst.getEarnedBadges(orgId, judge);
    const earnedSet = new Set(earned.map((b) => b.badgeId));
    newBadges = checkBadges("judge", stats, earnedSet);

    let badgeXp = 0;
    for (const badge of newBadges) {
      await kvInst.awardBadge(orgId, judge, badge);
      badgeXp += badge.xpReward;
    }
    await kvInst.awardXp(orgId, judge, 10 + badgeXp, "judge");
  } catch (err) {
    console.error(`[JUDGE] Badge check error for ${judge}:`, err);
  }

  return { success: true, auditComplete, newBadges };
}

// -- Go Back (Undo) --

export async function undoDecision(
  orgId: OrgId,
  judge: string,
): Promise<{
  restored: JudgeItem | null;
  transcript: { raw: string; diarized: string } | null;
  peek: JudgeItem | null;
  remaining: number;
  auditRemaining: number;
}> {
  const kvInst = await Kv.getInstance();
  const db = kvInst.db;

  // Release any current lock held by this judge
  const lockIter = db.list<{ claimedBy: string }>({ prefix: Kv.orgKey(orgId, "judge-lock") });
  for await (const entry of lockIter) {
    if (entry.value.claimedBy === judge) {
      await db.delete(entry.key);
    }
  }

  // Find the most recent decision by this judge
  let latestDecided: { entry: Deno.KvEntry<JudgeDecision>; decidedAt: number } | null = null;
  const decidedIter = db.list<JudgeDecision>({ prefix: Kv.orgKey(orgId, "judge-decided") });
  for await (const entry of decidedIter) {
    if (entry.value.judge === judge) {
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
  const item: JudgeItem = {
    findingId: decided.findingId,
    questionIndex: decided.questionIndex,
    header: decided.header,
    populated: decided.populated,
    thinking: decided.thinking,
    defense: decided.defense,
    answer: decided.answer,
  };

  const counterKey = Kv.orgKey(orgId, "judge-audit-pending", findingId);
  const counterEntry = await db.get<number>(counterKey);
  const newCount = (counterEntry.value ?? 0) + 1;

  const atomic = db.atomic()
    .check(latestDecided.entry)
    .check(counterEntry)
    .delete(latestDecided.entry.key)
    .set(Kv.orgKey(orgId, "judge-pending", findingId, questionIndex), item)
    .set(counterKey, newCount)
    .set(
      Kv.orgKey(orgId, "judge-lock", findingId, questionIndex),
      { claimedBy: judge, claimedAt: Date.now() },
      { expireIn: 30 * 60 * 1000 },
    );

  const res = await atomic.commit();
  if (!res.ok) {
    return { restored: null, transcript: null, peek: null, remaining: 0, auditRemaining: 0 };
  }

  const transcript = await kvInst.getTranscript(orgId, findingId);

  let peek: JudgeItem | null = null;
  let remaining = 0;
  const pendingIter = db.list<JudgeItem>({ prefix: Kv.orgKey(orgId, "judge-pending") });
  for await (const entry of pendingIter) {
    remaining++;
    if (!peek && !(entry.value.findingId === findingId && entry.value.questionIndex === questionIndex)) {
      const lk = Kv.orgKey(orgId, "judge-lock", entry.value.findingId, entry.value.questionIndex);
      const lkEntry = await db.get(lk);
      if (lkEntry.value === null) {
        peek = entry.value;
      }
    }
  }

  return { restored: item, transcript, peek, remaining, auditRemaining: newCount };
}

// -- Audit Completion --

async function postJudgedAudit(orgId: OrgId, findingId: string, judgedBy: string) {
  const kvInst = await Kv.getInstance();
  const db = kvInst.db;

  const finding = await kvInst.getFinding(orgId, findingId);
  if (!finding) {
    console.error(`[JUDGE] ${findingId}: Finding not found for completion`);
    return;
  }

  const allAnswers = await kvInst.getAllAnswersForFinding(orgId, findingId);
  const answers = allAnswers.length > 0 ? allAnswers : (finding.answeredQuestions ?? []);

  // Load all decided items for this finding
  const decisions: JudgeDecision[] = [];
  const iter = db.list<JudgeDecision>({ prefix: Kv.orgKey(orgId, "judge-decided", findingId) });
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
  await kvInst.saveFinding(orgId, finding);

  // Update appeal record
  const appealEntry = await db.get<AppealRecord>(Kv.orgKey(orgId, "appeal", findingId));
  if (appealEntry.value) {
    await db.set(Kv.orgKey(orgId, "appeal", findingId), {
      ...appealEntry.value,
      status: "complete",
      judgedBy,
    });
  }

  // Update auditor stats -- use the finding owner as the auditor
  const auditor = finding.owner ?? "unknown";
  const statsKey = Kv.orgKey(orgId, "appeal-stats", auditor);
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
  await db.set(Kv.orgKey(orgId, "appeal-history", findingId), history);

  console.log(`[JUDGE] ${findingId}: Appeal complete - ${overturns} overturns, score ${originalScore}% -> ${finalScore}%`);

  kvInst.fireWebhook(orgId, "judge", {
    findingId,
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
  const db = (await Kv.getInstance()).db;
  let pending = 0;
  let decided = 0;

  for await (const _ of db.list({ prefix: Kv.orgKey(orgId, "judge-pending") })) pending++;
  for await (const _ of db.list({ prefix: Kv.orgKey(orgId, "judge-decided") })) decided++;

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
  const db = (await Kv.getInstance()).db;

  let totalAppeals = 0;
  let completed = 0;
  let pending = 0;

  const appealIter = db.list<AppealRecord>({ prefix: Kv.orgKey(orgId, "appeal") });
  for await (const entry of appealIter) {
    totalAppeals++;
    if (entry.value.status === "complete") completed++;
    else pending++;
  }

  let overturns = 0;
  let upheld = 0;
  const byAuditor: Array<{ auditor: string; totalAppeals: number; overturned: number; upheld: number }> = [];

  const statsIter = db.list<AppealStats>({ prefix: Kv.orgKey(orgId, "appeal-stats") });
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
  const db = (await Kv.getInstance()).db;

  // Queue stats
  let pending = 0;
  let decided = 0;
  for await (const _ of db.list({ prefix: Kv.orgKey(orgId, "judge-pending") })) pending++;
  for await (const _ of db.list({ prefix: Kv.orgKey(orgId, "judge-decided") })) decided++;

  // Appeal records
  let totalAppeals = 0;
  let completedAppeals = 0;
  let pendingAppeals = 0;
  const appealIter = db.list<AppealRecord>({ prefix: Kv.orgKey(orgId, "appeal") });
  for await (const entry of appealIter) {
    totalAppeals++;
    if (entry.value.status === "complete") completedAppeals++;
    else pendingAppeals++;
  }

  // Per-auditor stats
  let overturns = 0;
  let upheld = 0;
  const byAuditor: Array<{ auditor: string; totalAppeals: number; overturned: number; upheld: number; overturnRate: string }> = [];
  const statsIter = db.list<AppealStats>({ prefix: Kv.orgKey(orgId, "appeal-stats") });
  for await (const entry of statsIter) {
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
  const historyIter = db.list<AppealHistory>({ prefix: Kv.orgKey(orgId, "appeal-history") });
  for await (const entry of historyIter) {
    recentAppeals.push(entry.value);
  }
  recentAppeals.sort((a, b) => b.timestamp - a.timestamp);

  // Per-judge stats (from decided entries)
  const judgeMap = new Map<string, { decisions: number; overturns: number; upholds: number }>();
  const decidedIter = db.list<JudgeDecision>({ prefix: Kv.orgKey(orgId, "judge-decided") });
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

export async function getAppeal(orgId: OrgId, findingId: string): Promise<AppealRecord | null> {
  const db = (await Kv.getInstance()).db;
  const entry = await db.get<AppealRecord>(Kv.orgKey(orgId, "appeal", findingId));
  return entry.value;
}

export async function saveAppeal(orgId: OrgId, record: AppealRecord) {
  const db = (await Kv.getInstance()).db;
  await db.set(Kv.orgKey(orgId, "appeal", record.findingId), record);
}
