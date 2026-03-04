/** Judge-specific KV operations: queue, locks, decisions, appeal stats. */

import { getFinding, saveFinding, getAllAnswersForFinding, getTranscript, fireWebhook, getBadgeStats, updateBadgeStats, getEarnedBadges, awardBadge, awardXp, getWebhookConfig, getEmailTemplate, listEmailTemplates } from "../lib/kv.ts";
import { sendEmail } from "../providers/postmark.ts";
import { env } from "../env.ts";
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

export async function claimNextItem(orgId: OrgId, judge: string): Promise<{
  current: (JudgeItem & { appealComment?: string }) | null;
  transcript: { raw: string; diarized: string } | null;
  peek: JudgeItem | null;
  remaining: number;
  auditRemaining: number;
}> {
  const db = await kv();
  const now = Date.now();
  const LOCK_TTL = 30 * 60 * 1000;

  let current: JudgeItem | null = null;
  let peek: JudgeItem | null = null;
  let remaining = 0;

  const iter = db.list<JudgeItem>({ prefix: orgKey(orgId, "judge-pending") });
  for await (const entry of iter) {
    remaining++;
    const item = entry.value;
    const lockKey = orgKey(orgId, "judge-lock", item.findingId, item.questionIndex);

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
    transcript = await getTranscript(orgId, current.findingId);
    const counterEntry = await db.get<number>(orgKey(orgId, "judge-audit-pending", current.findingId));
    auditRemaining = counterEntry.value ?? 0;

    // Enrich with appeal metadata from finding if not already on the item
    if (!current.appealType) {
      const finding = await getFinding(orgId, current.findingId);
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
      const finding = await getFinding(orgId, current.findingId);
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
  const db = await kv();

  const lockKey = orgKey(orgId, "judge-lock", findingId, questionIndex);
  const lockEntry = await db.get<{ claimedBy: string }>(lockKey);
  if (lockEntry.value && lockEntry.value.claimedBy !== judge) {
    return { success: false, auditComplete: false, newBadges: [] };
  }

  const pendingKey = orgKey(orgId, "judge-pending", findingId, questionIndex);
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

  const counterKey = orgKey(orgId, "judge-audit-pending", findingId);
  const counterEntry = await db.get<number>(counterKey);
  const currentCount = counterEntry.value ?? 1;
  const newCount = currentCount - 1;

  const atomic = db.atomic()
    .delete(lockKey)
    .delete(pendingKey)
    .set(orgKey(orgId, "judge-decided", findingId, questionIndex), decided);

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
    newBadges = checkBadges("judge", stats, earnedSet);

    let badgeXp = 0;
    for (const badge of newBadges) {
      await awardBadge(orgId, judge, badge);
      badgeXp += badge.xpReward;
    }
    await awardXp(orgId, judge, 10 + badgeXp, "judge");
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
  const db = await kv();

  // Release any current lock held by this judge
  const lockIter = db.list<{ claimedBy: string }>({ prefix: orgKey(orgId, "judge-lock") });
  for await (const entry of lockIter) {
    if (entry.value.claimedBy === judge) {
      await db.delete(entry.key);
    }
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

  const counterKey = orgKey(orgId, "judge-audit-pending", findingId);
  const counterEntry = await db.get<number>(counterKey);
  const newCount = (counterEntry.value ?? 0) + 1;

  const atomic = db.atomic()
    .check(latestDecided.entry)
    .check(counterEntry)
    .delete(latestDecided.entry.key)
    .set(orgKey(orgId, "judge-pending", findingId, questionIndex), item)
    .set(counterKey, newCount)
    .set(
      orgKey(orgId, "judge-lock", findingId, questionIndex),
      { claimedBy: judge, claimedAt: Date.now() },
      { expireIn: 30 * 60 * 1000 },
    );

  const res = await atomic.commit();
  if (!res.ok) {
    return { restored: null, transcript: null, peek: null, remaining: 0, auditRemaining: 0 };
  }

  const transcript = await getTranscript(orgId, findingId);

  let peek: JudgeItem | null = null;
  let remaining = 0;
  const pendingIter = db.list<JudgeItem>({ prefix: orgKey(orgId, "judge-pending") });
  for await (const entry of pendingIter) {
    remaining++;
    if (!peek && !(entry.value.findingId === findingId && entry.value.questionIndex === questionIndex)) {
      const lk = orgKey(orgId, "judge-lock", entry.value.findingId, entry.value.questionIndex);
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

  // Send judge-complete email to TM
  sendJudgeCompleteEmail(orgId, findingId, finding, originalScore, finalScore, overturns, total, judgedBy).catch((err) =>
    console.error(`[JUDGE] ${findingId}: Judge-complete email failed:`, err)
  );
}

/** Send appeal-resolved email to the TM after judge finalizes. */
async function sendJudgeCompleteEmail(
  orgId: OrgId,
  findingId: string,
  finding: Record<string, any>,
  originalScore: number,
  finalScore: number,
  overturns: number,
  total: number,
  judgedBy: string,
) {
  const judgeCfg = await getWebhookConfig(orgId, "judge").catch(() => null);
  const testEmail = judgeCfg?.testEmail;

  // Resolve template from judge config or fall back to template named "judge"
  let template = null;
  if (judgeCfg?.emailTemplateId) {
    template = await getEmailTemplate(orgId, judgeCfg.emailTemplateId);
  }
  if (!template) {
    const all = await listEmailTemplates(orgId);
    template = all.find((t) => t.name.toLowerCase().includes("judge") || t.name.toLowerCase().includes("appeal result")) ?? null;
  }

  const voEmail = String(finding.record?.VoEmail ?? "");
  const agentEmail = String(finding.owner ?? "");
  const voNameRaw = String(finding.record?.VoName ?? "");
  const teamMember = voNameRaw.includes(" - ") ? voNameRaw.split(" - ").slice(1).join(" - ").trim() : voNameRaw.trim();
  const teamMemberFirst = teamMember.split(" ")[0] || teamMember;
  const supervisorEmail = String(finding.record?.SupervisorEmail ?? "");
  const recordId = String(finding.record?.RecordId ?? "");
  const guestName = String(finding.record?.GuestName ?? "");
  const reportUrl = `${env.selfUrl}/audit/report?id=${findingId}`;

  const vars: Record<string, string> = {
    findingId,
    agentName: teamMember || agentEmail,
    agentEmail: voEmail || agentEmail,
    teamMemberFirst,
    recordId,
    guestName,
    supervisorEmail,
    originalScore: originalScore + "%",
    finalScore: finalScore + "%",
    overturns: String(overturns),
    totalQuestions: String(total),
    judgedBy,
    reportUrl,
  };
  const render = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");

  let subject: string;
  let htmlBody: string;

  if (template) {
    subject = render(template.subject);
    htmlBody = render(template.html);
  } else {
    const scoreColor = finalScore === 100 ? "#3fb950" : finalScore >= 80 ? "#58a6ff" : finalScore >= 60 ? "#d29922" : "#f85149";
    subject = `Appeal Result: ${teamMember || agentEmail} — Score ${finalScore}%`;
    htmlBody = `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#0d1117;color:#e6edf3;padding:24px;">
<h2 style="color:#58a6ff;">Appeal Result</h2>
<p>Hi ${teamMemberFirst || "there"},</p>
<p>Your appeal for guest <strong>${guestName}</strong> has been reviewed by our team.</p>
<table style="border:1px solid #30363d;border-radius:8px;padding:16px 20px;background:#161b22;margin:16px 0;">
  <tr><td style="padding:4px 12px 4px 0;color:#8b949e;font-size:11px;text-transform:uppercase;">Original Score</td><td style="font-weight:700;color:#8b949e;">${originalScore}%</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#8b949e;font-size:11px;text-transform:uppercase;">Final Score</td><td style="font-weight:700;color:${scoreColor};font-size:20px;">${finalScore}%</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#8b949e;font-size:11px;text-transform:uppercase;">Overturns</td><td style="font-weight:700;color:#e6edf3;">${overturns} of ${total}</td></tr>
</table>
<a href="${reportUrl}" style="padding:10px 20px;background:#238636;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">View Updated Report</a>
</body></html>`;
  }

  const to = testEmail || (voEmail || agentEmail);
  if (!to) { console.warn(`[JUDGE-EMAIL] ${findingId}: No recipient email`); return; }

  const cc = testEmail ? undefined : (supervisorEmail || undefined);
  const bcc = testEmail ? undefined : "ai@monsterrg.com,alexandera@monsterrg.com";
  await sendEmail({ to, subject, htmlBody, cc, bcc });
  console.log(`[JUDGE-EMAIL] ${findingId}: Sent → ${to}`);
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

export async function getAppeal(orgId: OrgId, findingId: string): Promise<AppealRecord | null> {
  const db = await kv();
  const entry = await db.get<AppealRecord>(orgKey(orgId, "appeal", findingId));
  return entry.value;
}

export async function saveAppeal(orgId: OrgId, record: AppealRecord) {
  const db = await kv();
  await db.set(orgKey(orgId, "appeal", record.findingId), record);
}
