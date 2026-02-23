/** Manager-specific KV operations: auth, queue, remediation, stats, backfill. */

import { getFinding, getAllAnswersForFinding, getTranscript, fireWebhook } from "../lib/kv.ts";

let _kv: Deno.Kv | undefined;

async function kv(): Promise<Deno.Kv> {
  if (!_kv) _kv = await Deno.openKv();
  return _kv;
}

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

// -- Auth --

async function hashPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(password);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function createManagerUser(username: string, password: string) {
  const db = await kv();
  const passwordHash = await hashPassword(password);
  await db.set(["manager-user", username], { passwordHash });
}

export async function verifyManagerUser(username: string, password: string): Promise<boolean> {
  const db = await kv();
  const entry = await db.get<{ passwordHash: string }>(["manager-user", username]);
  if (!entry.value) return false;
  const hash = await hashPassword(password);
  return hash === entry.value.passwordHash;
}

export async function hasAnyManagerUsers(): Promise<boolean> {
  const db = await kv();
  const iter = db.list({ prefix: ["manager-user"] });
  for await (const _ of iter) return true;
  return false;
}

export async function createManagerSession(username: string): Promise<string> {
  const db = await kv();
  const token = crypto.randomUUID();
  await db.set(["manager-session", token], { username, createdAt: Date.now() }, { expireIn: 24 * 60 * 60 * 1000 });
  return token;
}

export async function getManagerSession(token: string): Promise<string | null> {
  const db = await kv();
  const entry = await db.get<{ username: string }>(["manager-session", token]);
  return entry.value?.username ?? null;
}

export async function deleteManagerSession(token: string) {
  const db = await kv();
  await db.delete(["manager-session", token]);
}

// -- Queue Population --

export async function populateManagerQueue(findingId: string) {
  const db = await kv();

  // Skip if already in queue
  const existing = await db.get(["manager-queue", findingId]);
  if (existing.value) return;

  // Scan all decided items for this finding
  const decisions: ReviewDecision[] = [];
  const iter = db.list<ReviewDecision>({ prefix: ["review-decided", findingId] });
  for await (const entry of iter) {
    decisions.push(entry.value);
  }

  // Count confirmed "No" decisions (failures the reviewer confirmed)
  const confirmedFailures = decisions.filter((d) => d.decision === "confirm");
  if (confirmedFailures.length === 0) return;

  // Load finding for metadata
  const finding = await getFinding(findingId);
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

  await db.set(["manager-queue", findingId], queueItem);
  console.log(`[MANAGER] ${findingId}: Added to manager queue (${confirmedFailures.length} confirmed failures)`);
}

// -- Queue CRUD --

export async function getManagerQueue(): Promise<ManagerQueueItem[]> {
  const db = await kv();
  const items: ManagerQueueItem[] = [];
  const iter = db.list<ManagerQueueItem>({ prefix: ["manager-queue"] });
  for await (const entry of iter) {
    items.push(entry.value);
  }
  return items;
}

// -- Finding Detail --

export async function getManagerFindingDetail(findingId: string) {
  const [finding, allAnswers, transcript] = await Promise.all([
    getFinding(findingId),
    getAllAnswersForFinding(findingId),
    getTranscript(findingId),
  ]);

  if (!finding) return null;

  const db = await kv();
  const [queueEntry, remediationEntry] = await Promise.all([
    db.get<ManagerQueueItem>(["manager-queue", findingId]),
    db.get<ManagerRemediation>(["manager-remediation", findingId]),
  ]);

  // Load decisions
  const decisions: ReviewDecision[] = [];
  const decidedIter = db.list<ReviewDecision>({ prefix: ["review-decided", findingId] });
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

export async function submitRemediation(findingId: string, notes: string, username: string): Promise<boolean> {
  const db = await kv();

  const queueEntry = await db.get<ManagerQueueItem>(["manager-queue", findingId]);
  if (!queueEntry.value) return false;

  const remediation: ManagerRemediation = {
    findingId,
    notes,
    addressedBy: username,
    addressedAt: Date.now(),
  };

  const updated: ManagerQueueItem = { ...queueEntry.value, status: "addressed" };
  await db.atomic()
    .set(["manager-remediation", findingId], remediation)
    .set(["manager-queue", findingId], updated)
    .commit();

  console.log(`[MANAGER] ${findingId}: Remediated by ${username}`);

  const finding = await getFinding(findingId);
  fireWebhook("manager", {
    findingId,
    remediation: { notes, addressedBy: username, addressedAt: Date.now() },
    finding,
    remediatedAt: new Date().toISOString(),
  }).catch((err) => console.error(`[MANAGER] ${findingId}: Webhook failed:`, err));

  return true;
}

// -- Stats --

export async function getManagerStats() {
  const db = await kv();

  const items: ManagerQueueItem[] = [];
  const remediations: ManagerRemediation[] = [];

  const qIter = db.list<ManagerQueueItem>({ prefix: ["manager-queue"] });
  for await (const entry of qIter) items.push(entry.value);

  const rIter = db.list<ManagerRemediation>({ prefix: ["manager-remediation"] });
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
    const dIter = db.list<ReviewDecision>({ prefix: ["review-decided", item.findingId] });
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

export async function backfillManagerQueue() {
  const db = await kv();
  let added = 0;

  // Scan all review-decided entries, group by findingId
  const decidedByFinding: Record<string, ReviewDecision[]> = {};
  const decidedIter = db.list<ReviewDecision>({ prefix: ["review-decided"] });
  for await (const entry of decidedIter) {
    const fid = entry.value.findingId;
    if (!decidedByFinding[fid]) decidedByFinding[fid] = [];
    decidedByFinding[fid].push(entry.value);
  }

  for (const [findingId, decisions] of Object.entries(decidedByFinding)) {
    // Skip if still has pending review items
    const pendingIter = db.list({ prefix: ["review-pending", findingId] });
    let hasPending = false;
    for await (const _ of pendingIter) {
      hasPending = true;
      break;
    }
    if (hasPending) continue;

    // Skip if already in manager queue
    const existing = await db.get(["manager-queue", findingId]);
    if (existing.value) continue;

    // Check for confirmed failures
    const confirmedFailures = decisions.filter((d) => d.decision === "confirm");
    if (confirmedFailures.length === 0) continue;

    // Load finding metadata
    const finding = await getFinding(findingId);
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

    await db.set(["manager-queue", findingId], queueItem);
    added++;
  }

  return { added };
}
