/** Manager-specific KV operations: queue, remediation, stats, backfill. Org-scoped. */

import { Kv } from "../../../../core/data/kv/kv.ts";
import type { OrgId } from "../../../../core/data/kv/org.ts";
import { checkBadges } from "../../../../core/business/badges/mod.ts";
import type { BadgeDef } from "../../../../core/business/badges/mod.ts";

// -- Types --

export interface ManagerQueueItem {
  findingId: string;
  owner: string;
  recordId: string;
  recordingId: string;
  totalQuestions: number;
  failedCount: number;
  completedAt: number;
  jobTimestamp: string;
  status: "pending" | "addressed";
}

export interface ManagerRemediation {
  findingId: string;
  notes: string;
  addressedBy: string;
  addressedAt: number;
}

interface ReviewDecision {
  findingId: string;
  questionIndex: number;
  header: string;
  populated: string;
  thinking: string;
  defense: string;
  answer: string;
  decision: "confirm" | "flip";
  reviewer: string;
  decidedAt: number;
}

// -- Queue Population --

export async function populateManagerQueue(orgId: OrgId, findingId: string) {
  const kvInst = await Kv.getInstance();
  const db = kvInst.db;

  // Skip if already in queue
  const existing = await db.get(Kv.orgKey(orgId, "manager-queue", findingId));
  if (existing.value) return;

  // Scan all decided items for this finding
  const decisions: ReviewDecision[] = [];
  const iter = db.list<ReviewDecision>({ prefix: Kv.orgKey(orgId, "review-decided", findingId) });
  for await (const entry of iter) {
    decisions.push(entry.value);
  }

  // Count confirmed "No" decisions (failures the reviewer confirmed)
  const confirmedFailures = decisions.filter((d) => d.decision === "confirm");
  if (confirmedFailures.length === 0) return;

  // Load finding for metadata
  const finding = await kvInst.getFinding(orgId, findingId);
  if (!finding) {
    console.error(`[MANAGER] ${findingId}: Finding not found for queue population`);
    return;
  }

  const totalQuestions = finding.answeredQuestions?.length ?? 0;

  const queueItem: ManagerQueueItem = {
    findingId,
    owner: finding.owner ?? "",
    recordId: finding.record?.RecordId ?? finding.record?.id ?? "",
    recordingId: finding.recordingId ?? "",
    totalQuestions,
    failedCount: confirmedFailures.length,
    completedAt: Date.now(),
    jobTimestamp: finding.job?.timestamp ?? "",
    status: "pending",
  };

  await db.set(Kv.orgKey(orgId, "manager-queue", findingId), queueItem);
  console.log(`[MANAGER] ${findingId}: Added to manager queue (${confirmedFailures.length} confirmed failures)`);
}

// -- Queue CRUD --

export async function getManagerQueue(orgId: OrgId): Promise<ManagerQueueItem[]> {
  const db = (await Kv.getInstance()).db;
  const items: ManagerQueueItem[] = [];
  const iter = db.list<ManagerQueueItem>({ prefix: Kv.orgKey(orgId, "manager-queue") });
  for await (const entry of iter) {
    items.push(entry.value);
  }
  return items;
}

// -- Finding Detail --

export async function getManagerFindingDetail(orgId: OrgId, findingId: string) {
  const kvInst = await Kv.getInstance();
  const [finding, allAnswers, transcript] = await Promise.all([
    kvInst.getFinding(orgId, findingId),
    kvInst.getAllAnswersForFinding(orgId, findingId),
    kvInst.getTranscript(orgId, findingId),
  ]);

  if (!finding) return null;

  const db = kvInst.db;
  const [queueEntry, remediationEntry] = await Promise.all([
    db.get<ManagerQueueItem>(Kv.orgKey(orgId, "manager-queue", findingId)),
    db.get<ManagerRemediation>(Kv.orgKey(orgId, "manager-remediation", findingId)),
  ]);

  // Load decisions
  const decisions: ReviewDecision[] = [];
  const decidedIter = db.list<ReviewDecision>({ prefix: Kv.orgKey(orgId, "review-decided", findingId) });
  for await (const entry of decidedIter) {
    decisions.push(entry.value);
  }

  // Build answered questions with decisions overlaid
  const questions = allAnswers.map((q: Record<string, unknown>, i: number) => {
    const decision = decisions.find((d) => d.questionIndex === i);
    return {
      ...q,
      index: i,
      reviewDecision: decision?.decision ?? null,
      reviewer: decision?.reviewer ?? null,
      decidedAt: decision?.decidedAt ?? null,
    };
  });

  return {
    finding: {
      id: finding.id,
      owner: finding.owner,
      recordId: finding.record?.RecordId ?? finding.record?.id ?? "",
      recordingId: finding.recordingId,
      jobTimestamp: finding.job?.timestamp,
      record: finding.record,
    },
    questions,
    transcript,
    queueItem: queueEntry.value,
    remediation: remediationEntry.value,
  };
}

// -- Remediation --

export interface RemediationResult {
  success: boolean;
  xpGained: number;
  level: number;
  newBadges: BadgeDef[];
}

export async function submitRemediation(orgId: OrgId, findingId: string, notes: string, username: string): Promise<RemediationResult> {
  const kvInst = await Kv.getInstance();
  const db = kvInst.db;

  const queueEntry = await db.get<ManagerQueueItem>(Kv.orgKey(orgId, "manager-queue", findingId));
  if (!queueEntry.value) return { success: false, xpGained: 0, level: 0, newBadges: [] };

  const now = Date.now();
  const remediation: ManagerRemediation = {
    findingId,
    notes,
    addressedBy: username,
    addressedAt: now,
  };

  const updated: ManagerQueueItem = { ...queueEntry.value, status: "addressed" };
  await db.atomic()
    .set(Kv.orgKey(orgId, "manager-remediation", findingId), remediation)
    .set(Kv.orgKey(orgId, "manager-queue", findingId), updated)
    .commit();

  console.log(`[MANAGER] ${findingId}: Remediated by ${username}`);

  const finding = await kvInst.getFinding(orgId, findingId);
  kvInst.fireWebhook(orgId, "manager", {
    findingId,
    remediation: { notes, addressedBy: username, addressedAt: now },
    finding,
    remediatedAt: new Date().toISOString(),
  }).catch((err: unknown) => console.error(`[MANAGER] ${findingId}: Webhook failed:`, err));

  // -- Badge checking + XP --
  let newBadges: BadgeDef[] = [];
  let xpGained = 0;
  let level = 0;
  try {
    const stats = await kvInst.getBadgeStats(orgId, username);
    stats.totalRemediations++;

    // Track speed: time from queue arrival to remediation
    const arrivalTime = queueEntry.value.completedAt;
    const elapsedMs = now - arrivalTime;
    if (elapsedMs < 24 * 60 * 60 * 1000) stats.fastRemediations24h++;
    if (elapsedMs < 60 * 60 * 1000) stats.fastRemediations1h++;

    // Update streak
    const today = new Date().toISOString().slice(0, 10);
    if (stats.lastActiveDate !== today) {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      stats.dayStreak = stats.lastActiveDate === yesterday ? stats.dayStreak + 1 : 1;
      stats.lastActiveDate = today;
    }

    // Check if queue is now cleared
    const pending = await getManagerQueue(orgId);
    if (pending.filter((i) => i.status === "pending").length === 0) {
      stats.queueCleared = true;
      kvInst.checkAndEmitPrefab(orgId, "queue_cleared", username, `${username.split("@")[0]} cleared the queue!`)
        .catch(() => {});
    }

    await kvInst.updateBadgeStats(orgId, username, stats);

    const earned = await kvInst.getEarnedBadges(orgId, username);
    const earnedSet = new Set(earned.map((b) => b.badgeId));
    newBadges = checkBadges("manager", stats, earnedSet);

    let badgeXp = 0;
    for (const badge of newBadges) {
      await kvInst.awardBadge(orgId, username, badge);
      badgeXp += badge.xpReward;
    }

    // XP formula: 25 base + speed bonus + daily-first bonus
    let baseXp = 25;
    if (elapsedMs < 60 * 60 * 1000) baseXp += 30;       // within 1h
    else if (elapsedMs < 24 * 60 * 60 * 1000) baseXp += 15; // within 24h

    // daily-first bonus: check if this is the first remediation today
    const allRems: ManagerRemediation[] = [];
    const rIter = db.list<ManagerRemediation>({ prefix: Kv.orgKey(orgId, "manager-remediation") });
    for await (const entry of rIter) {
      if (entry.value.addressedBy === username) allRems.push(entry.value);
    }
    const todayStart = new Date(today + "T00:00:00Z").getTime();
    const todayRems = allRems.filter((r) => r.addressedAt >= todayStart && r.addressedAt < now);
    if (todayRems.length === 0) baseXp += 10; // daily-first bonus

    const totalXp = baseXp + badgeXp;
    const result = await kvInst.awardXp(orgId, username, totalXp, "manager");
    xpGained = totalXp;
    level = result.state.level;
  } catch (err) {
    console.error(`[MANAGER] Badge check error for ${username}:`, err);
  }

  return { success: true, xpGained, level, newBadges };
}

// -- Stats --

export async function getManagerStats(orgId: OrgId) {
  const db = (await Kv.getInstance()).db;

  const items: ManagerQueueItem[] = [];
  const remediations: ManagerRemediation[] = [];

  const qIter = db.list<ManagerQueueItem>({ prefix: Kv.orgKey(orgId, "manager-queue") });
  for await (const entry of qIter) items.push(entry.value);

  const rIter = db.list<ManagerRemediation>({ prefix: Kv.orgKey(orgId, "manager-remediation") });
  for await (const entry of rIter) remediations.push(entry.value);

  const now = Date.now();
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

  const outstanding = items.filter((i) => i.status === "pending").length;
  const addressedThisWeek = remediations.filter((r) => now - r.addressedAt < WEEK_MS).length;
  const total = items.length;

  // Average resolution time
  const resolved = remediations.filter((r) => items.some((i) => i.findingId === r.findingId));
  const avgResolution = resolved.length > 0
    ? resolved.reduce((sum, r) => {
        const item = items.find((i) => i.findingId === r.findingId)!;
        return sum + (r.addressedAt - item.completedAt);
      }, 0) / resolved.length
    : 0;

  // Aging buckets (outstanding only)
  const aging = { lt24h: 0, lt72h: 0, lt1w: 0, gt1w: 0 };
  for (const item of items) {
    if (item.status !== "pending") continue;
    const age = now - item.completedAt;
    if (age < 24 * 60 * 60 * 1000) aging.lt24h++;
    else if (age < 72 * 60 * 60 * 1000) aging.lt72h++;
    else if (age < WEEK_MS) aging.lt1w++;
    else aging.gt1w++;
  }

  // Most commonly failed questions
  const questionFailCounts: Record<string, number> = {};
  for (const item of items) {
    const dIter = db.list<ReviewDecision>({ prefix: Kv.orgKey(orgId, "review-decided", item.findingId) });
    for await (const entry of dIter) {
      if (entry.value.decision === "confirm") {
        const header = entry.value.header || "Unknown";
        questionFailCounts[header] = (questionFailCounts[header] || 0) + 1;
      }
    }
  }
  const topFailedQuestions = Object.entries(questionFailCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([header, count]) => ({ header, count }));

  // Per-agent failure rates
  const agentStats: Record<string, { total: number; failed: number }> = {};
  for (const item of items) {
    const agent = item.owner || "Unknown";
    if (!agentStats[agent]) agentStats[agent] = { total: 0, failed: 0 };
    agentStats[agent].total++;
    agentStats[agent].failed += item.failedCount;
  }
  const agentRates = Object.entries(agentStats)
    .map(([agent, s]) => ({ agent, audits: s.total, totalFailures: s.failed }))
    .sort((a, b) => b.totalFailures - a.totalFailures);

  // Weekly trend (last 8 weeks)
  const weeklyTrend: Array<{ weekStart: string; added: number; resolved: number }> = [];
  for (let w = 7; w >= 0; w--) {
    const weekStart = now - (w + 1) * WEEK_MS;
    const weekEnd = now - w * WEEK_MS;
    const added = items.filter((i) => i.completedAt >= weekStart && i.completedAt < weekEnd).length;
    const wResolved = remediations.filter((r) => r.addressedAt >= weekStart && r.addressedAt < weekEnd).length;
    weeklyTrend.push({
      weekStart: new Date(weekStart).toISOString().slice(0, 10),
      added,
      resolved: wResolved,
    });
  }

  return {
    outstanding,
    addressedThisWeek,
    total,
    avgResolutionMs: Math.round(avgResolution),
    aging,
    topFailedQuestions,
    agentRates,
    weeklyTrend,
  };
}

// -- Backfill --

export async function backfillManagerQueue(orgId: OrgId) {
  const kvInst = await Kv.getInstance();
  const db = kvInst.db;
  let added = 0;

  // Scan all review-decided entries, group by findingId
  const decidedByFinding: Record<string, ReviewDecision[]> = {};
  const decidedIter = db.list<ReviewDecision>({ prefix: Kv.orgKey(orgId, "review-decided") });
  for await (const entry of decidedIter) {
    const fid = entry.value.findingId;
    if (!decidedByFinding[fid]) decidedByFinding[fid] = [];
    decidedByFinding[fid].push(entry.value);
  }

  for (const [findingId, decisions] of Object.entries(decidedByFinding)) {
    // Skip if still has pending review items
    const pendingIter = db.list({ prefix: Kv.orgKey(orgId, "review-pending", findingId) });
    let hasPending = false;
    for await (const _ of pendingIter) {
      hasPending = true;
      break;
    }
    if (hasPending) continue;

    // Skip if already in manager queue
    const existing = await db.get(Kv.orgKey(orgId, "manager-queue", findingId));
    if (existing.value) continue;

    // Check for confirmed failures
    const confirmedFailures = decisions.filter((d) => d.decision === "confirm");
    if (confirmedFailures.length === 0) continue;

    // Load finding metadata
    const finding = await kvInst.getFinding(orgId, findingId);
    if (!finding) continue;

    const totalQuestions = finding.answeredQuestions?.length ?? 0;

    const queueItem: ManagerQueueItem = {
      findingId,
      owner: finding.owner ?? "",
      recordId: finding.record?.RecordId ?? finding.record?.id ?? "",
      recordingId: finding.recordingId ?? "",
      totalQuestions,
      failedCount: confirmedFailures.length,
      completedAt: decisions.reduce((max, d) => Math.max(max, d.decidedAt), 0),
      jobTimestamp: finding.job?.timestamp ?? "",
      status: "pending",
    };

    await db.set(Kv.orgKey(orgId, "manager-queue", findingId), queueItem);
    added++;
  }

  return { added };
}
