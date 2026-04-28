/** File-appeal business module — ports prod main:controller.ts handleFileAppeal.
 *  Invoked by AuditController.fileAppeal. Loads the finding, queues the selected
 *  failed questions into the judge pipeline, writes an AppealRecord, and fires
 *  the "appeal" webhook (which routes to sendAppealFiledEmail via the webhook
 *  handler registry). */

import type { OrgId } from "@core/data/deno-kv/mod.ts";
import { getFinding, saveFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { populateJudgeQueue, saveAppeal } from "@judge/domain/data/judge-repository/mod.ts";
import { fireWebhook } from "@admin/domain/data/admin-repository/mod.ts";

export interface FileAppealInput {
  auditor: string;
  comment?: string;
  appealedQuestions: number[];
}

export interface FileAppealResult {
  ok: true;
  judgeUrl: string;
  queued: number;
}

async function step<T>(label: string, fid: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error(`❌ [APPEAL:${label}] fid=${fid}:`, err);
    throw new Error(`appeal ${label} failed: ${(err as Error).message}`);
  }
}

export async function fileJudgeAppeal(
  orgId: OrgId,
  findingId: string,
  input: FileAppealInput,
): Promise<FileAppealResult> {
  console.log(`🚀 [APPEAL] start fid=${findingId} auditor=${input.auditor} qs=${input.appealedQuestions.join(",")}`);

  const finding = await step("getFinding", findingId, () => getFinding(orgId, findingId));
  if (!finding) throw new Error(`finding not found: ${findingId}`);

  const all = (finding.answeredQuestions ?? []) as Array<Record<string, unknown>>;
  if (!all.length) throw new Error(`no answered questions on finding ${findingId} — Invalid Genie audits can only be re-audited, not appealed`);

  const wanted = new Set(input.appealedQuestions);
  const questionsToQueue = all
    .map((q, i) => ({ q, i }))
    .filter(({ q, i }) => wanted.has(i) && String(q.answer ?? "").toLowerCase() === "no")
    .map(({ q, i }) => ({
      _origIdx: i,
      header: q.header ?? "",
      populated: q.populated ?? "",
      thinking: q.thinking ?? "",
      defense: q.defense ?? "",
      answer: q.answer ?? "No",
    }));

  if (!questionsToQueue.length) throw new Error("no matching failed questions to appeal");

  await step("populateJudgeQueue", findingId, () => populateJudgeQueue(
    orgId,
    findingId,
    questionsToQueue,
    "redo",
    finding.recordingIdField as string | undefined,
    finding.recordingId as string | undefined,
  ));

  const appealedAt = Date.now();
  await step("saveAppeal", findingId, () => saveAppeal(orgId, {
    findingId,
    appealedAt,
    status: "pending",
    auditor: input.auditor,
    ...(input.comment ? { comment: input.comment } : {}),
    appealedQuestions: questionsToQueue.map((q) => String(q._origIdx)),
  }));

  // Persist comment onto the finding so the judge queue can surface it alongside
  // the questions (matches prod behavior — judge sees agent's appeal note).
  // Best-effort — the judge queue + appeal record are the critical writes.
  if (input.comment) {
    try {
      await saveFinding(orgId, { ...finding, appealComment: input.comment });
    } catch (err) {
      console.error(`⚠️ [APPEAL] saveFinding comment failed fid=${findingId} (non-fatal):`, err);
    }
  }

  fireWebhook(orgId, "appeal", {
    findingId,
    finding,
    auditor: input.auditor,
    questionCount: questionsToQueue.length,
    comment: input.comment ?? "",
    appealedAt,
  }).catch((err) => console.error(`❌ [APPEAL] fireWebhook failed fid=${findingId}:`, err));

  console.log(`📣 [APPEAL] ${findingId}: queued ${questionsToQueue.length} judge items (auditor=${input.auditor})`);
  return { ok: true, judgeUrl: "/judge", queued: questionsToQueue.length };
}
