/** Review queue service — FIFO ordering, claim/decide/back logic.
 *  Pure business logic for queue operations. KV interactions via getKv(). */

import { getKv, orgKey } from "@core/domain/data/deno-kv/mod.ts";
import type { OrgId } from "@core/domain/data/deno-kv/mod.ts";
import type { ReviewItem, ReviewDecision } from "@core/dto/types.ts";

const ACTIVE_TTL = 30 * 60 * 1000; // 30 minutes

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

// ── Decision recording ───────────────────────────────────────────────────────

export async function recordDecision(
  orgId: OrgId,
  findingId: string,
  questionIndex: number,
  decision: "confirm" | "flip",
  reviewer: string,
): Promise<{ remaining: number }> {
  const db = await getKv();
  const now = Date.now();

  // Save decision
  const decisionRecord: ReviewDecision = {
    findingId, questionIndex, decision, reviewer, decidedAt: now,
  };
  await db.set(orgKey(orgId, "review-decided", findingId, questionIndex), decisionRecord);

  // Remove from active
  await db.delete(orgKey(orgId, "review-active", reviewer, findingId, questionIndex));

  // Decrement pending counter
  const counterKey = orgKey(orgId, "review-audit-pending", findingId);
  const counter = await db.get<number>(counterKey);
  const newCount = Math.max(0, (counter.value ?? 1) - 1);
  await db.set(counterKey, newCount);

  console.log(`✅ [REVIEW] ${findingId}/${questionIndex}: ${decision} by ${reviewer} (${newCount} remaining)`);
  return { remaining: newCount };
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
  for await (const entry of db.list({ prefix: orgKey(orgId, "review-decided") })) {
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
