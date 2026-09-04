/** File-appeal business module — ports prod main:controller.ts handleFileAppeal.
 *  Invoked by AuditController.fileAppeal. Loads the finding, queues the selected
 *  failed questions into the judge pipeline, writes an AppealRecord, and fires
 *  the "appeal" webhook (which routes to sendAppealFiledEmail via the webhook
 *  handler registry). */

import type { OrgId } from "@core/data/deno-kv/mod.ts";
import { asAnswerText } from "@core/dto/types.ts";
import { getFinding, saveFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { populateJudgeQueue, saveAppeal } from "@judge/domain/data/judge-repository/mod.ts";
import { fireWebhook } from "@admin/domain/data/admin-repository/mod.ts";
import { writeSoleAuditDoneIndex, buildIndexMeta } from "@audit/domain/data/stats-repository/mod.ts";
import type { AuditDoneIndexEntry } from "@core/dto/types.ts";

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

  // Mirror frontend's isYes predicate (components/AuditReport.tsx). The
  // frontend renders any question where !isYes(answer) as appealable.
  // Previously the backend filtered on `answer.toLowerCase() === "no"` —
  // strict equality rejected real-world answers like "No ", "No.", "N",
  // "failed", or empty strings that the frontend cheerfully exposed as
  // appealable. End-state: user clicks, gets misleading
  // "no matching failed questions to appeal" error. Symmetric predicate
  // means whatever the user could check, the backend will queue.
  const isYes = (a: unknown): boolean => {
    const s = String(a ?? "").trim().toLowerCase();
    return s.startsWith("yes") || s === "true" || s === "y" || s === "1";
  };

  const wanted = new Set(input.appealedQuestions);
  const questionsToQueue = all
    .map((q, i) => ({ q, i }))
    .filter(({ q, i }) => wanted.has(i) && !isYes(q.answer))
    .map(({ q, i }) => ({
      _origIdx: i,
      header: q.header ?? "",
      populated: q.populated ?? "",
      thinking: asAnswerText(q.thinking),
      defense: asAnswerText(q.defense),
      answer: q.answer ?? "No",
    }));

  if (!questionsToQueue.length) {
    // Diagnostic: log what the user selected vs what the answers actually
    // look like. Helps catch future drift between the frontend's
    // appealable predicate and the backend's matching logic.
    const selectedDebug = Array.from(wanted).map((i) => ({
      idx: i,
      header: all[i]?.header ?? "<out-of-range>",
      answer: all[i]?.answer ?? "<missing>",
    }));
    console.warn(`⚠️ [APPEAL] no matching appealable questions fid=${findingId} selected=${JSON.stringify(selectedDebug)}`);
    throw new Error("no matching failed questions to appeal");
  }

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

  // Persist appealedAt + comment onto the finding so the report page knows
  // an appeal exists (button shows "Appeal Filed" disabled, matching prod's
  // lockAppealBtn behavior in main:controller.ts:1449). Always save appealedAt;
  // comment is optional. Best-effort — the judge queue + appeal record are
  // the critical writes.
  try {
    await saveFinding(orgId, {
      ...finding,
      appealedAt,
      ...(input.comment ? { appealComment: input.comment } : {}),
    });
  } catch (err) {
    console.error(`⚠️ [APPEAL] saveFinding appealedAt failed fid=${findingId} (non-fatal):`, err);
  }

  // Mark the audit's index row as having a pending appeal so weekly reports —
  // which read appealStatus straight off the index — exclude it until the judge
  // resolves it. writeAuditDoneIndex recomputes appealStatus from the appeal we
  // just saved; the merge preserves the finalized score/completed/doneAt.
  // Best-effort: the judge queue + appeal record are the critical writes.
  try {
    await writeSoleAuditDoneIndex(orgId, finding as Record<string, any>, {
      findingId,
      ...buildIndexMeta(finding as Record<string, any>),
    } as Omit<AuditDoneIndexEntry, "completedAt">);
  } catch (err) {
    console.warn(`⚠️ [APPEAL] ${findingId} audit-done-idx appealStatus stamp failed (best-effort):`, err);
  }

  // Take the audit off the manager's remediation queue while the appeal is
  // open. An audit whose result is being contested isn't ready to coach on —
  // the failure the row was created for may be about to disappear. The row
  // moves to the Completed side flagged "Appealed", and comes back to Pending
  // if the judge decides the failure stands (postJudgedAudit).
  //
  // Fires for ANY appeal, not just one a manager filed: the rule is about the
  // audit's state, not who clicked. Best-effort + dynamic import, mirroring
  // the manager-queue calls on the judge and review paths.
  try {
    const { markQueueItemAppealed } = await import("@manager/domain/data/manager-repository/mod.ts");
    await markQueueItemAppealed(orgId, findingId, {
      appealState: "appealed",
      appealedAt,
      appealedBy: input.auditor,
      ...(input.comment ? { appealNote: input.comment } : {}),
    });
  } catch (err) {
    console.warn(`⚠️ [APPEAL] ${findingId} manager-queue appeal flag failed (best-effort):`, err);
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
