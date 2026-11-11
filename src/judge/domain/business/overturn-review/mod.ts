/** Overturn Review (REQ-047..051). An appeal the judge finished with ANY
 *  overturn does not close: it waits here until the judges, as a team, confirm
 *  or reverse each overturn. Nothing about the audit changes while it waits —
 *  no score, payroll, manager-queue or email — so a reversal has nothing to
 *  unwind. The final calls are written back as the judge decisions and the
 *  ordinary close-out (postJudgedAudit) runs once, sending the one email.
 *
 *  Storage: one "overturn-review" row per held appeal, keyed [findingId], read
 *  the same way as judge-pending — no new Firestore index. The appeal record
 *  stays "pending" and carries `overturnReviewHeldAt` so every screen keeps
 *  saying the appeal is not decided yet. */
import type { OrgId } from "@core/data/deno-kv/mod.ts";
import type { AppealRecord, JudgeDecision } from "@core/dto/types.ts";
import { deleteStored, getStored, listStoredWithKeysAll, setStored } from "@core/data/firestore/mod.ts";
import { getFinding, getTranscript } from "@audit/domain/data/audit-repository/mod.ts";
import { buildRecordMeta } from "@core/business/record-meta/mod.ts";

export type OverturnVerdict = "confirm" | "reverse";

export interface OverturnVerdictRecord {
  verdict: OverturnVerdict;
  note?: string;
  by: string;
  at: number;
}

/** The stored row — what is held, by whom, and the team's calls so far. */
export interface OverturnReviewRow {
  findingId: string;
  judge: string;
  heldAt: number;
  /** questionIndex → the team's call on that overturn. */
  verdicts: Record<string, OverturnVerdictRecord>;
}

export interface OverturnReviewQuestion {
  questionIndex: number;
  header: string;
  populated?: string;
  thinking?: string;
  defense?: string;
  /** The bot's answer the reviewer let stand. */
  botAnswer: string;
  decision: "overturn" | "uphold";
  judge: string;
  /** The reviewer who confirmed the fail. */
  reviewer?: string;
  verdict?: OverturnVerdictRecord;
}

/** A held appeal, hydrated for the page. */
export interface OverturnReviewItem {
  findingId: string;
  judge: string;
  heldAt: number;
  auditor?: string;
  appealComment?: string;
  appealedAt?: number;
  recordId?: string;
  recordingIdField?: string;
  recordMeta?: Record<string, string | undefined>;
  /** Overturned questions first (the ones that take a call), then upheld. */
  questions: OverturnReviewQuestion[];
  transcript: { raw: string; diarized: string; utteranceTimes?: number[] } | null;
}

const ROW = "overturn-review";
const CONFIG = "overturn-review-config";

// ── Off switch (REQ-051) ─────────────────────────────────────────────────────

/** On unless an admin turned it off. */
export async function isOverturnReviewEnabled(orgId: OrgId): Promise<boolean> {
  const cfg = await getStored<{ enabled?: boolean }>(CONFIG, orgId);
  return cfg?.enabled !== false;
}

export async function setOverturnReviewEnabled(orgId: OrgId, enabled: boolean): Promise<void> {
  await setStored(CONFIG, orgId, [], { enabled });
}

// ── Hold ─────────────────────────────────────────────────────────────────────

async function decisionsFor(orgId: OrgId, findingId: string): Promise<JudgeDecision[]> {
  const finding = await getFinding(orgId, findingId);
  const n = ((finding?.answeredQuestions ?? []) as unknown[]).length;
  const rows = await Promise.all(
    Array.from({ length: n }, (_, i) => getStored<JudgeDecision>("judge-decided", orgId, findingId, i)),
  );
  return rows.filter((d): d is JudgeDecision => d !== null);
}

/** Called when a judge decides the last question of an appeal. Holds the
 *  appeal when the judge overturned anything and the queue is on; otherwise
 *  closes it as it always has. Returns which way it went. */
export async function finishJudgedAppeal(
  orgId: OrgId, findingId: string, judge: string,
): Promise<"held" | "closed"> {
  const decisions = await decisionsFor(orgId, findingId);
  if (decisions.some((d) => d.decision === "overturn") && await isOverturnReviewEnabled(orgId)) {
    await holdForOverturnReview(orgId, findingId, judge);
    return "held";
  }
  const { postJudgedAudit } = await import("@judge/domain/data/judge-repository/mod.ts");
  await postJudgedAudit(orgId, findingId, judge);
  return "closed";
}

async function holdForOverturnReview(orgId: OrgId, findingId: string, judge: string): Promise<void> {
  const now = Date.now();
  await setStored(ROW, orgId, [findingId], { findingId, judge, heldAt: now, verdicts: {} } satisfies OverturnReviewRow);
  const appeal = await getStored<AppealRecord>("appeal", orgId, findingId);
  if (appeal) await setStored("appeal", orgId, [findingId], { ...appeal, overturnReviewHeldAt: now });
  console.log(`[OVERTURN-REVIEW] ${findingId}: held for team review (judge=${judge})`);
}

// ── Read ─────────────────────────────────────────────────────────────────────

async function reviewerFor(
  orgId: OrgId, findingId: string, questionIndex: number, answered: Array<Record<string, unknown>>,
  auditReviewer: string | undefined,
): Promise<string | undefined> {
  const rd = await getStored<{ reviewer?: string }>("review-decided", orgId, findingId, questionIndex);
  return rd?.reviewer || (answered[questionIndex]?.reviewedBy as string | undefined) || auditReviewer;
}

async function hydrate(orgId: OrgId, row: OverturnReviewRow): Promise<OverturnReviewItem> {
  const [finding, decisions, appeal, transcript, done] = await Promise.all([
    getFinding(orgId, row.findingId),
    decisionsFor(orgId, row.findingId),
    getStored<AppealRecord>("appeal", orgId, row.findingId),
    getTranscript(orgId, row.findingId),
    getStored<{ reviewedBy?: string }>("review-done", orgId, row.findingId),
  ]);
  const f = (finding ?? {}) as Record<string, unknown>;
  const answered = (f.answeredQuestions ?? []) as Array<Record<string, unknown>>;
  const questions = await Promise.all(
    decisions
      .sort((a, b) =>
        Number(b.decision === "overturn") - Number(a.decision === "overturn") || a.questionIndex - b.questionIndex
      )
      .map(async (d): Promise<OverturnReviewQuestion> => ({
        questionIndex: d.questionIndex,
        header: String(d.header ?? answered[d.questionIndex]?.header ?? `Question ${d.questionIndex + 1}`),
        populated: d.populated,
        thinking: d.thinking,
        defense: d.defense,
        botAnswer: String(d.answer ?? answered[d.questionIndex]?.answer ?? "No"),
        decision: d.decision,
        judge: d.judge,
        reviewer: await reviewerFor(orgId, row.findingId, d.questionIndex, answered, done?.reviewedBy),
        verdict: row.verdicts[String(d.questionIndex)],
      })),
  );
  const rec = (f.record ?? {}) as Record<string, unknown>;
  return {
    findingId: row.findingId,
    judge: row.judge,
    heldAt: row.heldAt,
    auditor: appeal?.auditor ?? (f.owner as string | undefined),
    appealComment: (f.appealComment as string | undefined) || appeal?.comment,
    appealedAt: appeal?.appealedAt,
    recordId: String(rec.RecordId ?? "") || undefined,
    recordingIdField: f.recordingIdField as string | undefined,
    recordMeta: buildRecordMeta(rec, f.recordingIdField as string | undefined),
    questions,
    transcript,
  };
}

/** Every held appeal's row, oldest first. Cheap — no hydration. */
export async function listOverturnReviewRows(orgId: OrgId): Promise<OverturnReviewRow[]> {
  return (await listStoredWithKeysAll<OverturnReviewRow>(ROW, orgId))
    .map(({ value }) => value)
    .filter((v) => v?.findingId)
    .sort((a, b) => a.heldAt - b.heldAt);
}

/** The held appeal to show: `findingId` when given and held, else the oldest. */
export async function getOverturnReviewItem(
  orgId: OrgId, findingId?: string,
): Promise<{ item: OverturnReviewItem | null; remaining: number }> {
  const rows = await listOverturnReviewRows(orgId);
  const row = (findingId && rows.find((r) => r.findingId === findingId)) || rows[0];
  return { item: row ? await hydrate(orgId, row) : null, remaining: rows.length };
}

// ── Decide + finalize ────────────────────────────────────────────────────────

export class OverturnReviewError extends Error {}

/** Record the team's call on one overturned question. A reversal needs a note.
 *  When every overturned question has a call, the appeal closes on the final
 *  decisions and the appeal-result email goes out. */
export async function decideOverturnReview(
  orgId: OrgId, findingId: string, questionIndex: number,
  verdict: OverturnVerdict, by: string, note?: string,
): Promise<{ finalized: boolean }> {
  const row = await getStored<OverturnReviewRow>(ROW, orgId, findingId);
  if (!row) throw new OverturnReviewError("This appeal is not waiting for overturn review");
  const decision = await getStored<JudgeDecision>("judge-decided", orgId, findingId, questionIndex);
  if (decision?.decision !== "overturn") throw new OverturnReviewError("Only an overturned question takes a team call");
  const trimmed = (note ?? "").trim();
  if (verdict === "reverse" && !trimmed) throw new OverturnReviewError("A note is required to reverse an overturn");

  const verdicts = {
    ...row.verdicts,
    [String(questionIndex)]: { verdict, by, at: Date.now(), ...(trimmed ? { note: trimmed } : {}) },
  };
  await setStored(ROW, orgId, [findingId], { ...row, verdicts });

  const overturned = (await decisionsFor(orgId, findingId)).filter((d) => d.decision === "overturn");
  if (!overturned.every((d) => verdicts[String(d.questionIndex)])) return { finalized: false };

  await finalize(orgId, { ...row, verdicts }, overturned);
  return { finalized: true };
}

async function finalize(orgId: OrgId, row: OverturnReviewRow, overturned: JudgeDecision[]): Promise<void> {
  // A reversed overturn becomes an uphold, the team's note its reason — the
  // email shows it exactly like a judge's uphold reason.
  for (const d of overturned) {
    const v = row.verdicts[String(d.questionIndex)];
    if (v.verdict !== "reverse") continue;
    await setStored("judge-decided", orgId, [row.findingId, d.questionIndex], {
      ...d,
      decision: "uphold",
      // An uphold's reason is the free text the email prints, not the
      // overturn-reason enum the type names.
      reason: v.note as JudgeDecision["reason"],
      teamReversal: { by: v.by, at: v.at, overturnedBy: d.judge, overturnReason: d.reason ?? null },
    });
  }
  await deleteStored(ROW, orgId, row.findingId);
  const appeal = await getStored<AppealRecord>("appeal", orgId, row.findingId);
  if (appeal) {
    const { overturnReviewHeldAt: _, ...rest } = appeal;
    await setStored("appeal", orgId, [row.findingId], rest);
  }
  const { postJudgedAudit } = await import("@judge/domain/data/judge-repository/mod.ts");
  await postJudgedAudit(orgId, row.findingId, row.judge);
  console.log(`[OVERTURN-REVIEW] ${row.findingId}: finalized`);
}
