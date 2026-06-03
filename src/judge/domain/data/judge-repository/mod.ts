/** Judge queue repository — appeals, decisions, queue ops. Firestore-backed.
 *  Atomic ops in main are downgraded to read-modify-write — race windows are
 *  acceptable given the per-judge concurrency profile and idempotent finalize. */

import {
  getStored, setStored, deleteStored, listStoredWithKeys,
} from "@core/data/firestore/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";
import type { JudgeDecision, AppealRecord } from "@core/dto/types.ts";
import { getFinding, getTranscript, saveFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { fireWebhook } from "@admin/domain/data/admin-repository/mod.ts";
import { incrFlipToPass, configKeyForFinding, normalizeQuestionKey } from "@audit/domain/data/question-stats-repository/mod.ts";
import { writeFailedFindingRows } from "@audit/domain/data/failed-finding-repository/mod.ts";
import {
  deleteChargebackEntry,
  deleteWireDeductionEntry,
  deleteAuditDoneIndexEntry,
  deleteCompletedStat,
  getChargebackEntries,
  getWireDeductionEntries,
  saveChargebackEntry,
  saveWireDeductionEntry,
  queryAuditDoneIndex,
  markFindingHidden,
  getHiddenFindingIds,
  writeAuditDoneIndex,
  updateCompletedStatScore,
} from "@audit/domain/data/stats-repository/mod.ts";

const ACTIVE_TTL = 30 * 60 * 1000;
const BUFFER_SIZE = 5;
const SKIP_APPEAL_TYPES = new Set(["different-recording", "additional-recording", "upload-recording"]);

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

export interface JudgeBufferItem extends JudgeItem {
  auditRemaining: number;
  transcript: { raw: string; diarized: string; utteranceTimes?: number[] } | null;
  appealComment?: string;
  reviewedBy?: string;
  recordId?: string;
  recordMeta?: {
    guestName?: string;
    spouseName?: string;
    maritalStatus?: string;
    roomTypeMaxOccupancy?: string;
    destination?: string;
    arrivalDate?: string;
    departureDate?: string;
    totalWGS?: string;
    totalMCC?: string;
    officeName?: string;
    totalAmountPaid?: string;
    hasMCC?: string;
    mspSubscription?: string;
  };
}

// ── Queue Population ─────────────────────────────────────────────────────────

export async function populateJudgeQueue(
  orgId: OrgId, findingId: string, questions: any[], appealType?: string,
  recordingIdField?: string, recordingId?: string,
): Promise<void> {
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
    await setStored("judge-pending", orgId, [findingId, idx], item);
    count++;
  }
  await setStored("judge-audit-pending", orgId, [findingId], count);
  console.log(`✅ [JUDGE] ${findingId}: Queued ${count} items for judge review`);
}

// ── Decision Recording ───────────────────────────────────────────────────────

export async function recordJudgeDecision(
  orgId: OrgId, findingId: string, questionIndex: number,
  decision: "uphold" | "overturn", judge: string, reason?: string,
): Promise<{ remaining: number }> {
  // Load full item from active (or pending) so decided record preserves context
  const activeVal = await getStored<JudgeItem & { claimedAt?: number }>("judge-active", orgId, judge, findingId, questionIndex);
  let baseItem: JudgeItem | null = null;
  if (activeVal) {
    const { claimedAt: _, ...rest } = activeVal;
    baseItem = rest as JudgeItem;
  } else {
    baseItem = await getStored<JudgeItem>("judge-pending", orgId, findingId, questionIndex);
  }
  if (!baseItem) {
    baseItem = { findingId, questionIndex, header: "", populated: "", thinking: "", defense: "", answer: "No" };
  }

  const decidedRecord: JudgeDecision = {
    ...baseItem,
    decision,
    judge,
    ...(reason ? { reason: reason as JudgeDecision["reason"] } : {}),
    decidedAt: Date.now(),
  };
  await setStored("judge-decided", orgId, [findingId, questionIndex], decidedRecord);
  await deleteStored("judge-active", orgId, judge, findingId, questionIndex);

  const counter = (await getStored<number>("judge-audit-pending", orgId, findingId)) ?? 1;
  const newCount = Math.max(0, counter - 1);
  await setStored("judge-audit-pending", orgId, [findingId], newCount);

  if (newCount === 0) {
    postJudgedAudit(orgId, findingId, judge).catch((err) =>
      console.error(`[JUDGE] ${findingId}: postJudgedAudit failed:`, err));
  }

  // Judge gamification — fire-and-forget. Same pattern as reviewer/manager
  // (runInBackgroundLane wrapper inside the lane). XP fires per decision
  // (flat 20 base, no per-question multiplier), with overturned/uphold
  // tracked in the role-specific stats for the existing 9 judge badges.
  void import("@gamification/domain/business/gamification-lane/mod.ts")
    .then(({ awardForCompletion }) =>
      awardForCompletion({ orgId, email: judge, role: "judge", overturned: decision === "overturn" })
    )
    .catch((err) => console.error(`[JUDGE] ${findingId}: gamification lane import failed:`, err));

  return { remaining: newCount };
}

// ── Sweep expired claims ────────────────────────────────────────────────────

async function sweepExpiredActiveClaims(orgId: OrgId, excludeJudge?: string): Promise<number> {
  const now = Date.now();
  let reclaimed = 0;
  const rows = await listStoredWithKeys<JudgeItem & { claimedAt: number }>("judge-active", orgId);
  for (const { key, value } of rows) {
    if (excludeJudge && key[0] === excludeJudge) continue;
    if (value.claimedAt && (now - value.claimedAt) > ACTIVE_TTL) {
      const { claimedAt: _, ...baseItem } = value;
      await setStored("judge-pending", orgId, [value.findingId, value.questionIndex], baseItem as JudgeItem);
      await deleteStored("judge-active", orgId, ...key);
      reclaimed++;
      console.log(`[JUDGE] Reclaimed expired active item ${value.findingId}/${value.questionIndex}`);
    }
  }
  return reclaimed;
}

// ── Post-completion: aggregate decisions, save corrected score, fire webhook
// Exported so the audit-done-idx sync contract can be locked by a test. In
// production this is fired as `.catch(...)` from recordJudgeDecision, so
// callers can't await it directly — exporting lets tests bypass the queue
// state machine and assert on the index/finding writes deterministically.

export async function postJudgedAudit(orgId: OrgId, findingId: string, judge: string): Promise<void> {
  try {
    const finding = await getFinding(orgId, findingId);
    if (!finding) {
      console.log(`[JUDGE] ${findingId}: no finding — skip post-judge`);
      return;
    }

    // Pull all decisions for this finding
    const allDecisions = await listStoredWithKeys<JudgeDecision>("judge-decided", orgId);
    const decisions = allDecisions.filter(({ key }) => key[0] === findingId).map(({ value }) => value);
    if (decisions.length === 0) {
      console.log(`[JUDGE] ${findingId}: 0 decisions (system-skip) — no webhook`);
      return;
    }

    const overturns = decisions.filter((d) => d.decision === "overturn").length;
    const totalQuestions = decisions.length;

    const all = (finding.answeredQuestions ?? []) as Array<Record<string, unknown>>;
    // Stamp every decided question with the judge's action/reason/identity so
    // downstream analytics (failure-source attribution) can read it off the
    // finding doc, and flip overturned answers to "Yes".
    const corrected = all.map((q, i) => {
      const d = decisions.find((dd) => dd.questionIndex === i);
      if (!d) return q;
      const stamped: Record<string, unknown> = {
        ...q,
        judgeAction: d.decision,
        judgedBy: judge,
        ...(d.reason ? { judgeReason: d.reason } : {}),
      };
      return d.decision === "overturn" ? { ...stamped, answer: "Yes" } : stamped;
    });
    const total = corrected.length;
    const yesIs = (a: unknown) => String(a ?? "").toLowerCase().startsWith("yes");
    const finalYes = corrected.filter((q) => yesIs(q.answer)).length;
    const finalScore = total > 0 ? Math.round((finalYes / total) * 100) : 0;
    const origYes = all.filter((q) => yesIs(q.answer)).length;
    const originalScore = total > 0 ? Math.round((origYes / total) * 100) : 0;

    // Always persist the stamped/corrected questions (even on all-uphold) so the
    // judgeAction stamps stick for failure-source attribution.
    await saveFinding(orgId, { ...finding, answeredQuestions: corrected });

    // Rebuild the failed-finding index from the judged finding. Every decided
    // question was appealed and judged; upheld ones mark the row appealDenied
    // (powers the "appealed and still failed" view). Overturned questions are
    // now "Yes" and drop out naturally. Best-effort.
    try {
      const appealedKeys = new Set(
        decisions.filter((d) => d.header).map((d) => normalizeQuestionKey(String(d.header))),
      );
      const deniedKeys = new Set(
        decisions.filter((d) => d.decision === "uphold" && d.header).map((d) => normalizeQuestionKey(String(d.header))),
      );
      await writeFailedFindingRows(orgId, { ...finding, answeredQuestions: corrected }, {
        appealedQuestionKeys: appealedKeys, deniedQuestionKeys: deniedKeys,
      });
    } catch (err) {
      console.warn(`⚠️ [JUDGE] ${findingId} failed-finding index rebuild failed (best-effort):`, err);
    }

    if (overturns > 0) {
      // Per-question counter — each overturn is a No→Yes flip. Fire-and-
      // forget so a counter write failure doesn't strand the judge result.
      const cfgKeyJ = configKeyForFinding(finding as Record<string, any>);
      const overturnNow = Date.now();
      for (const d of decisions) {
        if (d.decision !== "overturn") continue;
        const header = String(d.header ?? "");
        if (!header) continue;
        incrFlipToPass(orgId, cfgKeyJ, header, findingId, overturnNow).catch((err) =>
          console.warn(`[JUDGE] ${findingId}: ⚠️ flipToPass counter incr failed for "${header}":`, err),
        );
      }

      // Keep audit-done-idx + completed-audit-stat in sync with the live
      // finding. Without these writes, the index keeps the pre-judge score
      // forever and /admin/unreviewed-audits / audit-history queries surface
      // stale data even after a judge has overturned questions. Same root
      // cause that bit us on adminFlipQuestion. Best-effort; the webhook +
      // user-visible decision succeed regardless.
      const completedAt = ((finding as Record<string, unknown>).completedAt as number | undefined) ?? Date.now();
      const rec = (finding as Record<string, unknown>).record as Record<string, unknown> ?? {};
      const isPackage = (finding as Record<string, unknown>).recordingIdField === "GenieNumber";
      const rawVo = String(rec.VoName ?? "");
      const voName = rawVo.includes(" - ") ? rawVo.split(" - ").slice(1).join(" - ").trim() : rawVo.trim();
      try {
        await writeAuditDoneIndex(orgId, {
          findingId,
          completedAt,
          score: finalScore,
          completed: finalScore === 100,
          ...(finalScore === 100 ? { doneAt: Date.now(), reason: "reviewed" as const } : {}),
          recordId: String(rec.RecordId ?? "") || undefined,
          isPackage,
          voName: voName || undefined,
          owner: (finding as Record<string, unknown>).owner as string | undefined,
          department: String(isPackage ? (rec.OfficeName ?? "") : (rec.ActivatingOffice ?? "")) || undefined,
          shift: isPackage ? undefined : String(rec.Shift ?? "") || undefined,
        });
      } catch (err) {
        console.warn(`⚠️ [JUDGE] ${findingId} writeAuditDoneIndex failed (best-effort):`, err);
      }
      try {
        await updateCompletedStatScore(orgId, findingId, finalScore);
      } catch (err) {
        console.warn(`⚠️ [JUDGE] ${findingId} updateCompletedStatScore failed (best-effort):`, err);
      }
    }

    fireWebhook(orgId, "judge", {
      findingId,
      finding,
      judgedBy: judge,
      auditor: String(finding.owner ?? ""),
      originalScore,
      finalScore,
      overturns,
      totalQuestions,
      decisions: decisions.map((d) => ({
        questionIndex: d.questionIndex,
        decision: d.decision,
        reason: d.reason,
        header: d.header,
      })),
    }).catch((err) => console.error(`[JUDGE] ${findingId} fireWebhook failed:`, err));

    console.log(`[JUDGE] ${findingId}: completed by ${judge}, ${overturns}/${totalQuestions} overturned, ${originalScore}% → ${finalScore}%`);
  } catch (err) {
    console.error(`[JUDGE] ${findingId} postJudgedAudit failed:`, err);
  }
}

// ── Claim Next Item ─────────────────────────────────────────────────────────

export async function claimNextItem(
  orgId: OrgId,
  judge: string,
): Promise<{ buffer: JudgeBufferItem[]; remaining: number }> {
  const now = Date.now();
  const hidden = await getHiddenFindingIds(orgId);

  async function claimFromPending(count: number): Promise<JudgeItem[]> {
    const claimed: JudgeItem[] = [];
    const rows = await listStoredWithKeys<JudgeItem>("judge-pending", orgId);
    for (const { key, value } of rows) {
      if (hidden.has(value.findingId)) continue;
      if (value.appealType && SKIP_APPEAL_TYPES.has(value.appealType)) {
        const skipFid = value.findingId;
        const counterVal = (await getStored<number>("judge-audit-pending", orgId, skipFid)) ?? 1;
        const newCount = counterVal - 1;
        await deleteStored("judge-pending", orgId, ...key);
        if (newCount <= 0) await deleteStored("judge-audit-pending", orgId, skipFid);
        else await setStored("judge-audit-pending", orgId, [skipFid], newCount);
        if (newCount <= 0) {
          postJudgedAudit(orgId, skipFid, "system").catch((err) =>
            console.error(`[JUDGE] ${skipFid}: ❌ SKIP completion failed:`, err));
        }
        continue;
      }
      // Non-atomic move pending → active. Race window: a parallel claim could
      // pick the same item; second writer just clobbers the first. Acceptable
      // for our judge concurrency (1-2 active at a time).
      await setStored("judge-active", orgId, [judge, value.findingId, value.questionIndex], { ...value, claimedAt: now });
      await deleteStored("judge-pending", orgId, ...key);
      claimed.push(value);
      if (claimed.length >= count) break;
    }
    return claimed;
  }

  async function enrich(item: JudgeItem): Promise<JudgeBufferItem> {
    const transcript = await getTranscript(orgId, item.findingId);
    const counterVal = (await getStored<number>("judge-audit-pending", orgId, item.findingId)) ?? 0;
    let appealComment: string | undefined;
    let enrichedAppealType = item.appealType;
    const finding = await getFinding(orgId, item.findingId);
    if (finding) {
      const f = finding as Record<string, any>;
      if (f.appealType && !item.appealType) enrichedAppealType = f.appealType;
      if (f.appealComment) appealComment = f.appealComment;
    }
    // Reviewer who scored this audit, in fallback order:
    //   1. review-done.reviewedBy — written by finalizeReviewedAudit AND
    //      by adminFlipFinding / finalizePerfectFinding (post-2026-05-14).
    //   2. The first answeredQuestions[i].reviewedBy — finalize stamps this
    //      on decided questions; the new admin-flip path also stamps it on
    //      flipped questions. Covers cases where review-done was written
    //      without reviewedBy (legacy bulk-flips from before the stamp).
    //   3. "Admin (bulk-flip)" sentinel when any question carries
    //      `reviewAction: "admin-flip"` but no `reviewedBy` is available —
    //      forward-compatible label for already-admin-flipped audits that
    //      pre-date the email stamp. Avoids a backfill while still showing
    //      Josh + Ashley *something* informative on the judge panel.
    let reviewedBy: string | undefined;
    try {
      const done = await getStored<{ reviewedBy?: string }>("review-done", orgId, item.findingId);
      if (done?.reviewedBy) reviewedBy = done.reviewedBy;
    } catch (e) {
      console.warn(`⚠️ [JUDGE] ${item.findingId}: review-done lookup failed (non-fatal):`, e);
    }
    const answeredArr = finding?.answeredQuestions as any[] | undefined;
    if (!reviewedBy && answeredArr) {
      reviewedBy = answeredArr.find((q: any) => q?.reviewedBy)?.reviewedBy as string | undefined;
    }
    if (!reviewedBy && answeredArr && answeredArr.some((q: any) => q?.reviewAction === "admin-flip")) {
      reviewedBy = "Admin (bulk-flip)";
    }
    let recordId: string | undefined;
    let recordMeta: JudgeBufferItem["recordMeta"] | undefined;
    if (finding) {
      const rec = (finding as any).record as Record<string, unknown> ?? {};
      recordId = String(rec.RecordId ?? "") || undefined;
      const isPackage = item.recordingIdField === "GenieNumber";
      recordMeta = isPackage ? {
        guestName: rec.GuestName ? String(rec.GuestName) : undefined,
        maritalStatus: rec["67"] ? String(rec["67"]) : undefined,
        officeName: rec.OfficeName ? String(rec.OfficeName) : undefined,
        totalAmountPaid: rec["145"] ? String(rec["145"]) : undefined,
        hasMCC: rec["345"] ? String(rec["345"]) : undefined,
        mspSubscription: rec["306"] ? String(rec["306"]) : undefined,
      } : {
        guestName: rec.GuestName ? String(rec.GuestName) : (rec["32"] ? String(rec["32"]) : undefined),
        spouseName: rec["33"] ? String(rec["33"]) : undefined,
        maritalStatus: rec["49"] ? String(rec["49"]) : undefined,
        roomTypeMaxOccupancy: rec["297"] ? String(rec["297"]) : undefined,
        destination: rec.DestinationDisplay ? String(rec.DestinationDisplay) : (rec["314"] ? String(rec["314"]) : undefined),
        arrivalDate: rec["8"] ? String(rec["8"]) : undefined,
        departureDate: rec["10"] ? String(rec["10"]) : undefined,
        totalWGS: rec["460"] ? String(rec["460"]) : undefined,
        totalMCC: rec["594"] ? String(rec["594"]) : undefined,
      };
    }
    return {
      ...item,
      ...(enrichedAppealType ? { appealType: enrichedAppealType } : {}),
      auditRemaining: counterVal,
      transcript,
      ...(appealComment ? { appealComment } : {}),
      ...(reviewedBy ? { reviewedBy } : {}),
      ...(recordId ? { recordId } : {}),
      ...(recordMeta ? { recordMeta } : {}),
    };
  }

  await sweepExpiredActiveClaims(orgId, judge);

  const activeRows = await listStoredWithKeys<JudgeItem & { claimedAt: number }>("judge-active", orgId);
  const myActive: JudgeItem[] = activeRows
    .filter(({ key }) => key[0] === judge)
    .map(({ value }) => value)
    .filter((v) => !hidden.has(v.findingId));

  if (myActive.length < BUFFER_SIZE) {
    const more = await claimFromPending(BUFFER_SIZE - myActive.length);
    myActive.push(...more);
  }

  const buffer: JudgeBufferItem[] = [];
  for (const item of myActive) buffer.push(await enrich(item));

  return { buffer, remaining: 0 };
}

// ── Undo Decision ───────────────────────────────────────────────────────────

export async function undoDecision(
  orgId: OrgId,
  judge: string,
): Promise<{ buffer: JudgeBufferItem[]; remaining: number }> {
  // Release this judge's active items back to pending
  const activeRows = await listStoredWithKeys<JudgeItem & { claimedAt: number }>("judge-active", orgId);
  for (const { key, value } of activeRows) {
    if (key[0] !== judge) continue;
    const { claimedAt: _, ...baseItem } = value;
    await setStored("judge-pending", orgId, [value.findingId, value.questionIndex], baseItem as JudgeItem);
    await deleteStored("judge-active", orgId, ...key);
  }

  // Find this judge's most recent decision
  const decidedRows = await listStoredWithKeys<JudgeDecision>("judge-decided", orgId);
  let latest: { key: string[]; value: JudgeDecision } | null = null;
  for (const row of decidedRows) {
    if (row.value.judge !== judge) continue;
    if (!latest || row.value.decidedAt > latest.value.decidedAt) latest = row;
  }
  if (!latest) return { buffer: [], remaining: 0 };

  const decided = latest.value;
  const { findingId, questionIndex } = decided;
  const item: JudgeItem = {
    findingId: decided.findingId,
    questionIndex: decided.questionIndex,
    header: decided.header ?? "",
    populated: decided.populated ?? "",
    thinking: decided.thinking ?? "",
    defense: decided.defense ?? "",
    answer: decided.answer ?? "No",
    ...(decided.appealType ? { appealType: decided.appealType } : {}),
    ...(decided.recordingIdField ? { recordingIdField: decided.recordingIdField } : {}),
    ...(decided.recordingId ? { recordingId: decided.recordingId } : {}),
  };

  const counterVal = (await getStored<number>("judge-audit-pending", orgId, findingId)) ?? 0;
  await deleteStored("judge-decided", orgId, ...latest.key);
  await setStored("judge-active", orgId, [judge, findingId, questionIndex], { ...item, claimedAt: Date.now() });
  await setStored("judge-audit-pending", orgId, [findingId], counterVal + 1);

  return claimNextItem(orgId, judge);
}

// ── Appeal CRUD ──────────────────────────────────────────────────────────────

export async function getAppeal(orgId: OrgId, findingId: string): Promise<AppealRecord | null> {
  return await getStored<AppealRecord>("appeal", orgId, findingId);
}

export async function saveAppeal(orgId: OrgId, record: AppealRecord): Promise<void> {
  await setStored("appeal", orgId, [record.findingId], record);
}

export async function deleteAppeal(orgId: OrgId, fid: string): Promise<void> {
  await deleteStored("appeal", orgId, fid);
}

// ── Stats ────────────────────────────────────────────────────────────────────

export async function getJudgeStats(orgId: OrgId): Promise<{ pending: number; decided: number }> {
  const pending = await listStoredWithKeys("judge-pending", orgId);
  const decided = await listStoredWithKeys("judge-decided", orgId);
  return { pending: pending.length, decided: decided.length };
}

// ── Dismiss / Clear ──────────────────────────────────────────────────────────

export async function dismissFindingFromJudgeQueue(orgId: OrgId, fid: string): Promise<{ dismissed: number }> {
  let dismissed = 0;
  const pendingRows = await listStoredWithKeys("judge-pending", orgId);
  for (const { key } of pendingRows) {
    if (key[0] === fid) { await deleteStored("judge-pending", orgId, ...key); dismissed++; }
  }
  const activeRows = await listStoredWithKeys<{ findingId?: string }>("judge-active", orgId);
  for (const { key, value } of activeRows) {
    if (value?.findingId === fid) { await deleteStored("judge-active", orgId, ...key); dismissed++; }
  }
  return { dismissed };
}

export async function clearJudgeQueue(orgId: OrgId): Promise<{ cleared: number }> {
  let cleared = 0;
  for (const { key } of await listStoredWithKeys("judge-pending", orgId)) { await deleteStored("judge-pending", orgId, ...key); cleared++; }
  for (const { key } of await listStoredWithKeys("judge-active", orgId)) { await deleteStored("judge-active", orgId, ...key); cleared++; }
  return { cleared };
}

// ── Admin delete finding — full cross-table cleanup ─────────────────────────

async function collectKeysForFinding(orgId: OrgId, findingId: string): Promise<Array<{ type: string; key: string[] }>> {
  const out: Array<{ type: string; key: string[] }> = [];

  // Per-finding queues + counters across review + judge + manager + appeals
  const types = ["review-pending", "review-decided", "review-active", "judge-pending", "judge-decided", "judge-active"];
  for (const t of types) {
    const rows = await listStoredWithKeys<{ findingId?: string }>(t, orgId);
    for (const { key, value } of rows) {
      const matches = key[0] === findingId || value?.findingId === findingId;
      if (matches) out.push({ type: t, key });
    }
  }

  // Singleton-per-finding entries
  for (const t of ["review-audit-pending", "review-done", "judge-audit-pending", "manager-queue", "appeal", "appeal-history"]) {
    const v = await getStored(t, orgId, findingId);
    if (v !== null) out.push({ type: t, key: [findingId] });
  }

  // Review-undo-idx entries that reference this finding
  const undoRows = await listStoredWithKeys<{ findingId: string }>("review-undo-idx", orgId);
  for (const { key, value } of undoRows) {
    if (value?.findingId === findingId) out.push({ type: "review-undo-idx", key });
  }

  // Active tracking
  const at = await getStored("active-tracking", orgId, findingId);
  if (at !== null) out.push({ type: "active-tracking", key: [findingId] });

  return out;
}

export async function adminDeleteFinding(orgId: OrgId, findingId: string): Promise<void> {
  // Find completedAt for audit-done-idx cleanup (best effort)
  let completedAt = Date.now();
  const idx = await listStoredWithKeys<{ findingId: string; completedAt: number }>("audit-done-idx", orgId);
  for (const { value } of idx) {
    if (value?.findingId === findingId) { completedAt = value.completedAt; break; }
  }

  const keys = await collectKeysForFinding(orgId, findingId);

  // Also delete the finding chunks themselves via the chunked helper
  const { deleteStoredChunked } = await import("@core/data/firestore/mod.ts");
  await deleteStoredChunked("audit-finding", orgId, findingId);

  for (const { type, key } of keys) await deleteStored(type, orgId, ...key);

  await deleteChargebackEntry(orgId, findingId).catch(() => {});
  await deleteWireDeductionEntry(orgId, findingId).catch(() => {});
  await deleteAuditDoneIndexEntry(orgId, findingId, completedAt).catch(() => {});
  await deleteCompletedStat(orgId, findingId).catch(() => {});

  console.log(`[ADMIN-DELETE] 🗑️ ${findingId}: cleaned ${keys.length} entries + finding chunks + cb/wire/done-idx/stat`);
}

/** Like adminDeleteFinding minus the finding-chunk delete — keeps the
 *  finding alive for the report page after a recording-swap appeal. */
export async function cleanupFindingFromIndices(orgId: OrgId, findingId: string): Promise<void> {
  let completedAt = Date.now();
  const idx = await listStoredWithKeys<{ findingId: string; completedAt: number }>("audit-done-idx", orgId);
  for (const { value } of idx) {
    if (value?.findingId === findingId) { completedAt = value.completedAt; break; }
  }

  const keys = await collectKeysForFinding(orgId, findingId);
  for (const { type, key } of keys) await deleteStored(type, orgId, ...key);

  await deleteChargebackEntry(orgId, findingId).catch(() => {});
  await deleteWireDeductionEntry(orgId, findingId).catch(() => {});
  await deleteCompletedStat(orgId, findingId).catch(() => {});
  await deleteAuditDoneIndexEntry(orgId, findingId, completedAt).catch(() => {});
  console.log(`[CLEANUP] 🗑️ ${findingId}: indices cleared (${keys.length} entries + cb/wire/stat/done-idx)`);
}

// ── Legacy aliases ──────────────────────────────────────────────────────────

export const claimNextItemLegacy = claimNextItem;
export const undoDecisionLegacy = undoDecision;
export const adminDeleteFindingLegacy = adminDeleteFinding;

// ── Backfill chargeback/wire entries from current finding state ─────────────

function _isYes(a: string | undefined): boolean {
  const s = String(a ?? "").trim().toLowerCase();
  return s.startsWith("yes") || s === "true" || s === "y" || s === "1";
}

export async function backfillChargebackEntries(
  orgId: OrgId,
  since: number,
  until: number,
): Promise<{ scanned: number; cbUpdated: number; cbDeleted: number; wireUpdated: number }> {
  let scanned = 0, cbUpdated = 0, cbDeleted = 0, wireUpdated = 0;

  const wireEntries = await getWireDeductionEntries(orgId, since, until);
  const cbEntries = await getChargebackEntries(orgId, since, until);

  for (const wireEntry of wireEntries) {
    scanned++;
    const finding = await getFinding(orgId, wireEntry.findingId);
    if (!finding) continue;
    const answers = finding.answeredQuestions ?? [];
    if (answers.length === 0) continue;
    const finalYes = answers.filter((a: any) => _isYes(a.answer)).length;
    const finalScore = answers.length > 0 ? Math.round((finalYes / answers.length) * 100) : 0;
    await saveWireDeductionEntry(orgId, {
      ...wireEntry,
      score: finalScore,
      totalSuccess: finalYes,
      questionsAudited: answers.length,
    });
    wireUpdated++;
  }

  for (const cbEntry of cbEntries) {
    scanned++;
    const finding = await getFinding(orgId, cbEntry.findingId);
    if (!finding) continue;
    const answers = finding.answeredQuestions ?? [];
    if (answers.length === 0) continue;
    const finalYes = answers.filter((a: any) => _isYes(a.answer)).length;
    const finalScore = answers.length > 0 ? Math.round((finalYes / answers.length) * 100) : 0;
    const failedQHeaders = answers
      .filter((a: any) => !_isYes(a.answer))
      .map((a: any) => a.header)
      .filter(Boolean);
    if (failedQHeaders.length === 0) {
      await deleteChargebackEntry(orgId, cbEntry.findingId);
      cbDeleted++;
    } else {
      await saveChargebackEntry(orgId, { ...cbEntry, score: finalScore, failedQHeaders });
      cbUpdated++;
    }
  }

  return { scanned, cbUpdated, cbDeleted, wireUpdated };
}

// ── Find duplicate findings by RecordId ──────────────────────────────────────

export interface DedupCandidate {
  id: string;
  recordKey: string;
  ts: number;
  reviewed: boolean;
  keep: boolean;
}

export interface DedupPlan {
  scanned: number;
  groups: number;
  orphaned: number;
  toDelete: DedupCandidate[];
}

export async function findDuplicates(
  orgId: OrgId,
  since: number,
  until: number,
): Promise<DedupPlan> {
  // queryAuditDoneIndex already filters hidden findings; the explicit check
  // below is defensive (cheap, makes findDuplicates correct standalone) and
  // ensures re-runs are idempotent — already-flagged findings aren't re-
  // flagged.
  const hidden = await getHiddenFindingIds(orgId);
  const indexEntries = await queryAuditDoneIndex(orgId, since, until);

  type Entry = { id: string; recordKey: string; ts: number; reviewed: boolean };
  const inRange: Entry[] = [];
  const needFinding: typeof indexEntries = [];

  for (const e of indexEntries) {
    if (hidden.has(e.findingId)) continue;
    if (e.recordId) {
      inRange.push({
        id: e.findingId,
        recordKey: e.recordId,
        ts: e.completedAt,
        reviewed: e.reason === "reviewed",
      });
    } else {
      needFinding.push(e);
    }
  }

  // Fallback for legacy index entries without recordId — fetch the finding
  const orphaned: typeof needFinding = [];
  for (const e of needFinding) {
    const finding = await getFinding(orgId, e.findingId);
    const recordKey = String((finding as any)?.record?.RecordId ?? (finding as any)?.recordingId ?? "");
    if (!recordKey) { orphaned.push(e); continue; }
    inRange.push({
      id: e.findingId,
      recordKey,
      ts: e.completedAt,
      reviewed: e.reason === "reviewed",
    });
  }

  const groups = new Map<string, Entry[]>();
  for (const e of inRange) {
    const g = groups.get(e.recordKey) ?? [];
    g.push(e);
    groups.set(e.recordKey, g);
  }

  const toDelete: DedupCandidate[] = [];
  let dupGroups = 0;
  for (const [, group] of groups) {
    if (group.length <= 1) continue;
    dupGroups++;
    group.sort((a, b) => {
      if (a.reviewed !== b.reviewed) return a.reviewed ? -1 : 1;
      return b.ts - a.ts;
    });
    toDelete.push({ ...group[0], keep: true });
    for (const dup of group.slice(1)) toDelete.push({ ...dup, keep: false });
  }

  for (const e of orphaned) {
    toDelete.push({ id: e.findingId, recordKey: e.findingId, ts: e.completedAt, reviewed: false, keep: false });
  }

  console.log(`[DEDUP] plan org=${orgId} scanned=${inRange.length} dupGroups=${dupGroups} toDelete=${toDelete.filter((d) => !d.keep).length} orphaned=${orphaned.length}`);
  return { scanned: inRange.length, groups: dupGroups, orphaned: orphaned.length, toDelete };
}

/** Soft-flag every loser as hidden via the audit-hidden marker.
 *
 *  Why "flag" instead of "delete": dedup has hit Firestore's 60s wall three
 *  separate ways (audit-finding scan, audit-done-idx cursor, even single-doc
 *  header reads under sustained load). The :commit batched-delete approach
 *  is fundamentally unfit for this data scale on Deno Deploy's flaky HTTP/2
 *  connection pool. One tiny write per loser, serialized 100ms apart, is
 *  utterly reliable — worst case 200 findings × 100ms = 20s wall-clock
 *  with no scans and no batched deletes. Reversible via unmarkFindingHidden.
 *
 *  Idempotent: markFindingHidden just overwrites the same doc with a
 *  newer hiddenAt, so re-runs of a stale plan are harmless. Per-finding
 *  failures don't abort the loop — operator can re-run dedup. */
export async function deleteDuplicates(
  orgId: OrgId,
  plan: DedupPlan,
  onProgress?: (deleted: number, total: number, findingId: string) => void,
): Promise<{ deleted: number }> {
  const losers = plan.toDelete.filter((d) => !d.keep);
  let deleted = 0;
  for (const dup of losers) {
    try {
      await markFindingHidden(orgId, dup.id, "dedup");
      deleted++;
      onProgress?.(deleted, losers.length, dup.id);
    } catch (err) {
      console.warn(`[DEDUP] ⚠️ flag failed for ${dup.id}: ${(err as Error).message}`);
    }
    // 100ms gap between writes — slow but utterly reliable, no chance of
    // hammering Firestore. 200 findings × 100ms = 20s wall-clock.
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log(`[DEDUP] ✅ flagged ${deleted}/${losers.length} duplicates as hidden org=${orgId}`);
  return { deleted };
}

export const backfillChargebackEntriesLegacy = backfillChargebackEntries;
export const findDuplicatesLegacy = findDuplicates;
export const deleteDuplicatesLegacy = deleteDuplicates;
