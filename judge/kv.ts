/** Judge-specific KV operations: queue, locks, auth, decisions, appeal stats. */

import { getFinding, saveFinding, getAllAnswersForFinding, getTranscript, fireWebhook } from "../lib/kv.ts";

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
}

export interface JudgeDecision extends JudgeItem {
  decision: "uphold" | "overturn";
  judge: string;
  decidedAt: number;
}

export interface AppealRecord {
  findingId: string;
  appealedAt: number;
  status: "pending" | "complete";
  judgedBy?: string;
  auditor?: string;
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
  findingId: string,
  answeredQuestions: Array<{ answer: string; header: string; populated: string; thinking: string; defense: string }>,
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
    };
    atomic.set(["judge-pending", findingId, q.index], item);
  }
  atomic.set(["judge-audit-pending", findingId], items.length);
  await atomic.commit();

  console.log(`[JUDGE] ${findingId}: Queued ${items.length} items for judge review`);
}

// -- Claim Next Item --

export async function claimNextItem(judge: string): Promise<{
  current: JudgeItem | null;
  transcript: { raw: string; diarized: string } | null;
  peek: JudgeItem | null;
  remaining: number;
}> {
  const db = await kv();
  const now = Date.now();
  const LOCK_TTL = 30 * 60 * 1000;

  let current: JudgeItem | null = null;
  let peek: JudgeItem | null = null;
  let remaining = 0;

  const iter = db.list<JudgeItem>({ prefix: ["judge-pending"] });
  for await (const entry of iter) {
    remaining++;
    const item = entry.value;
    const lockKey = ["judge-lock", item.findingId, item.questionIndex];

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

    // Don't break early — continue iterating to get accurate remaining count
  }

  if (current) remaining--;

  let transcript = null;
  if (current) {
    transcript = await getTranscript(current.findingId);
  }

  return { current, transcript, peek, remaining };
}

// -- Record Decision --

export async function recordDecision(
  findingId: string,
  questionIndex: number,
  decision: "uphold" | "overturn",
  judge: string,
): Promise<{ success: boolean; auditComplete: boolean }> {
  const db = await kv();

  const lockKey = ["judge-lock", findingId, questionIndex];
  const lockEntry = await db.get<{ claimedBy: string }>(lockKey);
  if (lockEntry.value && lockEntry.value.claimedBy !== judge) {
    return { success: false, auditComplete: false };
  }

  const pendingKey = ["judge-pending", findingId, questionIndex];
  const pendingEntry = await db.get<JudgeItem>(pendingKey);
  if (!pendingEntry.value) {
    return { success: false, auditComplete: false };
  }

  const decided: JudgeDecision = {
    ...pendingEntry.value,
    decision,
    judge,
    decidedAt: Date.now(),
  };

  const counterKey = ["judge-audit-pending", findingId];
  const counterEntry = await db.get<number>(counterKey);
  const currentCount = counterEntry.value ?? 1;
  const newCount = currentCount - 1;

  const atomic = db.atomic()
    .delete(lockKey)
    .delete(pendingKey)
    .set(["judge-decided", findingId, questionIndex], decided);

  if (newCount <= 0) {
    atomic.delete(counterKey);
  } else {
    atomic.set(counterKey, newCount);
  }

  const res = await atomic.commit();
  if (!res.ok) {
    return { success: false, auditComplete: false };
  }

  console.log(`[JUDGE] recordDecision OK: ${findingId}/${questionIndex} = ${decision}`);

  const auditComplete = newCount <= 0;

  if (auditComplete) {
    postJudgedAudit(findingId, judge).catch((err) =>
      console.error(`[JUDGE] ${findingId}: Completion failed:`, err)
    );
  }

  return { success: true, auditComplete };
}

// -- Go Back (Undo) --

export async function undoDecision(
  judge: string,
): Promise<{
  restored: JudgeItem | null;
  transcript: { raw: string; diarized: string } | null;
  peek: JudgeItem | null;
  remaining: number;
}> {
  const db = await kv();

  // Release any current lock held by this judge
  const lockIter = db.list<{ claimedBy: string }>({ prefix: ["judge-lock"] });
  for await (const entry of lockIter) {
    if (entry.value.claimedBy === judge) {
      await db.delete(entry.key);
    }
  }

  // Find the most recent decision by this judge
  let latestDecided: { entry: Deno.KvEntry<JudgeDecision>; decidedAt: number } | null = null;
  const decidedIter = db.list<JudgeDecision>({ prefix: ["judge-decided"] });
  for await (const entry of decidedIter) {
    if (entry.value.judge === judge) {
      if (!latestDecided || entry.value.decidedAt > latestDecided.decidedAt) {
        latestDecided = { entry, decidedAt: entry.value.decidedAt };
      }
    }
  }

  if (!latestDecided) {
    return { restored: null, transcript: null, peek: null, remaining: 0 };
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

  const counterKey = ["judge-audit-pending", findingId];
  const counterEntry = await db.get<number>(counterKey);
  const newCount = (counterEntry.value ?? 0) + 1;

  const atomic = db.atomic()
    .check(latestDecided.entry)
    .check(counterEntry)
    .delete(latestDecided.entry.key)
    .set(["judge-pending", findingId, questionIndex], item)
    .set(counterKey, newCount)
    .set(
      ["judge-lock", findingId, questionIndex],
      { claimedBy: judge, claimedAt: Date.now() },
      { expireIn: 30 * 60 * 1000 },
    );

  const res = await atomic.commit();
  if (!res.ok) {
    return { restored: null, transcript: null, peek: null, remaining: 0 };
  }

  const transcript = await getTranscript(findingId);

  let peek: JudgeItem | null = null;
  let remaining = 0;
  const pendingIter = db.list<JudgeItem>({ prefix: ["judge-pending"] });
  for await (const entry of pendingIter) {
    remaining++;
    if (!peek && !(entry.value.findingId === findingId && entry.value.questionIndex === questionIndex)) {
      const lk = ["judge-lock", entry.value.findingId, entry.value.questionIndex];
      const lkEntry = await db.get(lk);
      if (lkEntry.value === null) {
        peek = entry.value;
      }
    }
  }

  return { restored: item, transcript, peek, remaining };
}

// -- Audit Completion --

async function postJudgedAudit(findingId: string, judgedBy: string) {
  const db = await kv();

  const finding = await getFinding(findingId);
  if (!finding) {
    console.error(`[JUDGE] ${findingId}: Finding not found for completion`);
    return;
  }

  const allAnswers = await getAllAnswersForFinding(findingId);
  const answers = allAnswers.length > 0 ? allAnswers : (finding.answeredQuestions ?? []);

  // Load all decided items for this finding
  const decisions: JudgeDecision[] = [];
  const iter = db.list<JudgeDecision>({ prefix: ["judge-decided", findingId] });
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
      return { ...a, answer: flippedAnswer, judgedBy: decision.judge, judgeAction: "overturn" };
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
  await saveFinding(finding);

  // Update appeal record
  const appealEntry = await db.get<AppealRecord>(["appeal", findingId]);
  if (appealEntry.value) {
    await db.set(["appeal", findingId], {
      ...appealEntry.value,
      status: "complete",
      judgedBy,
    });
  }

  // Update auditor stats -- use the finding owner as the auditor
  const auditor = finding.owner ?? "unknown";
  const statsKey = ["appeal-stats", auditor];
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
  await db.set(["appeal-history", findingId], history);

  console.log(`[JUDGE] ${findingId}: Appeal complete - ${overturns} overturns, score ${originalScore}% -> ${finalScore}%`);

  fireWebhook("judge", {
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
      header: d.header,
    })),
  });
}

// -- Auth --

async function hashPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(password);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function createUser(username: string, password: string) {
  const db = await kv();
  const passwordHash = await hashPassword(password);
  await db.set(["judge-user", username], { passwordHash });
}

export async function verifyUser(username: string, password: string): Promise<boolean> {
  const db = await kv();
  const entry = await db.get<{ passwordHash: string }>(["judge-user", username]);
  if (!entry.value) return false;
  const hash = await hashPassword(password);
  return hash === entry.value.passwordHash;
}

export async function hasAnyUsers(): Promise<boolean> {
  const db = await kv();
  const iter = db.list({ prefix: ["judge-user"] });
  for await (const _ of iter) {
    return true;
  }
  return false;
}

export async function createSession(username: string): Promise<string> {
  const db = await kv();
  const token = crypto.randomUUID();
  await db.set(["judge-session", token], { username, createdAt: Date.now() }, { expireIn: 24 * 60 * 60 * 1000 });
  return token;
}

export async function getSession(token: string): Promise<string | null> {
  const db = await kv();
  const entry = await db.get<{ username: string }>(["judge-session", token]);
  return entry.value?.username ?? null;
}

export async function deleteSession(token: string) {
  const db = await kv();
  await db.delete(["judge-session", token]);
}

// -- Stats --

export async function getJudgeStats(): Promise<{ pending: number; decided: number }> {
  const db = await kv();
  let pending = 0;
  let decided = 0;

  for await (const _ of db.list({ prefix: ["judge-pending"] })) pending++;
  for await (const _ of db.list({ prefix: ["judge-decided"] })) decided++;

  return { pending, decided };
}

// -- Appeal Stats --

export async function getAppealStats(): Promise<{
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

  const appealIter = db.list<AppealRecord>({ prefix: ["appeal"] });
  for await (const entry of appealIter) {
    totalAppeals++;
    if (entry.value.status === "complete") completed++;
    else pending++;
  }

  let overturns = 0;
  let upheld = 0;
  const byAuditor: Array<{ auditor: string; totalAppeals: number; overturned: number; upheld: number }> = [];

  const statsIter = db.list<AppealStats>({ prefix: ["appeal-stats"] });
  for await (const entry of statsIter) {
    const auditor = String(entry.key[1]);
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

export async function getJudgeDashboardData(): Promise<{
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
  for await (const _ of db.list({ prefix: ["judge-pending"] })) pending++;
  for await (const _ of db.list({ prefix: ["judge-decided"] })) decided++;

  // Appeal records
  let totalAppeals = 0;
  let completedAppeals = 0;
  let pendingAppeals = 0;
  const appealIter = db.list<AppealRecord>({ prefix: ["appeal"] });
  for await (const entry of appealIter) {
    totalAppeals++;
    if (entry.value.status === "complete") completedAppeals++;
    else pendingAppeals++;
  }

  // Per-auditor stats
  let overturns = 0;
  let upheld = 0;
  const byAuditor: Array<{ auditor: string; totalAppeals: number; overturned: number; upheld: number; overturnRate: string }> = [];
  const statsIter = db.list<AppealStats>({ prefix: ["appeal-stats"] });
  for await (const entry of statsIter) {
    const auditor = String(entry.key[1]);
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
  const historyIter = db.list<AppealHistory>({ prefix: ["appeal-history"] });
  for await (const entry of historyIter) {
    recentAppeals.push(entry.value);
  }
  recentAppeals.sort((a, b) => b.timestamp - a.timestamp);

  // Per-judge stats (from decided entries)
  const judgeMap = new Map<string, { decisions: number; overturns: number; upholds: number }>();
  const decidedIter = db.list<JudgeDecision>({ prefix: ["judge-decided"] });
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

export async function getAppeal(findingId: string): Promise<AppealRecord | null> {
  const db = await kv();
  const entry = await db.get<AppealRecord>(["appeal", findingId]);
  return entry.value;
}

export async function saveAppeal(record: AppealRecord) {
  const db = await kv();
  await db.set(["appeal", record.findingId], record);
}
