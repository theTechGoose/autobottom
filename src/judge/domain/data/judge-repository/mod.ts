/** Judge queue repository — appeals, decisions, queue ops. Firestore-backed.
 *  Atomic ops in main are downgraded to read-modify-write — race windows are
 *  acceptable given the per-judge concurrency profile and idempotent finalize. */

import {
  getStored, setStored, deleteStored, listStoredWithKeys, listStoredWithKeysAll, withTiming,
} from "@core/data/firestore/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";
import type { JudgeDecision, AppealRecord } from "@core/dto/types.ts";
import { summarizeAppealOutcome } from "@judge/domain/business/appeal-tracking/mod.ts";
import { buildRecordMeta } from "@core/business/record-meta/mod.ts";
import { getFinding, getTranscript, saveFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { fireWebhook } from "@admin/domain/data/admin-repository/mod.ts";
import { incrFlipToPass, configKeyForFinding, normalizeQuestionKey } from "@audit/domain/data/question-stats-repository/mod.ts";
import { writeFailedFindingRows } from "@audit/domain/data/failed-finding-repository/mod.ts";
import {
  deleteChargebackEntry,
  deleteWireDeductionEntry,
  deleteAuditDoneIndexEntry,
  deleteDoneIdxRowsForFinding,
  deleteCompletedStat,
  getChargebackEntries,
  getWireDeductionEntries,
  saveChargebackEntry,
  saveWireDeductionEntry,
  queryAuditDoneIndex,
  markFindingHidden,
  getHiddenFindingIds,
  writeSoleAuditDoneIndex,
  updateCompletedStatScore,
  deriveQbRecordId,
  buildIndexMeta,
  pickCanonicalIndexRow,
  scanAndGroupByFinding,
} from "@audit/domain/data/stats-repository/mod.ts";

const ACTIVE_TTL = 30 * 60 * 1000;
const BUFFER_SIZE = 5;
const SKIP_APPEAL_TYPES = new Set(["different-recording", "additional-recording", "upload-recording"]);

/** An auto-skip appeal type — the queue drains these without judge review. The
 *  single source of truth for the skip-set membership check, shared by
 *  isServablePending and claimFromPending so they can't drift. */
function isSkipType(item: { appealType?: string }): boolean {
  return !!item.appealType && SKIP_APPEAL_TYPES.has(item.appealType);
}

/** A pending row is servable to a judge only if its finding isn't hidden and its
 *  appealType isn't an auto-skip type. getJudgeStats (the dashboard count) and
 *  claimFromPending (the queue) MUST share this gate so "Appeals Pending" always
 *  equals what the queue actually serves — otherwise the dashboard over-counts
 *  rows the queue silently skips and the two views disagree. */
function isServablePending(
  item: { findingId: string; appealType?: string },
  hidden: Set<string>,
): boolean {
  if (hidden.has(item.findingId)) return false;
  if (isSkipType(item)) return false;
  return true;
}

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
  screenshotKeys?: string[],
): Promise<{ remaining: number }> {
  // The audit-pending counter must be decremented exactly ONCE per question —
  // on its FIRST decision. A repeat submission of the same question (the judge
  // hotkeys fire htmx.ajax with no in-flight lock, so a second keypress during
  // the ~1.2s round-trip resends the same findingId/questionIndex) must NOT
  // decrement again: the counter then hits 0 while questions are still
  // undecided, postJudgedAudit fires early, and — because newCount can't go
  // below 0 — it fires AGAIN on every remaining decision, mailing the auditor
  // one "appeal complete" email per question with partial scores (prod:
  // cEs2p0IYZXJbHugyqZgt5 sent 5 emails, 56%→84%…96%→100%). Mirrors the same
  // guard on the review side (review-queue/mod.ts recordDecision).
  // Captured BEFORE the judge-decided overwrite below.
  const priorDecision = await getStored<JudgeDecision>("judge-decided", orgId, findingId, questionIndex);
  const isRedecision = priorDecision != null;

  // Load full item from active (or pending) so decided record preserves context
  const activeVal = await getStored<JudgeItem & { claimedAt?: number }>("judge-active", orgId, judge, findingId, questionIndex);
  let baseItem: JudgeItem | null = null;
  if (activeVal) {
    const { claimedAt: _, ...rest } = activeVal;
    baseItem = rest as JudgeItem;
  } else {
    baseItem = await getStored<JudgeItem>("judge-pending", orgId, findingId, questionIndex);
  }
  if (!baseItem && priorDecision) {
    // Re-decision: active/pending are both gone (claim moved it, the first
    // decision drained it). Carry the prior record's context forward rather
    // than blanking it — postJudgedAudit keys its appealed/denied sets off
    // `header`, and reviewer-quality buckets overturns by header, so a blank
    // stub silently drops the question from both.
    const { decision: _d, judge: _j, reason: _r, decidedAt: _t, screenshotKeys: _s, ...rest } = priorDecision;
    baseItem = rest as JudgeItem;
  }
  if (!baseItem) {
    baseItem = { findingId, questionIndex, header: "", populated: "", thinking: "", defense: "", answer: "No" };
  }

  const decidedRecord: JudgeDecision = {
    ...baseItem,
    decision,
    judge,
    ...(reason ? { reason: reason as JudgeDecision["reason"] } : {}),
    ...(screenshotKeys?.length ? { screenshotKeys } : {}),
    decidedAt: Date.now(),
  };
  await setStored("judge-decided", orgId, [findingId, questionIndex], decidedRecord);
  await deleteStored("judge-active", orgId, judge, findingId, questionIndex);

  const counter = (await getStored<number>("judge-audit-pending", orgId, findingId)) ?? 1;
  const newCount = isRedecision ? counter : Math.max(0, counter - 1);
  await setStored("judge-audit-pending", orgId, [findingId], newCount);

  // Fire on the TRANSITION to zero only. `counter > 0` is what stops a stray
  // decision recorded after the audit already completed from re-running the
  // post-judge write + re-sending the appeal-result email.
  if (counter > 0 && newCount === 0) {
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
    const correctedFinding = { ...finding, answeredQuestions: corrected };
    await saveFinding(orgId, correctedFinding);

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
      await writeFailedFindingRows(orgId, correctedFinding, {
        appealedQuestionKeys: appealedKeys, deniedQuestionKeys: deniedKeys,
      });
    } catch (err) {
      console.warn(`⚠️ [JUDGE] ${findingId} failed-finding index rebuild failed (best-effort):`, err);
    }

    // Resolve the appeal record. It is written status:"pending" at file time and
    // nothing ever moved it off that, so every judged appeal stayed "pending"
    // forever: audit history (admin + manager + operations portal + super-
    // manager all render off the same audit-done-idx appealStatus) showed
    // "Appeal Pending" on a decided appeal, and record-dedup skipped those
    // records permanently. MUST run before the index writes below — they
    // recompute appealStatus from this record (stats-repository writeAuditDoneIndex).
    let appealResolved = false;
    try {
      const appeal = await getAppeal(orgId, findingId);
      if (appeal && appeal.status !== "complete") {
        // Stamp WHICH WAY it went alongside the status. Audit history reads the
        // appeal record but never the finding, so without this the only thing
        // any screen could say was "Appeal Complete".
        const summary = summarizeAppealOutcome(decisions, { before: originalScore, after: finalScore });
        await saveAppeal(orgId, {
          ...appeal,
          status: "complete",
          judgedBy: judge,
          ...summary,
          decidedAt: Date.now(),
        });
        appealResolved = true;
        console.log(`[JUDGE] ${findingId}: appeal marked complete (judge=${judge}, outcome=${summary.outcome} ${summary.overturnedCount}↑/${summary.upheldCount}↓)`);
      }
    } catch (err) {
      console.warn(`⚠️ [JUDGE] ${findingId} appeal resolve failed (best-effort):`, err);
    }

    // The appeal is decided, so the manager's remediation row stops waiting on
    // it. Two outcomes, and the score is what separates them:
    //   - still failing → the coaching ask is real after all, so the row comes
    //     off the Completed side and back onto Pending (clearQueueItemAppeal
    //     stamps appealDeniedAt so it doesn't look like a brand-new failure).
    //   - back at 100%  → the appeal was won. The flag STAYS and the row stays
    //     on the Completed side as the record of that: removeFromManagerQueue
    //     below only clears rows still open, so it skips this one exactly as it
    //     skips a remediated row.
    // A partly-granted appeal that leaves ANY failure standing counts as still
    // failing — someone still has to have the conversation.
    if (finalScore < 100) {
      try {
        const { clearQueueItemAppeal } = await import(
          "@manager/domain/data/manager-repository/mod.ts"
        );
        await clearQueueItemAppeal(orgId, findingId);
      } catch (err) {
        console.warn(`⚠️ [JUDGE] ${findingId} manager-queue appeal clear failed (best-effort):`, err);
      }
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
      try {
        // writeSoleAuditDoneIndex keys at reviewedAt when the finding was
        // reviewed before being judged (preserving reviewer attribution via
        // its merge), else at completedAt — one row per finding either way.
        // `completed` is OMITTED below 100 so the merge inherits it. An appeal
        // only exists after the audit was finalized, so deriving it from the
        // score (`finalScore === 100`) downgraded every partly-granted appeal
        // to completed:false — the audit then vanished from every weekly report
        // while still showing REVIEWED / APPEAL COMPLETE in audit history.
        await writeSoleAuditDoneIndex(orgId, finding as Record<string, any>, {
          findingId,
          score: finalScore,
          ...(finalScore === 100
            ? { completed: true, doneAt: Date.now(), reason: "reviewed" as const }
            : {}),
          ...buildIndexMeta(finding as Record<string, any>),
        });
      } catch (err) {
        console.warn(`⚠️ [JUDGE] ${findingId} writeAuditDoneIndex failed (best-effort):`, err);
      }
      try {
        await updateCompletedStatScore(orgId, findingId, finalScore);
      } catch (err) {
        console.warn(`⚠️ [JUDGE] ${findingId} updateCompletedStatScore failed (best-effort):`, err);
      }

      // An audit back at 100% has nothing left to remediate, so take it out of
      // the manager queue here — review-finalize put it there when the failure
      // was still real, and the queue is a snapshot that never recomputes. The
      // manager routes also drain resolved rows at read time (that covers the
      // backlog and the flip paths), but doing it on the score change means the
      // row is gone before anyone's dashboard polls. Best-effort + dynamic
      // import, mirroring review-finalize's enqueue.
      if (finalScore === 100) {
        try {
          const { removeFromManagerQueue } = await import(
            "@manager/domain/data/manager-repository/mod.ts"
          );
          const removed = await removeFromManagerQueue(orgId, findingId);
          if (removed) console.log(`[JUDGE] ${findingId}: 📋 removed from manager remediation queue (100%)`);
        } catch (err) {
          console.warn(`⚠️ [JUDGE] ${findingId} manager-queue removal failed (best-effort):`, err);
        }
      }

      // Resync the chargeback (date-leg) / wire (package) "payroll" entry to the
      // judged answers. The review path does this on finalize
      // (review-queue/mod.ts syncChargebackWireToScore) but the judge path never
      // did, so an audit a judge took back to 100% kept the deduction row written
      // when it failed review — a real pay hit for an auditor who WON their
      // appeal. Same reconcile the Backfill Chargeback Entries tool runs, fed the
      // corrected answers directly. Best-effort: a failure leaves a stale row
      // that the backfill repairs.
      try {
        const r = await reconcileChargebackForFinding(orgId, findingId, correctedFinding);
        if (r.cbDeleted || r.wireDeleted) {
          console.log(`[JUDGE] ${findingId}: 💰 cleared ${r.cbDeleted ? "chargeback" : "wire"} entry at score=${finalScore}%`);
        } else if (r.cbUpdated || r.wireUpdated) {
          console.log(`[JUDGE] ${findingId}: 💰 rewrote ${r.cbUpdated ? "chargeback" : "wire"} entry at score=${finalScore}%`);
        }
      } catch (err) {
        console.warn(`⚠️ [JUDGE] ${findingId} chargeback resync failed (best-effort, backfill repairs):`, err);
      }
    } else if (appealResolved) {
      // All-uphold: the score didn't move, so none of the score-carrying writes
      // above apply — but the appeal still just closed, and the badge reads off
      // the index row. Same appealStatus-only stamp fileJudgeAppeal uses when it
      // opens the appeal; writeSoleAuditDoneIndex's merge preserves the existing
      // score / completed / doneAt.
      try {
        await writeSoleAuditDoneIndex(orgId, correctedFinding as Record<string, any>, {
          findingId, ...buildIndexMeta(correctedFinding as Record<string, any>),
        } as Parameters<typeof writeSoleAuditDoneIndex>[2]);
      } catch (err) {
        console.warn(`⚠️ [JUDGE] ${findingId} appealStatus index stamp failed (best-effort):`, err);
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
        screenshotKeys: d.screenshotKeys,
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
      if (!isServablePending(value, hidden)) {
        // Not servable. Hidden → leave the row in place (it may be un-hidden
        // later via restore). Skip-type → drain the row, decrement the audit
        // counter, and auto-complete when this was the last question.
        if (isSkipType(value)) {
          const skipFid = value.findingId;
          const counterVal = (await getStored<number>("judge-audit-pending", orgId, skipFid)) ?? 1;
          const newCount = counterVal - 1;
          await deleteStored("judge-pending", orgId, ...key);
          if (newCount <= 0) await deleteStored("judge-audit-pending", orgId, skipFid);
          else await setStored("judge-audit-pending", orgId, [skipFid], newCount);
          // Transition-to-zero only, same as recordJudgeDecision — draining a
          // stray skip row on an already-completed audit must not re-fire the
          // post-judge write and re-send the appeal-result email.
          if (counterVal > 0 && newCount <= 0) {
            postJudgedAudit(orgId, skipFid, "system").catch((err) =>
              console.error(`[JUDGE] ${skipFid}: ❌ SKIP completion failed:`, err));
          }
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
      recordMeta = buildRecordMeta(rec, item.recordingIdField);
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

export function getJudgeStats(orgId: OrgId): Promise<{ pending: number; pendingAudits: number; decided: number }> {
  return withTiming("getJudgeStats", () => _getJudgeStatsRaw(orgId), { category: "db" });
}
async function _getJudgeStatsRaw(orgId: OrgId): Promise<{ pending: number; pendingAudits: number; decided: number }> {
  // Count only what the queue will actually serve — exclude hidden findings and
  // auto-skip appeal types via the same gate claimFromPending uses. A raw row
  // count over-reports because hidden rows linger in judge-pending forever.
  const hidden = await getHiddenFindingIds(orgId);
  // Paged (uncapped) scans — plain listStoredWithKeys caps at 1000 rows, which
  // would silently under-count once judge-pending/decided exceed a page.
  const pendingRows = await listStoredWithKeysAll<JudgeItem>("judge-pending", orgId);
  const servable = pendingRows.filter(({ value }) => isServablePending(value, hidden));
  // `pending` = question-rows still to review; `pendingAudits` = the distinct
  // appeals (findings) those rows belong to — so the dashboard can read
  // "N questions across M audits".
  const pending = servable.length;
  const pendingAudits = new Set(servable.map(({ value }) => value.findingId)).size;
  const decided = await listStoredWithKeysAll("judge-decided", orgId);
  return { pending, pendingAudits, decided: decided.length };
}

/** The findings that are genuinely waiting on a judge right now, newest appeal
 *  first. This is the QUEUE — the same `isServablePending` gate the judge screen
 *  and getJudgeStats use — deliberately NOT `audit-done-idx.appealStatus`.
 *
 *  The index flag is written at appeal-file time and only cleared when the
 *  resolve path runs; rows that missed it read "pending" forever (the bug fixed
 *  and backfilled 2026-08-01). Ten such rows were still stale as of 2026-08-17
 *  while the queue itself held none of them, so a report that counts the flag
 *  reports appeals nobody is waiting on. Counting the queue can't drift: if it
 *  isn't in the queue, no judge will ever see it.
 *
 *  Un-windowed on purpose — an appeal that has been open for a month is exactly
 *  the one a backlog report needs to surface. */
export async function listOpenAppealFindingIds(orgId: OrgId): Promise<string[]> {
  const hidden = await getHiddenFindingIds(orgId);
  const rows = await listStoredWithKeysAll<JudgeItem>("judge-pending", orgId);
  const seen = new Set<string>();
  for (const { value } of rows) {
    if (!value?.findingId) continue;
    if (!isServablePending(value, hidden)) continue;
    seen.add(value.findingId);
  }
  return [...seen];
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

/** Everything a dismissal must undo, in one place.
 *
 *  Dropping the queue rows and the appeal record is only half the job: the
 *  auditor-facing state lives on three OTHER writes that file-appeal made, and
 *  leaving any of them stamped tells every screen the appeal is still open.
 *
 *    - `finding.appealedAt` locks the report's button to a disabled "Appeal
 *      Filed" (AppealModal.tsx:63). A dismissal email says "file it again" —
 *      so the button MUST go back to red "File Appeal" or the auditor can't.
 *    - `audit-done-idx.appealStatus` renders "Appeal Pending" on admin, manager,
 *      operations and super-manager history (all read the same row). Deleting
 *      the appeal record first is what lets writeAuditDoneIndex recompute it
 *      to "none" here.
 *    - `judge-audit-pending` is the per-audit remaining-questions counter; left
 *      behind it sits at its filed count forever with no rows to drain.
 *
 *  Best-effort per step, like the rest of the post-decision writes: a failure
 *  on the badge must not strand the queue teardown that already succeeded. */
export async function dismissAppealForFinding(orgId: OrgId, findingId: string): Promise<{ dismissed: number }> {
  const { dismissed } = await dismissFindingFromJudgeQueue(orgId, findingId);
  await deleteAppeal(orgId, findingId);

  try {
    await deleteStored("judge-audit-pending", orgId, findingId);
  } catch (err) {
    console.warn(`⚠️ [JUDGE-DISMISS] ${findingId} counter clear failed (best-effort):`, err);
  }

  // Unlock the appeal button. appealComment goes with it — it belongs to the
  // appeal we just tore down, and a stale one would surface under the next one.
  let finding: Record<string, any> | null = null;
  try {
    finding = await getFinding(orgId, findingId) as Record<string, any> | null;
    if (finding && (finding.appealedAt !== undefined || finding.appealComment !== undefined)) {
      delete finding.appealedAt;
      delete finding.appealComment;
      await saveFinding(orgId, finding);
    }
  } catch (err) {
    console.warn(`⚠️ [JUDGE-DISMISS] ${findingId} appeal-lock clear failed (best-effort):`, err);
  }

  // Re-stamp the history badge. appealStatus recomputes off the now-deleted
  // appeal record → "none"; the merge keeps score / completed / doneAt.
  try {
    if (finding) {
      await writeSoleAuditDoneIndex(orgId, finding, {
        findingId, ...buildIndexMeta(finding),
      } as Parameters<typeof writeSoleAuditDoneIndex>[2]);
    }
  } catch (err) {
    console.warn(`⚠️ [JUDGE-DISMISS] ${findingId} appealStatus index stamp failed (best-effort):`, err);
  }

  console.log(`[JUDGE-DISMISS] ${findingId}: dismissed ${dismissed} queue row(s), appeal cleared, button unlocked`);
  return { dismissed };
}

export async function clearJudgeQueue(orgId: OrgId): Promise<{ cleared: number }> {
  let cleared = 0;
  for (const { key } of await listStoredWithKeys("judge-pending", orgId)) { await deleteStored("judge-pending", orgId, ...key); cleared++; }
  for (const { key } of await listStoredWithKeys("judge-active", orgId)) { await deleteStored("judge-active", orgId, ...key); cleared++; }
  return { cleared };
}

// ── Admin delete finding — full cross-table cleanup ─────────────────────────

async function collectKeysForFinding(
  orgId: OrgId,
  findingId: string,
  opts: { keepManagerQueue?: boolean } = {},
): Promise<Array<{ type: string; key: string[] }>> {
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

  // Singleton-per-finding entries. The manager-queue row is held back for a
  // re-audit (keepManagerQueue): the row is not garbage there, it is the
  // manager's record that this audit went out for new audio, and the re-audit
  // path re-flags it "re-audited" instead of deleting it. An admin delete
  // still passes no option and clears everything.
  const singletons = ["review-audit-pending", "review-done", "judge-audit-pending", "manager-queue", "appeal", "appeal-history"]
    .filter((t) => !(opts.keepManagerQueue && t === "manager-queue"));
  for (const t of singletons) {
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
export async function cleanupFindingFromIndices(
  orgId: OrgId,
  findingId: string,
  opts: { keepManagerQueue?: boolean } = {},
): Promise<void> {
  const keys = await collectKeysForFinding(orgId, findingId, opts);
  for (const { type, key } of keys) await deleteStored(type, orgId, ...key);

  await deleteChargebackEntry(orgId, findingId).catch(() => {});
  await deleteWireDeductionEntry(orgId, findingId).catch(() => {});
  await deleteCompletedStat(orgId, findingId).catch(() => {});
  // Delete the index row by KEY off the finding's own timestamps. The old code
  // looked the timestamp up with the CAPPED scan (1000 rows) over an index of
  // 80k+, so it almost never found the row, fell back to Date.now() as the key,
  // and deleted nothing — every re-audited audit kept its old row. One call
  // that was re-audited twice therefore read as three separate audits in
  // history, two of them at the pre-re-audit score.
  const finding = await getFinding(orgId, findingId).catch(() => null);
  const rowsGone = await deleteDoneIdxRowsForFinding(orgId, findingId, finding as Record<string, any> | null);
  console.log(`[CLEANUP] 🗑️ ${findingId}: indices cleared (${keys.length} entries + cb/wire/stat, ${rowsGone} done-idx row(s))`);
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

// ── Chunked payroll/chargeback backfill (Deno-Deploy-safe) ───────────────────
// The one-shot backfillChargebackEntries re-reads a getFinding per entry, which
// blows the edge request timeout on a real pay-period window. These two split it
// so the frontend can drive it in batches: list the fids once (cheap index
// reads), then process N at a time, each batch a short request.

/** Fast: the union of findingIds with a chargeback (date-leg) or wire (package)
 *  entry whose audit completed in [since, until]. Index reads only — no
 *  getFinding — so enumerating the work is one quick request. */
export async function listChargebackBackfillFids(
  orgId: OrgId,
  since: number,
  until: number,
): Promise<string[]> {
  const [cb, wire] = await Promise.all([
    getChargebackEntries(orgId, since, until),
    getWireDeductionEntries(orgId, since, until),
  ]);
  const ids = new Set<string>();
  for (const e of cb) ids.add(e.findingId);
  for (const e of wire) ids.add(e.findingId);
  const out = [...ids];
  console.log(`[CB-BACKFILL] 📋 list orgId=${orgId} since=${since} until=${until} → ${out.length} fids (cb=${cb.length} wire=${wire.length})`);
  return out;
}

export interface ChargebackBackfillBatchResult {
  scanned: number;
  cbUpdated: number;
  cbDeleted: number;
  wireUpdated: number;
  wireDeleted: number;
}

/** Outcome of reconciling one finding's payroll entry — exactly one flag set
 *  (or all false when the finding is gone / unanswered and is skipped). */
type CbOne = { cbUpdated: boolean; cbDeleted: boolean; wireUpdated: boolean; wireDeleted: boolean };

/** The slice of a finding the chargeback/wire reconcile actually reads — turns
 *  getFinding's broad return into a typed contract so a rename of
 *  `recordingIdField` / `completedAt` upstream is a compile error, not a silent
 *  undefined. (A type alias, not an interface, so it's assignable to the wider
 *  Record<string, any> buildIndexMeta expects.) */
type CbFinding = {
  answeredQuestions?: Array<{ answer?: unknown; header?: unknown; egregious?: unknown }>;
  recordingIdField?: string;
  record?: Record<string, any>;
  completedAt?: number;
};

/** Reconcile ONE finding's chargeback (date-leg) or wire (package) entry against
 *  its CURRENT answers — same canonical predicates as the live review sync (a
 *  fail is `=== "No"`, success `=== "Yes"`). A now-passing audit's entry is
 *  DELETED (the stale "failed VO" row this tool exists to clear); otherwise it's
 *  rewritten to the recomputed score + remaining fails. Exported for unit tests.
 *
 *  `finding` lets a caller that just wrote the corrected answers pass them in
 *  directly — postJudgedAudit does, so a cross-isolate read-after-write lag
 *  can't make the reconcile grade the PRE-judge answers and re-save the very
 *  deduction it's meant to clear. */
export async function reconcileChargebackForFinding(
  orgId: OrgId,
  fid: string,
  finding?: Record<string, unknown>,
): Promise<CbOne> {
  const none: CbOne = { cbUpdated: false, cbDeleted: false, wireUpdated: false, wireDeleted: false };
  const raw = finding ?? await getFinding(orgId, fid);
  if (!raw) return none;
  const f = raw as unknown as CbFinding;
  const answers = f.answeredQuestions ?? [];
  if (answers.length === 0) return none;
  const isPackage = f.recordingIdField === "GenieNumber";
  const yes = answers.filter((a) => String(a.answer ?? "") === "Yes").length;
  const score = Math.round((yes / answers.length) * 100);
  const failedQs = answers
    .map((a) => ({ header: String(a.header ?? ""), egregious: !!a.egregious, answer: String(a.answer ?? "") }))
    .filter((q) => q.answer === "No" && q.header);
  const passing = score >= 100 || failedQs.length === 0;
  const rec = f.record ?? {};
  const ts = typeof f.completedAt === "number" ? f.completedAt : Date.now();
  const meta = buildIndexMeta(f);
  if (isPackage) {
    if (passing) {
      await deleteWireDeductionEntry(orgId, fid).catch(() => {});
      return { ...none, wireDeleted: true };
    }
    await saveWireDeductionEntry(orgId, {
      findingId: fid, ts, score, questionsAudited: answers.length, totalSuccess: yes,
      recordId: String(rec.RecordId ?? ""), office: meta.department ?? "",
      excellenceAuditor: meta.voName ?? "", guestName: String(rec.GuestName ?? ""),
    });
    return { ...none, wireUpdated: true };
  }
  if (passing) {
    await deleteChargebackEntry(orgId, fid).catch(() => {});
    return { ...none, cbDeleted: true };
  }
  await saveChargebackEntry(orgId, {
    findingId: fid, ts, voName: meta.voName ?? "",
    destination: String(rec.DestinationDisplay ?? rec["314"] ?? ""),
    revenue: String(rec["706"] ?? ""), recordId: String(rec.RecordId ?? ""),
    score,
    failedQHeaders: failedQs.map((q) => q.header),
    egregiousHeaders: failedQs.filter((q) => q.egregious).map((q) => q.header),
    omissionHeaders: failedQs.filter((q) => !q.egregious).map((q) => q.header),
  });
  return { ...none, cbUpdated: true };
}

/** Process a batch of findingIds CONCURRENTLY (bounded fan-out) — the sequential
 *  getFinding-per-entry version timed out repeatedly on real windows. Running the
 *  findings ~20-at-a-time turns a ~15s batch into ~1s, so the whole job finishes
 *  in a couple of minutes — well before a Deno Deploy isolate ever recycles. */
export async function processChargebackBackfillBatch(
  orgId: OrgId,
  fids: string[],
): Promise<ChargebackBackfillBatchResult> {
  const CONCURRENCY = 20;
  const totals: ChargebackBackfillBatchResult = { scanned: 0, cbUpdated: 0, cbDeleted: 0, wireUpdated: 0, wireDeleted: 0 };
  for (let i = 0; i < fids.length; i += CONCURRENCY) {
    const slice = fids.slice(i, i + CONCURRENCY);
    // allSettled, not all: a single thrown save must NOT reject the whole slice
    // (which would discard every count in this batch AND abort the remaining
    // slices). A failed finding is bounded to one skipped, logged row.
    const results = await Promise.allSettled(slice.map((fid) => reconcileChargebackForFinding(orgId, fid)));
    for (let j = 0; j < results.length; j++) {
      const res = results[j];
      totals.scanned++;
      if (res.status === "rejected") {
        console.warn(`[CB-BACKFILL] ⚠️ reconcile failed fid=${slice[j]}:`, res.reason);
        continue;
      }
      const r = res.value;
      if (r.cbUpdated) totals.cbUpdated++;
      if (r.cbDeleted) totals.cbDeleted++;
      if (r.wireUpdated) totals.wireUpdated++;
      if (r.wireDeleted) totals.wireDeleted++;
    }
  }
  console.log(`[CB-BACKFILL] ⚙️ batch orgId=${orgId} fids=${fids.length} scanned=${totals.scanned} cbUpdated=${totals.cbUpdated} cbDeleted=${totals.cbDeleted} wireUpdated=${totals.wireUpdated} wireDeleted=${totals.wireDeleted}`);
  return totals;
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

/** Keeper-selection order, shared by the real dedup run (findDuplicates) and
 *  the read-only diagnostic (diagnoseDuplicates) so the two can never drift:
 *  a reviewed finding outranks an unreviewed one; within the same reviewed
 *  status the newest (largest completedAt) wins. After this sort, group[0] is
 *  the keeper and the rest are losers. Mirrors the operator's stated rule:
 *  keep whichever was reviewed/appealed/judged, else the most recent. */
function sortKeeperFirst<T extends { reviewed: boolean; ts: number }>(group: T[]): void {
  group.sort((a, b) => {
    if (a.reviewed !== b.reviewed) return a.reviewed ? -1 : 1;
    return b.ts - a.ts;
  });
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
  // Findings with an OPEN appeal (in the judge queue) must never be dedup-hidden:
  // an appeal is a human-requested re-review. Treat them like already-hidden so
  // they can be neither a loser nor a keeper that hides distinct siblings.
  const appealedRows = await listStoredWithKeysAll<{ findingId?: string }>("judge-pending", orgId);
  const appealed = new Set<string>();
  for (const { value } of appealedRows) if (value?.findingId) appealed.add(value.findingId);
  const indexEntries = await queryAuditDoneIndex(orgId, since, until);

  type Entry = { id: string; recordKey: string; ts: number; reviewed: boolean };
  const inRange: Entry[] = [];
  const needFinding: typeof indexEntries = [];

  // Group on the RECORDING (recordingId) — the only key unique per recording.
  // recordId is too coarse for date-legs: it is the destination value, shared
  // across many distinct recordings, so grouping on it falsely marks unrelated
  // date-legs as duplicates and hides them. Fall back to recordId only when an
  // entry has no recordingId (legacy rows), preserving prior behaviour there.
  //
  // KNOWN LIMITATION: a legacy index row with a recordId but no recordingId
  // still groups by the coarse recordId, so the original date-leg collision can
  // recur for those rows. Accepted on purpose — recovering the true recordingId
  // would cost a getFinding per legacy row, and new rows always carry
  // recordingId. The legacy-grouping behaviour is pinned by a test below.
  for (const e of indexEntries) {
    if (hidden.has(e.findingId) || appealed.has(e.findingId)) continue;
    const recordKey = e.recordingId ? String(e.recordingId) : (e.recordId ? String(e.recordId) : "");
    if (recordKey) {
      inRange.push({ id: e.findingId, recordKey, ts: e.completedAt, reviewed: e.reason === "reviewed" });
    } else {
      needFinding.push(e);
    }
  }

  // Fallback for entries with neither recordingId nor recordId — fetch the
  // finding and resolve the recording (then QB record) key from the doc.
  const orphaned: typeof needFinding = [];
  for (const e of needFinding) {
    const finding = await getFinding(orgId, e.findingId);
    const recordKey = String((finding as any)?.recordingId ?? "") || deriveQbRecordId(finding) || "";
    if (!recordKey) { orphaned.push(e); continue; }
    inRange.push({ id: e.findingId, recordKey, ts: e.completedAt, reviewed: e.reason === "reviewed" });
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
    sortKeeperFirst(group);
    toDelete.push({ ...group[0], keep: true });
    for (const dup of group.slice(1)) toDelete.push({ ...dup, keep: false });
  }

  // Orphaned entries have NO resolvable recordId, so we could not group them —
  // they are singletons by definition and must NOT be flagged as duplicates.
  // (Previously they were force-marked keep:false and hidden, producing
  // false-positive "duplicate" hides of lone audits — fixed.) Leave them
  // visible; surface the count + ids so an operator can investigate the
  // underlying index gap, and run the de-orphan tool to restore any already
  // wrongly hidden by the old behavior.
  if (orphaned.length) {
    console.warn(`[DEDUP] ⚠️ ${orphaned.length} orphaned (no resolvable recordId) — left visible: ${orphaned.map((e) => e.findingId).join(", ")}`);
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
): Promise<{ deleted: number; failed: number; failedIds: string[] }> {
  const losers = plan.toDelete.filter((d) => !d.keep);
  let deleted = 0;
  // Per-finding failures used to be swallowed (warn-only), so a partial run
  // looked identical to a clean one — "deleted N/N" even when some writes
  // failed. Collect the failed ids and return them so the caller/UI can show
  // exactly how many of the intended losers did NOT get hidden.
  const failedIds: string[] = [];
  for (const dup of losers) {
    try {
      await markFindingHidden(orgId, dup.id, "dedup");
      deleted++;
      onProgress?.(deleted, losers.length, dup.id);
    } catch (err) {
      failedIds.push(dup.id);
      console.warn(`[DEDUP] ⚠️ flag failed for ${dup.id}: ${(err as Error).message}`);
    }
    // 100ms gap between writes — slow but utterly reliable, no chance of
    // hammering Firestore. 200 findings × 100ms = 20s wall-clock.
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log(`[DEDUP] ✅ flagged ${deleted}/${losers.length} duplicates as hidden org=${orgId}${failedIds.length ? ` — ⚠️ ${failedIds.length} FAILED: ${failedIds.join(", ")}` : ""}`);
  return { deleted, failed: failedIds.length, failedIds };
}


// ── Read-only dedup diagnostic ───────────────────────────────────────────────
// Verification tool for the index-row cleanup. Scans a range and reports, per
// finding, how many audit-done-idx rows it has and which one the cleanup would
// KEEP (the reviewed/judged row, else newest) vs DELETE — WITHOUT writing or
// hiding anything. Mirrors collapseDuplicateIndexRows exactly (same scan, same
// pickCanonicalIndexRow) so what the operator sees is what Execute will do.

export interface DedupDiagMember {
  completedAt: number;
  score: number;
  reason: string;
  reviewedBy: string;
  recordingId: string;
  decision: "KEEP" | "DELETE";
}

export interface DedupDiagGroup {
  findingId: string;
  recordId: string;
  rowCount: number;
  members: DedupDiagMember[]; // keeper first
}

export interface DedupDiagnosis {
  since: number;
  until: number;
  scannedRows: number;        // total index rows in range
  distinctFindings: number;   // unique findingIds among those rows
  findingsWithDupes: number;  // findings carrying >1 row
  staleRows: number;          // redundant rows the cleanup would remove
  sampleShown: number;        // groups returned in sampleGroups
  sampleTotal: number;        // = findingsWithDupes (for "showing X of N")
  sampleGroups: DedupDiagGroup[];
}

export async function diagnoseDuplicates(
  orgId: OrgId,
  since: number,
  until: number,
): Promise<DedupDiagnosis> {
  // Shared scan+group with collapseDuplicateIndexRows — guarantees the preview
  // matches what Execute will act on.
  const { rows, byFinding } = await scanAndGroupByFinding(orgId, since, until);

  let findingsWithDupes = 0, staleRows = 0;
  const groups: DedupDiagGroup[] = [];
  for (const [findingId, group] of byFinding) {
    if (group.length <= 1) continue;
    findingsWithDupes++;
    staleRows += group.length - 1;
    const keepIdx = pickCanonicalIndexRow(group);
    const ordered = [group[keepIdx], ...group.filter((_, i) => i !== keepIdx)];
    groups.push({
      findingId,
      recordId: String(group[keepIdx].recordId ?? ""),
      rowCount: group.length,
      members: ordered.map((r, idx) => ({
        completedAt: r.completedAt,
        score: typeof r.score === "number" ? r.score : 0,
        reason: r.reason ?? "",
        reviewedBy: r.reviewedBy ?? "",
        recordingId: String(r.recordingId ?? ""),
        decision: idx === 0 ? "KEEP" : "DELETE",
      })),
    });
  }
  groups.sort((a, b) => b.rowCount - a.rowCount);
  const sampleGroups = groups.slice(0, 40);

  console.log(`[DEDUP-DIAG] org=${orgId} scannedRows=${rows.length} distinctFindings=${byFinding.size} findingsWithDupes=${findingsWithDupes} staleRows=${staleRows}`);

  return {
    since, until,
    scannedRows: rows.length,
    distinctFindings: byFinding.size,
    findingsWithDupes,
    staleRows,
    sampleShown: sampleGroups.length,
    sampleTotal: findingsWithDupes,
    sampleGroups,
  };
}

export const backfillChargebackEntriesLegacy = backfillChargebackEntries;
export const findDuplicatesLegacy = findDuplicates;
export const deleteDuplicatesLegacy = deleteDuplicates;
export const diagnoseDuplicatesLegacy = diagnoseDuplicates;
