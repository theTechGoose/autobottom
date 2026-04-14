/** Judge queue repository — appeals, decisions, queue ops.
 *  Ported from judge/kv.ts core queue operations. */

import { getKv, orgKey } from "@core/data/deno-kv/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";
import type { JudgeDecision, AppealRecord } from "@core/dto/types.ts";

const ACTIVE_TTL = 30 * 60 * 1000;

export interface JudgeItem {
  findingId: string;
  questionIndex: number;
  header: string;
  populated: string;
  thinking: string;
  defense: string;
  answer: string;
  appealType?: string;
  recordingIdField?: string;
  recordingId?: string;
}

// ── Queue Population ─────────────────────────────────────────────────────────

export async function populateJudgeQueue(
  orgId: OrgId, findingId: string, questions: any[], appealType?: string,
  recordingIdField?: string, recordingId?: string,
): Promise<void> {
  const db = await getKv();
  const atomic = db.atomic();
  let count = 0;
  for (const [i, q] of questions.entries()) {
    const idx = q._origIdx ?? i;
    const item: JudgeItem = {
      findingId, questionIndex: idx, header: q.header ?? "", populated: q.populated ?? "",
      thinking: q.thinking ?? "", defense: q.defense ?? "", answer: q.answer ?? "",
      ...(appealType ? { appealType } : {}),
      ...(recordingIdField ? { recordingIdField } : {}),
      ...(recordingId ? { recordingId } : {}),
    };
    atomic.set(orgKey(orgId, "judge-pending", findingId, idx), item);
    count++;
  }
  atomic.set(orgKey(orgId, "judge-audit-pending", findingId), count);
  await atomic.commit();
  console.log(`✅ [JUDGE] ${findingId}: Queued ${count} items for judge review`);
}

// ── Decision Recording ───────────────────────────────────────────────────────

export async function recordJudgeDecision(
  orgId: OrgId, findingId: string, questionIndex: number,
  decision: "uphold" | "overturn", judge: string, reason?: string,
): Promise<{ remaining: number }> {
  const db = await getKv();
  await db.set(orgKey(orgId, "judge-decided", findingId, questionIndex), { findingId, questionIndex, decision, judge, reason, decidedAt: Date.now() });
  await db.delete(orgKey(orgId, "judge-active", judge, findingId, questionIndex));
  const counterKey = orgKey(orgId, "judge-audit-pending", findingId);
  const counter = (await db.get<number>(counterKey)).value ?? 1;
  const newCount = Math.max(0, counter - 1);
  await db.set(counterKey, newCount);
  return { remaining: newCount };
}

// ── Appeal CRUD ──────────────────────────────────────────────────────────────

export async function getAppeal(orgId: OrgId, findingId: string): Promise<AppealRecord | null> {
  return (await (await getKv()).get<AppealRecord>(orgKey(orgId, "appeal", findingId))).value;
}

export async function saveAppeal(orgId: OrgId, record: AppealRecord): Promise<void> {
  await (await getKv()).set(orgKey(orgId, "appeal", findingId(record)), record);
}

function findingId(record: AppealRecord): string { return record.findingId; }

export async function deleteAppeal(orgId: OrgId, fid: string): Promise<void> {
  await (await getKv()).delete(orgKey(orgId, "appeal", fid));
}

// ── Stats ────────────────────────────────────────────────────────────────────

export async function getJudgeStats(orgId: OrgId): Promise<{ pending: number; decided: number }> {
  const db = await getKv();
  let pending = 0, decided = 0;
  for await (const _ of db.list({ prefix: orgKey(orgId, "judge-pending") })) pending++;
  for await (const _ of db.list({ prefix: orgKey(orgId, "judge-decided") })) decided++;
  return { pending, decided };
}

// ── Dismiss ──────────────────────────────────────────────────────────────────

export async function dismissFindingFromJudgeQueue(orgId: OrgId, fid: string): Promise<{ dismissed: number }> {
  const db = await getKv();
  let dismissed = 0;
  for await (const entry of db.list({ prefix: orgKey(orgId, "judge-pending", fid) })) {
    await db.delete(entry.key);
    dismissed++;
  }
  for await (const entry of db.list({ prefix: orgKey(orgId, "judge-active") })) {
    const v = entry.value as any;
    if (v?.findingId === fid) { await db.delete(entry.key); dismissed++; }
  }
  return { dismissed };
}

export async function clearJudgeQueue(orgId: OrgId): Promise<{ cleared: number }> {
  const db = await getKv();
  let cleared = 0;
  for await (const entry of db.list({ prefix: orgKey(orgId, "judge-pending") })) { await db.delete(entry.key); cleared++; }
  for await (const entry of db.list({ prefix: orgKey(orgId, "judge-active") })) { await db.delete(entry.key); cleared++; }
  return { cleared };
}
