/** Review queue service — FIFO ordering, claim/decide/back logic.
 *  Pure business logic for queue operations. Firestore-backed via setStored*.
 *
 *  Atomic ops in main are downgraded to read-modify-write — race windows are
 *  acceptable given typical reviewer concurrency and idempotent finalize. */

import {
  getStored, setStored, setStoredIfAbsent, deleteStored, listStoredWithKeys, listStoredWithKeysAll, listStoredByCompletedAt, listStoredByCompletedAtWithKeys, listStoredByKeyPrefix, withTiming,
} from "@core/data/firestore/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";
import type { ReviewItem, ReviewDecision } from "@core/dto/types.ts";
import {
  getFinding,
  saveFinding,
  getTranscript,
  saveBatchAnswers,
  getAllAnswersForFinding,
} from "@audit/domain/data/audit-repository/mod.ts";
import {
  writeSoleAuditDoneIndex,
  updateCompletedStatScore,
  saveChargebackEntry,
  saveWireDeductionEntry,
  deleteChargebackEntry,
  deleteWireDeductionEntry,
  deleteCompletedStat,
  deleteAuditDoneIdxByFindingId,
  getHiddenFindingIds,
  buildIndexMeta,
} from "@audit/domain/data/stats-repository/mod.ts";
import { fireWebhook } from "@admin/domain/data/admin-repository/mod.ts";
import { incrFlipToPass, incrFlipToFail, configKeyForFinding } from "@audit/domain/data/question-stats-repository/mod.ts";
import { writeFailedFindingRows } from "@audit/domain/data/failed-finding-repository/mod.ts";

const ACTIVE_TTL = 30 * 60 * 1000;
const LOCK_TTL = ACTIVE_TTL;

// ── Per-question mutual-exclusion lock ──────────────────────────────────────
// Two reviewers must NEVER work the same question. Pre-refactor this used
// Deno KV's atomic().check().set() against a "review-lock" table; the refactor
// dropped the lock table and stored claims under the reviewer email, so two
// reviewers writing concurrently each got their own active-claim doc and the
// same question appeared in both queues. Restored here using Firestore's
// create-only-if-absent precondition (setStoredIfAbsent), which is atomic at
// the document level. The lock value records who holds it; lock TTL matches
// ACTIVE_TTL so abandoned audits free up at the same cadence.

async function acquireLock(orgId: OrgId, findingId: string, questionIndex: number, reviewer: string, now: number): Promise<boolean> {
  const got = await setStoredIfAbsent(
    "review-lock", orgId,
    [findingId, questionIndex],
    { reviewer, claimedAt: now },
    { expireInMs: LOCK_TTL },
  );
  if (got) return true;
  // Doc exists physically. Two cases:
  //  - it's ours (reclaim after retry / partial failure) → success.
  //  - it's expired but the physical doc lingers → delete + retry.
  //  - it's held by another reviewer → fail.
  const existing = await getStored<{ reviewer: string; claimedAt: number }>("review-lock", orgId, findingId, questionIndex);
  if (existing && existing.reviewer === reviewer) return true;
  if (!existing) {
    // getStored() filters out expired docs but the physical row still exists.
    // Reset and retry the create.
    await deleteStored("review-lock", orgId, findingId, questionIndex);
    return await setStoredIfAbsent(
      "review-lock", orgId,
      [findingId, questionIndex],
      { reviewer, claimedAt: now },
      { expireInMs: LOCK_TTL },
    );
  }
  return false;
}

async function releaseLock(orgId: OrgId, findingId: string, questionIndex: number): Promise<void> {
  await deleteStored("review-lock", orgId, findingId, questionIndex);
}

async function releaseLocksForFinding(orgId: OrgId, findingId: string): Promise<void> {
  const locks = await listStoredWithKeys<{ reviewer: string }>("review-lock", orgId);
  for (const { key } of locks) {
    if (key[0] !== findingId) continue;
    await deleteStored("review-lock", orgId, ...key);
  }
}

/** Review buffer item — ReviewItem enriched with audit-context fields. */
export interface BufferItem extends ReviewItem {
  auditRemaining: number;
  transcript: { raw: string; diarized: string; utteranceTimes?: number[] } | null;
}

// ── Audit-session abandonment (lock TTL expiry handoff) ─────────────────────
// When the per-question lock TTL (ACTIVE_TTL, 30 min) passes without the
// reviewer finalizing, we treat the session as abandoned. The audit gets
// fully reset: every active + decided question goes back to review-pending,
// per-question locks are released, the audit-pending counter is restored to
// the full failed-question count. Whoever claims next sees a clean audit
// with no leftover decisions from the prior reviewer — no count inflation
// in the finalize modal, no cross-bleed.
//
// Trade-off: the prior reviewer's mid-session work is lost. Users accept
// this — 30 min idle = abandoned. If they need their work preserved they
// have to finalize within the window.
//
// IMPORTANT: caller MUST pre-fetch the active + decided collection scans
// ONCE (via the sweep in claimNextItem) and pass them in here. The earlier
// version re-ran two full scans per finding, so a sweep over N expired
// audits did 2N scans + serial writes, saturating the HTTP/2 connection
// pool to Firestore for tens of seconds. That FS storm was what was
// timing out login. Sharing the scans + parallelizing the writes drops
// per-audit cost to a single batch of parallel ops.
async function abandonAuditSessionWithData(
  orgId: OrgId,
  findingId: string,
  active: Array<{ key: string[]; value: ReviewItem & { claimedAt?: number } }>,
  decided: Array<{ key: string[]; value: ReviewDecision }>,
): Promise<number> {
  const ops: Array<Promise<unknown>> = [];
  let restored = 0;

  // Move every active question for this finding back to pending and release
  // its lock. Key shape: [reviewer, findingId, qIndex].
  for (const { key, value } of active) {
    if (value.findingId !== findingId) continue;
    const { claimedAt: _, ...rest } = value;
    const baseItem = rest as ReviewItem;
    ops.push(setStored("review-pending", orgId, [findingId, value.questionIndex], baseItem));
    ops.push(deleteStored("review-active", orgId, ...key));
    ops.push(releaseLock(orgId, findingId, value.questionIndex));
    restored++;
  }

  // Move every decided question for this finding back to pending (drop the
  // decision metadata, keep the original question payload).
  for (const { key, value } of decided) {
    if (value.findingId !== findingId) continue;
    const baseItem: ReviewItem = {
      findingId: value.findingId,
      questionIndex: value.questionIndex,
      reviewIndex: value.reviewIndex,
      totalForFinding: value.totalForFinding,
      header: value.header ?? "",
      populated: value.populated ?? "",
      thinking: value.thinking ?? "",
      defense: value.defense ?? "",
      answer: value.answer ?? "No",
      ...(value.recordingIdField ? { recordingIdField: value.recordingIdField } : {}),
      ...(value.recordId ? { recordId: value.recordId } : {}),
      ...(value.recordMeta ? { recordMeta: value.recordMeta } : {}),
      ...(value.completedAt != null ? { completedAt: value.completedAt } : {}),
    };
    ops.push(setStored("review-pending", orgId, [findingId, value.questionIndex], baseItem));
    ops.push(deleteStored("review-decided", orgId, ...key));
    restored++;
  }

  // Reset the audit-pending counter to the full restored count so the
  // stranded-resume guard in claimNextItem doesn't fire on this audit.
  if (restored > 0) {
    ops.push(setStored("review-audit-pending", orgId, [findingId], restored));
  }

  // Fire every write concurrently. Failures get caught per-op and logged —
  // a single failed write should NOT abort the whole sweep (next claim
  // will retry from the still-stale state).
  const results = await Promise.allSettled(ops);
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) {
    console.warn(`[REVIEW] abandonAuditSession ${findingId}: ${failed}/${ops.length} ops failed`);
  }
  console.log(`[REVIEW] abandonAuditSession ${findingId}: restored ${restored} question(s) to pending`);
  return restored;
}

/** How many abandoned audits to process per single claimNextItem call.
 *  Bounds the FS storm — if 50 audits expired (e.g. mass-reviewer-idle),
 *  we don't try to clean them all in one request. Subsequent claims pick
 *  up the rest, naturally rate-limiting the cleanup. */
const ABANDON_BATCH_PER_CLAIM = 3;

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
  // Refuse to queue if the finding is not in a terminal state. Without this
  // guard, a re-prepare race (status flipped back to populating-questions
  // mid-finalize) could leave review-pending rows pointing at a finding
  // whose answeredQuestions get wiped a moment later — reviewers then see
  // questions that don't exist on the finding doc, and finalize aborts.
  const liveFinding = await getFinding(orgId, findingId);
  if (liveFinding && liveFinding.findingStatus !== "finished") {
    console.warn(`⚠️ [POPULATE-REVIEW-QUEUE] ${findingId}: skipped — finding.findingStatus=${liveFinding.findingStatus} (expected "finished")`);
    return;
  }

  const noAnswers = answeredQuestions
    .map((q, i) => ({ ...q, index: i }))
    .filter((q) => q.answer === "No")
    // Drop phantom entries with no header AND no populated text. These come
    // from compound `+:` question expansion or upstream prep bugs that leave
    // a blank slot in answeredQuestions. Queuing them produces a review-item
    // with no readable question text — reviewer can hit Flip/Confirm but
    // finalize's identity match has nothing to match against, so the audit
    // gets permanently stuck. Better to skip them at queue time.
    .filter((q) => {
      const hasHeader = String(q.header ?? "").trim().length > 0;
      const hasPopulated = String(q.populated ?? "").trim().length > 0;
      if (!hasHeader && !hasPopulated) {
        console.warn(`⚠️ [POPULATE-REVIEW-QUEUE] ${findingId}: skipping phantom answered[${q.index}] — empty header AND populated`);
        return false;
      }
      return true;
    });

  if (noAnswers.length === 0) return;

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
    await setStored("review-pending", orgId, [findingId, q.index], item);
  }
  await setStored("review-audit-pending", orgId, [findingId], noAnswers.length);
  console.log(`✅ [REVIEW] ${findingId}: Queued ${noAnswers.length} items for review`);
}

// ── FIFO selection (pure) ───────────────────────────────────────────────────

export interface PendingItem<T = ReviewItem> {
  key: string[];
  value: T;
}

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

// ── Claim Next Item ─────────────────────────────────────────────────────────

async function enrichItem(
  orgId: OrgId,
  item: ReviewItem,
  sharedTranscript?: BufferItem["transcript"],
): Promise<BufferItem> {
  let transcript = sharedTranscript !== undefined
    ? sharedTranscript
    : await getTranscript(orgId, item.findingId);
  // Fallback: legacy / unmigrated findings keep the transcript text on the
  // finding doc itself (rawTranscript / fixedTranscript / diarizedTranscript)
  // even when the chunked audit-transcript doc is missing. Without this the
  // panel renders "No transcript available" for every reviewer in those orgs.
  if (transcript == null) {
    try {
      const finding = await getFinding(orgId, item.findingId) as Record<string, unknown> | null;
      const raw = String(
        (finding?.rawTranscript as string | undefined)
          ?? (finding?.fixedTranscript as string | undefined)
          ?? "",
      ).trim();
      const diarized = String((finding?.diarizedTranscript as string | undefined) ?? raw).trim();
      if (raw || diarized) {
        transcript = { raw, diarized, utteranceTimes: [] };
        console.log(`📝 [REVIEW] ${item.findingId}: transcript chunk missing, fell back to finding.rawTranscript (${raw.length}b)`);
      }
    } catch (e) {
      console.warn(`⚠️  [REVIEW] ${item.findingId}: transcript fallback lookup failed`, e);
    }
  }
  const counterVal = (await getStored<number>("review-audit-pending", orgId, item.findingId)) ?? 0;
  return { ...item, auditRemaining: counterVal, transcript };
}

/** Re-derive question payload + recordMeta from the finding when the stored
 *  ReviewItem has empty/missing fields. Happens when a decision was recorded
 *  from a stale active buffer (race) or after a discardReview round-trip
 *  copied empty fields back to pending. The recordMeta shape mirrors what
 *  populateReviewQueue's caller (step-finalize) builds on first ingest. */
async function rehydrateItemFromFinding(orgId: OrgId, item: ReviewItem): Promise<ReviewItem> {
  const hasMeta = item.recordMeta && Object.keys(item.recordMeta).length > 0;
  if (item.header && item.populated && hasMeta && item.totalForFinding) return item;
  try {
    const finding = await getFinding(orgId, item.findingId) as Record<string, unknown> | null;
    if (!finding) return item;
    const answeredQuestions = (finding.answeredQuestions as Array<{ answer: string; header: string; populated: string; thinking: string; defense: string }> | undefined) ?? [];
    const q = answeredQuestions[item.questionIndex];
    const noOnly = answeredQuestions.filter((x) => x.answer === "No");
    const reviewIndexFromFinding = q ? noOnly.findIndex((x) => x.header === q.header) + 1 : 0;

    const rec = (finding.record ?? {}) as Record<string, unknown>;
    const isPackage = finding.recordingIdField === "GenieNumber";
    const builtMeta = isPackage ? {
      voName: rec.VoName ? String(rec.VoName) : undefined,
      guestName: rec.GuestName ? String(rec.GuestName) : undefined,
      maritalStatus: rec["67"] ? String(rec["67"]) : undefined,
      officeName: rec.OfficeName ? String(rec.OfficeName) : undefined,
      totalAmountPaid: rec["145"] ? String(rec["145"]) : undefined,
      hasMCC: rec["345"] ? String(rec["345"]) : undefined,
      mspSubscription: rec["306"] ? String(rec["306"]) : undefined,
    } : {
      voName: rec.VoName ? String(rec.VoName) : undefined,
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

    const recordIdFromFinding = String(rec.RecordId ?? rec.RelatedDestinationId ?? rec.GenieNumber ?? "");

    const filled: ReviewItem = {
      ...item,
      header: item.header || q?.header || "",
      populated: item.populated || q?.populated || "",
      thinking: item.thinking || q?.thinking || "",
      defense: item.defense || q?.defense || "",
      answer: item.answer || q?.answer || "No",
      reviewIndex: item.reviewIndex || reviewIndexFromFinding || 1,
      totalForFinding: item.totalForFinding || noOnly.length || 1,
      ...(finding.recordingIdField ? { recordingIdField: String(finding.recordingIdField) } : {}),
      ...(item.recordId || recordIdFromFinding ? { recordId: item.recordId || recordIdFromFinding } : {}),
      recordMeta: hasMeta ? item.recordMeta : builtMeta,
    };
    if (!item.header || !item.populated || !hasMeta) {
      console.log(`🛠️  [REVIEW:REHYDRATE] ${item.findingId}/${item.questionIndex}: filled empty fields from finding`);
    }
    return filled;
  } catch (e) {
    console.warn(`⚠️  [REVIEW:REHYDRATE] ${item.findingId}/${item.questionIndex}: rehydrate failed`, e);
    return item;
  }
}

export async function claimNextItem(
  orgId: OrgId,
  reviewer: string,
  allowedTypes?: string[],
): Promise<{ buffer: BufferItem[]; remaining: number; retry?: boolean }> {
  const now = Date.now();
  const hidden = await getHiddenFindingIds(orgId);

  // 1. Sweep expired active claims from OTHER reviewers — fully reset
  //    every audit whose lock expired. The lock TTL (30 min) is the
  //    abandon threshold: once it passes, the original reviewer's
  //    in-flight session is dead. We don't want the next reviewer to
  //    inherit partial work or get stale decisions counted against them
  //    in the finalize modal. So instead of just rolling individual
  //    questions back, we collect every finding with at least one
  //    expired active item and fully reset that audit's state below.
  const allActive = await listStoredWithKeys<ReviewItem & { claimedAt: number }>("review-active", orgId);
  // Collect findings with at least one expired active claim. Sorted by
  // claimedAt ascending (oldest first) so a per-claim batch always
  // handles the longest-abandoned audits first.
  const expiredByAge: Array<{ findingId: string; claimedAt: number }> = [];
  const expiredSeen = new Set<string>();
  for (const { key, value } of allActive) {
    if (key[0] === reviewer) continue;
    if (value.claimedAt && (now - value.claimedAt) > ACTIVE_TTL) {
      if (expiredSeen.has(value.findingId)) continue;
      expiredSeen.add(value.findingId);
      expiredByAge.push({ findingId: value.findingId, claimedAt: value.claimedAt });
    }
  }
  expiredByAge.sort((a, b) => a.claimedAt - b.claimedAt);
  const findingsToAbandon = expiredByAge.slice(0, ABANDON_BATCH_PER_CLAIM).map((e) => e.findingId);
  if (expiredByAge.length > ABANDON_BATCH_PER_CLAIM) {
    console.log(`[REVIEW] abandon sweep capped: ${expiredByAge.length} expired, processing ${ABANDON_BATCH_PER_CLAIM} this claim`);
  }

  // Pre-fetch review-decided ONCE shared across every abandon in this
  // batch — earlier version re-scanned both collections per finding,
  // which is what was saturating the connection pool and timing out
  // login. allActive is already in hand from the sweep above.
  let activeAfterSweep = allActive;
  if (findingsToAbandon.length > 0) {
    const allDecided = await listStoredWithKeys<ReviewDecision>("review-decided", orgId);
    for (const fid of findingsToAbandon) {
      await abandonAuditSessionWithData(orgId, fid, allActive, allDecided);
    }
    // Re-read active rows since abandonAuditSessionWithData modified them.
    activeAfterSweep = await listStoredWithKeys<ReviewItem & { claimedAt: number }>("review-active", orgId);
  }

  // 2. Collect existing active items for this reviewer
  const myActive: ReviewItem[] = activeAfterSweep
    .filter(({ key }) => key[0] === reviewer)
    .map(({ value }) => {
      const { claimedAt: _, ...rest } = value;
      return rest as ReviewItem;
    });

  // 3. Legacy migration: if active items span multiple findings, keep the largest cluster
  if (myActive.length > 0) {
    const findingCounts = new Map<string, number>();
    for (const item of myActive) findingCounts.set(item.findingId, (findingCounts.get(item.findingId) ?? 0) + 1);
    if (findingCounts.size > 1) {
      let bestFid = ""; let bestCount = 0;
      for (const [fid, count] of findingCounts) { if (count > bestCount) { bestFid = fid; bestCount = count; } }
      for (const item of myActive) {
        if (item.findingId !== bestFid) {
          await setStored("review-pending", orgId, [item.findingId, item.questionIndex], item);
          await deleteStored("review-active", orgId, reviewer, item.findingId, item.questionIndex);
        }
      }
      const kept = myActive.filter((i) => i.findingId === bestFid);
      myActive.length = 0;
      myActive.push(...kept);
      console.log(`[REVIEW] Legacy migration: kept ${kept.length} items for ${bestFid}, released rest`);
    }
  }

  // 4. If reviewer already has active items, return them (locked into this audit)
  if (myActive.length > 0) {
    myActive.sort((a, b) => a.reviewIndex - b.reviewIndex);
    const transcript = await getTranscript(orgId, myActive[0].findingId);
    const buffer: BufferItem[] = [];
    for (const item of myActive) buffer.push(await enrichItem(orgId, item, transcript));
    return { buffer, remaining: 0 };
  }

  // 4b. Resume-stranded-audit guard: if all the reviewer's decisions have
  //     moved from review-active to review-decided but the finding was never
  //     finalized (Cancel-on-finalize, or browser closed mid-finalize), bring
  //     the audit back instead of handing the reviewer a fresh one. Without
  //     this, the original audit sits with all decisions recorded but no
  //     review-done marker, and a different reviewer won't pick it up either
  //     because review-pending was drained when the items were claimed.
  const allDecided = await listStoredWithKeys<ReviewDecision>("review-decided", orgId);
  const myDecidedByFinding = new Map<string, ReviewDecision[]>();
  for (const { value } of allDecided) {
    if (value.reviewer !== reviewer) continue;
    const fid = value.findingId;
    if (!myDecidedByFinding.has(fid)) myDecidedByFinding.set(fid, []);
    myDecidedByFinding.get(fid)!.push(value);
  }
  for (const [fid, decisions] of myDecidedByFinding) {
    if (hidden.has(fid)) continue;
    // Skip if already finalized
    const done = await getStored<{ reviewedAt?: string }>("review-done", orgId, fid);
    if (done) continue;
    // Skip if pending or active items still exist for this finding (audit
    // not really complete — let normal flow handle it)
    const counter = await getStored<number>("review-audit-pending", orgId, fid);
    if (counter == null || counter > 0) continue;
    // Type filter still applies
    const sample = decisions[0];
    if (allowedTypes) {
      const isPackage = sample.recordingIdField === "GenieNumber";
      const itemType = isPackage ? "package" : "date-leg";
      if (!allowedTypes.includes(itemType)) continue;
    }
    // Hydrate buffer from decided records — the panel re-renders with the
    // full failed-questions list (the controller already merges decisions).
    // Empty header/populated/recordMeta on a decided record (can happen when
    // the original active buffer was hollow) would render dashes for guest /
    // record / question text — apply the rehydrate safety net so the resumed
    // audit looks identical to a fresh claim.
    const transcript = await getTranscript(orgId, fid);
    const buffer: BufferItem[] = [];
    decisions.sort((a, b) => (a.reviewIndex ?? 0) - (b.reviewIndex ?? 0));
    for (const d of decisions) {
      // Coerce numeric fields with `||` (NOT `??`) so a stored 0 — which
      // happens when an early decision was recorded against a stale active
      // buffer — is treated as "missing" and recovered. Without this the
      // panel renders "0 FAILED" and rehydrate's own `||` checks short-
      // circuit because they see truthy values arriving.
      const baseItem: ReviewItem = {
        findingId: d.findingId,
        questionIndex: d.questionIndex,
        reviewIndex: d.reviewIndex || 1,
        totalForFinding: d.totalForFinding || decisions.length,
        header: d.header ?? "",
        populated: d.populated ?? "",
        thinking: d.thinking ?? "",
        defense: d.defense ?? "",
        answer: d.answer ?? "No",
        ...(d.recordingIdField ? { recordingIdField: d.recordingIdField } : {}),
        ...(d.recordId ? { recordId: d.recordId } : {}),
        ...(d.recordMeta ? { recordMeta: d.recordMeta } : {}),
        ...(d.completedAt != null ? { completedAt: d.completedAt } : {}),
      };
      const item = await rehydrateItemFromFinding(orgId, baseItem);
      buffer.push(await enrichItem(orgId, item, transcript));
    }
    console.log(`[REVIEW] ${reviewer}: Resumed stranded audit ${fid} (${decisions.length} decided, awaiting finalize)`);
    return { buffer, remaining: 0 };
  }

  // 5. No active items — claim the OLDEST pending audit whose questions we
  //    can fully lock. Lock acquisition is atomic per question via
  //    setStoredIfAbsent against the shared review-lock table. If ANY question
  //    of an audit is held by another reviewer, we roll back our partial locks
  //    and try the next-oldest audit. This is the multi-reviewer mutual-exclusion
  //    guarantee that pre-refactor used db.atomic().check().set() to provide.
  const allPending = await listStoredWithKeys<ReviewItem>("review-pending", orgId);
  const findingTimestamps = new Map<string, number>();
  const pendingByFinding = new Map<string, Array<{ key: string[]; value: ReviewItem }>>();
  for (const row of allPending) {
    if (hidden.has(row.value.findingId)) continue;
    if (allowedTypes) {
      const isPackage = row.value.recordingIdField === "GenieNumber";
      const itemType = isPackage ? "package" : "date-leg";
      if (!allowedTypes.includes(itemType)) continue;
    }
    const fid = row.value.findingId;
    if (!pendingByFinding.has(fid)) pendingByFinding.set(fid, []);
    pendingByFinding.get(fid)!.push(row);
    const ts = row.value.completedAt ?? 0;
    if (!findingTimestamps.has(fid) || ts < findingTimestamps.get(fid)!) {
      findingTimestamps.set(fid, ts);
    }
  }

  // FIFO order — oldest completedAt first.
  const findingsByAge = [...findingTimestamps.entries()].sort((a, b) => a[1] - b[1]);

  for (const [targetFindingId, _ts] of findingsByAge) {
    const pendingEntries = pendingByFinding.get(targetFindingId) ?? [];
    if (pendingEntries.length === 0) continue;

    // Phase 1: try to acquire ALL question-level locks for this finding.
    const acquired: Array<{ findingId: string; questionIndex: number }> = [];
    let allAcquired = true;
    for (const { value } of pendingEntries) {
      const got = await acquireLock(orgId, value.findingId, value.questionIndex, reviewer, now);
      if (got) {
        acquired.push({ findingId: value.findingId, questionIndex: value.questionIndex });
        continue;
      }
      allAcquired = false;
      break;
    }

    if (!allAcquired) {
      // Roll back partial locks and try the next-oldest finding.
      for (const lk of acquired) await releaseLock(orgId, lk.findingId, lk.questionIndex);
      console.log(`[REVIEW] ${reviewer}: Lost lock race on audit ${targetFindingId}, trying next finding`);
      continue;
    }

    // Phase 2: locks acquired — safe to write active claims and clear pending.
    const claimed: ReviewItem[] = [];
    for (const { key, value } of pendingEntries) {
      await setStored("review-active", orgId, [reviewer, value.findingId, value.questionIndex], { ...value, claimedAt: now });
      await deleteStored("review-pending", orgId, ...key);
      claimed.push(value);
    }

    if (claimed.length === 0) {
      // Nothing actually pending after lock — release locks and continue.
      for (const lk of acquired) await releaseLock(orgId, lk.findingId, lk.questionIndex);
      continue;
    }

    claimed.sort((a, b) => a.reviewIndex - b.reviewIndex);
    const transcript = await getTranscript(orgId, claimed[0].findingId);
    const buffer: BufferItem[] = [];
    for (const item of claimed) buffer.push(await enrichItem(orgId, item, transcript));
    console.log(`[REVIEW] ${reviewer}: Claimed ${claimed.length} items for audit ${targetFindingId}`);
    return { buffer, remaining: 0 };
  }

  // Loop exhausted without successfully claiming. Two cases:
  //  1. There were no candidate findings at all (after type/hidden filter)
  //     → genuinely empty queue, show "All caught up".
  //  2. Candidates existed but every one had at least one question locked
  //     by another reviewer (lost the lock race on every audit) → NOT empty,
  //     just transient contention. Tell the caller to retry instead of
  //     bouncing the user to the empty state.
  // Also detect "queue is non-empty system-wide but this reviewer's type
  // filter and lock fate left them with nothing" — we still want a retry
  // because items they've filtered out might shift, or a reviewer may
  // release a lock seconds from now.
  const hadCandidates = findingsByAge.length > 0;
  const queueHasItemsForReviewer = hadCandidates;
  if (queueHasItemsForReviewer) {
    console.log(`[REVIEW] ${reviewer}: claimNextItem found ${findingsByAge.length} candidates but couldn't lock any — signalling retry`);
    return { buffer: [], remaining: 0, retry: true };
  }
  return { buffer: [], remaining: 0 };
}

// ── Decision Recording ──────────────────────────────────────────────────────

/** A question is excluded from handle-time stats once it accrues this much idle
 *  (tab hidden, or >60s of no mouse/hover/key activity) — insulates averages
 *  from someone leaving the screen open. Mirrors the island's idle threshold. */
export const REVIEW_IDLE_DISCARD_MS = 60_000;

/** A gap longer than this between two consecutive decisions is a break (the
 *  reviewer stepped away), not active work — that question's time is discarded. */
export const REVIEW_BREAK_MS = 15 * 60_000;

/** Per-question handle time = the gap between this decision and the previous one
 *  (the time spent working THIS question). Discarded (no time counted) when there's
 *  no prior gap, the gap is a break (>15 min), or the client flagged ≥60s idle. */
export function questionTimingFromGap(
  gapMs: number | undefined,
  clientIdleMs: number,
): { handleMs?: number; discarded: boolean } {
  const discarded = gapMs == null || gapMs <= 0 || gapMs > REVIEW_BREAK_MS || clientIdleMs >= REVIEW_IDLE_DISCARD_MS;
  return { handleMs: discarded ? undefined : gapMs, discarded };
}

export async function recordDecision(
  orgId: OrgId,
  findingId: string,
  questionIndex: number,
  decision: "confirm" | "flip",
  reviewer: string,
  handleMs?: number,
  idleMs?: number,
): Promise<{ remaining: number; auditComplete: boolean }> {
  const now = Date.now();

  // Detect a re-decision: the reviewer went BACK to an already-decided question
  // via the Failed-Questions pills (jumpToQuestion re-creates a review-active row
  // for it). The audit-pending counter must be decremented exactly ONCE per
  // question — on its FIRST decision. Re-deciding overwrites the decided record
  // but must NOT decrement again, or the counter under-counts the still-undecided
  // questions and the audit finalizes a question early (the last flip never lands
  // → wrong score, e.g. 96%). Captured BEFORE the review-decided overwrite below.
  // (The Undo / `B` path is unaffected — undoDecision deletes the decided record
  // and increments the counter, so a later re-grade correctly counts as "first".)
  const priorDecision = await getStored<ReviewDecision>("review-decided", orgId, findingId, questionIndex);
  const isRedecision = priorDecision != null;

  // Load full item from active so the decided record includes header/populated/etc.
  let baseItem: ReviewItem | null = null;
  const activeVal = await getStored<ReviewItem & { claimedAt?: number }>("review-active", orgId, reviewer, findingId, questionIndex);
  if (activeVal) {
    const { claimedAt: _, ...rest } = activeVal;
    baseItem = rest as ReviewItem;
  } else {
    baseItem = await getStored<ReviewItem>("review-pending", orgId, findingId, questionIndex);
  }
  if (!baseItem) {
    baseItem = {
      findingId, questionIndex,
      reviewIndex: 0, totalForFinding: 0,
      header: "", populated: "", thinking: "", defense: "", answer: "No",
    };
  }

  const cleanHandleMs = typeof handleMs === "number" && Number.isFinite(handleMs) && handleMs >= 0 ? Math.round(handleMs) : undefined;
  const cleanIdleMs = typeof idleMs === "number" && Number.isFinite(idleMs) && idleMs >= 0 ? Math.round(idleMs) : undefined;
  const discarded = (cleanIdleMs ?? 0) >= REVIEW_IDLE_DISCARD_MS;
  const decisionRecord: ReviewDecision = {
    ...baseItem, decision, reviewer, decidedAt: now,
    handleMs: cleanHandleMs, idleMs: cleanIdleMs, discarded,
  };
  await setStored("review-decided", orgId, [findingId, questionIndex], decisionRecord);

  // Undo index — keyed by reverse-chronological so listing gives newest first
  const undoIdxKey = String(9_000_000_000_000_000 - now).padStart(16, "0");
  await setStored("review-undo-idx", orgId, [reviewer, undoIdxKey], { findingId, questionIndex });

  await deleteStored("review-active", orgId, reviewer, findingId, questionIndex);
  // Release this question's mutual-exclusion lock now that the decision is
  // recorded. The audit's other questions remain locked until they're decided
  // (or until LOCK_TTL fires and we sweep on the next claim attempt).
  await releaseLock(orgId, findingId, questionIndex);

  // Refresh claimedAt on the reviewer's REMAINING active items for this
  // audit. Without this, the 30-min ACTIVE_TTL measures time-since-claim
  // rather than time-since-last-activity — a reviewer who takes >30 min
  // on a complex audit (totally reasonable for date-leg deep dives) gets
  // their session abandoned mid-review by another reviewer's claim sweep,
  // and the other reviewer ends up with the SAME audit + question buffer.
  // Refreshing on every decision means: actively-deciding reviewers
  // keep their lock indefinitely; only genuinely-idle sessions expire.
  try {
    const remainingActive = await listStoredWithKeys<ReviewItem & { claimedAt?: number }>("review-active", orgId);
    const myRemaining = remainingActive.filter(({ key, value }) =>
      key[0] === reviewer && value.findingId === findingId
    );
    await Promise.all(myRemaining.map(({ key, value }) => {
      const { claimedAt: _, ...rest } = value;
      return setStored("review-active", orgId, key, { ...rest, claimedAt: now });
    }));
  } catch (err) {
    // Best-effort — a failure here just means the lock TTL is a bit
    // stale, the next decision will refresh it. Don't block the user.
    console.warn(`⚠️ [REVIEW] ${findingId}: failed to refresh claimedAt on remaining active items:`, err);
  }

  const counter = (await getStored<number>("review-audit-pending", orgId, findingId)) ?? 1;
  // Only decrement on the FIRST decision for this question. A re-decision (reached
  // by clicking a Failed-Questions pill to go back) leaves the counter unchanged —
  // the question was already counted as decided.
  const newCount = isRedecision ? counter : Math.max(0, counter - 1);
  await setStored("review-audit-pending", orgId, [findingId], newCount);

  console.log(`✅ [REVIEW] ${findingId}/${questionIndex}: ${decision} by ${reviewer} (${newCount} remaining)`);

  return { remaining: newCount, auditComplete: newCount <= 0 };
}

// ── Finalize Reviewed Audit ─────────────────────────────────────────────────

export async function finalizeReviewedAudit(
  orgId: OrgId,
  findingId: string,
  reviewer: string,
): Promise<{ ok: true; score: number; alreadyFinalized?: boolean; skippedFlips?: number }> {
  // Idempotency guard
  const existingDone = await getStored<{ reviewScore?: number }>("review-done", orgId, findingId);
  if (existingDone) {
    console.log(`⏭️  [REVIEW] ${findingId}: already finalized, skipping`);
    return { ok: true, score: existingDone.reviewScore ?? 0, alreadyFinalized: true };
  }

  // Collect all decisions for this finding. Doc IDs encode
  // `review-decided__<org>__<findingId>__<qIndex>`, so a key-prefix scan
  // pulls just this audit's rows instead of the org-wide brute-force scan
  // (which used to dominate finalize latency on busy queues).
  const allDecided = await listStoredByKeyPrefix<ReviewDecision>("review-decided", orgId, findingId);
  const decisions = new Map<number, ReviewDecision>();
  for (const { value } of allDecided) {
    if (value?.questionIndex != null) decisions.set(value.questionIndex, value);
  }
  if (decisions.size === 0) {
    console.warn(`⚠️  [REVIEW] ${findingId}: no decisions found at finalize — skipping`);
    return { ok: true, score: 0, alreadyFinalized: true };
  }

  // Findings are chunk-stored; under a duplicate-call window the first read
  // can land between chunk writes. Retry a few times.
  let finding = await getFinding(orgId, findingId);
  for (let attempt = 1; attempt <= 3 && !finding; attempt++) {
    await new Promise((r) => setTimeout(r, 200 * attempt));
    finding = await getFinding(orgId, findingId);
  }
  if (!finding) {
    console.error(`❌ [REVIEW] ${findingId}: finding not found at finalize (after retries)`);
    return { ok: true, score: 0, alreadyFinalized: false };
  }

  // HARD PRE-FLIGHT — refuse to finalize if the audit is mid-pipeline.
  // Without this guard, an audit that was queued from an earlier "finished"
  // run but has since been re-prepared (status flipped back to
  // populating-questions / transcribing / etc.) will finalize against an
  // empty answeredQuestions array, write review-done at score=0, and
  // fire the terminate webhook → wrong-result email to the agent (the
  // _gCdfZrviiR7X2C0-xxy0 incident on 2026-05-14). NO webhook, NO
  // review-done write.
  //
  // We ALSO drain the stale review queue rows for this finding so the
  // reviewer isn't trapped in a stranded-resume loop on the obsolete
  // claim. step-finalize will re-populate the queue from scratch when
  // the new pipeline run completes.
  const liveStatus = String((finding as { findingStatus?: string }).findingStatus ?? "");
  if (liveStatus !== "finished") {
    console.error(
      `❌ [REVIEW] ${findingId}: REFUSING to finalize — finding.findingStatus="${liveStatus}" (expected "finished"). Audit is mid-pipeline; finalize would write a phantom score and fire an incorrect terminate webhook. Dropping stale review queue rows for this finding so the reviewer isn't stranded.`,
    );
    try {
      // Best-effort cleanup — same pattern adminFlipFinding uses.
      const drainPending = await listStoredWithKeys<{ findingId?: string }>("review-pending", orgId);
      const drainDecided = await listStoredWithKeys<{ findingId?: string }>("review-decided", orgId);
      const drainActive = await listStoredWithKeys<{ findingId?: string }>("review-active", orgId);
      await Promise.all([
        ...drainPending.filter((r) => r.key[0] === findingId).map((r) => deleteStored("review-pending", orgId, ...r.key)),
        ...drainDecided.filter((r) => r.key[0] === findingId).map((r) => deleteStored("review-decided", orgId, ...r.key)),
        ...drainActive.filter((r) => r.value?.findingId === findingId).map((r) => deleteStored("review-active", orgId, ...r.key)),
        deleteStored("review-audit-pending", orgId, findingId).catch(() => {}),
      ]);
      await releaseLocksForFinding(orgId, findingId);
    } catch (e) {
      console.warn(`[REVIEW] ${findingId}: drain on refusal failed (non-fatal):`, e);
    }
    throw new Error(`audit not yet complete — finding.findingStatus="${liveStatus}". Stale review state has been cleared; the audit will return to the queue when the pipeline finishes.`);
  }

  const answered: Array<Record<string, unknown>> = Array.isArray(finding.answeredQuestions)
    ? [...finding.answeredQuestions]
    : [];

  // Second pre-flight — answeredQuestions intact? An empty array means
  // the finding is missing its question state even though status reads
  // "finished" (chunked-read race, prep-corruption, etc.). Same blast
  // radius as the status check: refuse, do NOT write or webhook.
  if (answered.length === 0) {
    console.error(
      `❌ [REVIEW] ${findingId}: REFUSING to finalize — answered.length=0 despite findingStatus="finished". Will not write review-done or fire terminate webhook against an empty answered array.`,
    );
    throw new Error(`audit has no answered questions — refusing to finalize and email a phantom score.`);
  }

  // Match each decision to the right answered-question entry by stable
  // identity (header + populated text), NOT by positional index. The
  // questionIndex stored on a ReviewDecision is the position in
  // answeredQuestions AT QUEUE-TIME — if anything between then and now
  // shifted the array (re-prepare, re-audit, bonus-flip ordering quirks,
  // etc), the index is stale and we'd flip the wrong question. The
  // reviewer's decision record captured the question's header/populated
  // text when they made the call, so matching on that text guarantees
  // we apply their flip to the question they actually saw.
  //
  // Falls back to positional index if no text match exists. Logs every
  // case so a divergence is loud in prod.
  function applyDecisionByIdentity(d: ReviewDecision): { matched: "identity" | "index" | "none"; targetIdx: number } {
    const decHeader = String(d.header ?? "").trim();
    const decPopulated = String(d.populated ?? "").trim();
    if (decHeader || decPopulated) {
      let identityIdx = -1;
      for (let i = 0; i < answered.length; i++) {
        const a = answered[i] as { header?: string; populated?: string } | null | undefined;
        if (!a) continue;
        const aHeader = String(a.header ?? "").trim();
        const aPopulated = String(a.populated ?? "").trim();
        if (decHeader && aHeader && aHeader === decHeader && (!decPopulated || !aPopulated || aPopulated === decPopulated)) {
          identityIdx = i;
          break;
        }
        if (!decHeader && decPopulated && aPopulated && aPopulated === decPopulated) {
          identityIdx = i;
          break;
        }
      }
      if (identityIdx >= 0) return { matched: "identity", targetIdx: identityIdx };
    }
    if (d.questionIndex >= 0 && d.questionIndex < answered.length) {
      return { matched: "index", targetIdx: d.questionIndex };
    }
    return { matched: "none", targetIdx: -1 };
  }

  const flipDiag: Array<{ qIndex: number; targetIdx: number; matched: string; decision: string; prevAnswer: string; finalAnswer: string }> = [];
  // Per-question handle time, server-measured: the gap between consecutive
  // decisions (sorted by decidedAt) is the time spent on the later-decided
  // question. A question is discarded (no time counted) when its gap exceeds the
  // 15-min break threshold OR the client island flagged >=60s idle on it. The
  // first-decided question has no prior gap, so it's excluded.
  const timing = new Map<ReviewDecision, { handleMs?: number; discarded: boolean }>();
  const sortedByTime = [...decisions.values()].sort((a, b) => (a.decidedAt ?? 0) - (b.decidedAt ?? 0));
  for (let i = 0; i < sortedByTime.length; i++) {
    const d = sortedByTime[i];
    const prevAt = i > 0 ? sortedByTime[i - 1].decidedAt : undefined;
    const gap = (prevAt != null && d.decidedAt != null) ? d.decidedAt - prevAt : undefined;
    timing.set(d, questionTimingFromGap(gap, d.idleMs ?? 0));
  }

  // Review handle-time rollup (forward-only). Discarded questions are excluded
  // from the sum + valid count so breaks / idle don't skew stats.
  let sumHandleMs = 0, reviewedQuestionCount = 0, reviewedValidCount = 0;
  const cfgKey = configKeyForFinding(finding as Record<string, any>);
  for (const d of decisions.values()) {
    const { matched, targetIdx } = applyDecisionByIdentity(d);
    const t = timing.get(d) ?? { discarded: true };
    reviewedQuestionCount++;
    if (!t.discarded) { reviewedValidCount++; sumHandleMs += t.handleMs ?? 0; }
    const prev = (targetIdx >= 0 ? answered[targetIdx] : {}) as { answer?: string; header?: string };
    const nextAnswer = d.decision === "flip" ? "Yes" : (prev.answer ?? "");
    if (targetIdx >= 0) {
      answered[targetIdx] = {
        ...prev,
        answer: nextAnswer,
        reviewAction: d.decision,
        reviewedBy: d.reviewer,
        reviewedAt: d.decidedAt,
        reviewHandleMs: t.handleMs,
        reviewIdleMs: d.idleMs,
        reviewDiscarded: t.discarded,
      };
      // Per-question counter — reviewer flipped a previously-failed question
      // to pass. Decrement the fail count + bump flippedToPass. Wrapped so
      // a counter write failure doesn't strand the finalize.
      if (d.decision === "flip" && String(prev.answer ?? "").toLowerCase().startsWith("n")) {
        const header = String(prev.header ?? d.header ?? "");
        if (header) {
          incrFlipToPass(orgId, cfgKey, header, findingId, d.decidedAt).catch((err) =>
            console.warn(`[REVIEW] ${findingId}: ⚠️ flipToPass counter incr failed for "${header}":`, err),
          );
        }
      }
    }
    flipDiag.push({
      qIndex: d.questionIndex,
      targetIdx,
      matched,
      decision: String(d.decision ?? ""),
      prevAnswer: String(prev.answer ?? ""),
      finalAnswer: String((answered[targetIdx] as { answer?: string } | undefined)?.answer ?? ""),
    });
    if (matched === "none") {
      console.error(
        `🚨 [REVIEW] ${findingId}: decision for q[${d.questionIndex}] did NOT match any answered question by identity OR index. header="${d.header}" populated="${(d.populated ?? "").slice(0, 80)}". Decision skipped — finalize will use the original answer.`
      );
    } else if (matched === "index") {
      console.warn(
        `⚠️ [REVIEW] ${findingId}: decision for q[${d.questionIndex}] fell back to positional index match (header text not found in current answeredQuestions). Decision applied at idx ${targetIdx}.`
      );
    } else if (targetIdx !== d.questionIndex) {
      console.warn(
        `⚠️ [REVIEW] ${findingId}: decision originally at q[${d.questionIndex}] re-mapped to q[${targetIdx}] by identity match — the question shifted in answeredQuestions since queue-time.`
      );
    }
  }

  // Per-flip drop count. We used to ABORT the entire finalize when ANY
  // flip didn't land — that protected the score but left reviewers
  // stranded forever (Ashley + Josh both got stuck on audits where the
  // finding's answeredQuestions had been re-prepared between when the
  // decision was recorded and when finalize ran, making identity AND
  // positional-index matches both fail).
  //
  // Tradeoff: skip unmatched flips with loud logging and proceed with
  // the matched-only score. The skipped flip "would have" added to the
  // Yes count; not applying it makes the resulting score conservative
  // (closer to the bot's original verdict) rather than wrong-high. Admins
  // can flip individual questions afterwards via /audit/report if needed.
  // Heavy diagnostic stays so we can root-cause the underlying drift.
  let skippedFlips = 0;
  for (const diag of flipDiag) {
    if (diag.decision !== "flip") continue;
    if (String(diag.finalAnswer).toLowerCase().startsWith("y")) continue;
    skippedFlips++;
    console.error(
      `🚨 [REVIEW] ${findingId}: flip for q[${diag.qIndex}] could not be applied — SKIPPED (finalize will proceed). matched=${diag.matched} targetIdx=${diag.targetIdx} prev="${diag.prevAnswer}" final="${diag.finalAnswer}".`
    );
  }
  if (skippedFlips > 0) {
    // Dump answered-array shape + first/last few headers so we can tell
    // at a glance whether the finding lost its answeredQuestions (length
    // collapsed to 0/1) vs a populated-text drift on intact entries.
    const sample = (start: number, end: number) =>
      answered.slice(start, end).map((a, i) => ({
        idx: start + i,
        header: String((a as { header?: string })?.header ?? "").slice(0, 60),
      }));
    console.error(
      `🚨 [REVIEW] ${findingId}: ${skippedFlips}/${flipDiag.length} flip(s) skipped. answered.length=${answered.length} firstHeaders=${JSON.stringify(sample(0, 3))} lastHeaders=${JSON.stringify(sample(Math.max(0, answered.length - 3), answered.length))} unmatchedDecisions=${JSON.stringify(flipDiag.filter((d) => d.matched === "none"))}`
    );
  }
  if (flipDiag.length > 0) {
    console.log(`[REVIEW] ${findingId}: finalize flip-diag answered.length=${answered.length} decisions=${flipDiag.length} skipped=${skippedFlips} details=${JSON.stringify(flipDiag)}`);
  }

  const total = answered.length || 1;
  const yeses = answered.filter((q) => String((q as { answer?: string }).answer ?? "").toLowerCase().startsWith("y")).length;
  const reviewScore = Math.round((yeses / total) * 100);
  const reviewedAt = Date.now();

  const correctedFinding = {
    ...finding,
    answeredQuestions: answered,
    reviewedAt,
    reviewScore,
  };
  await saveFinding(orgId, correctedFinding);
  // Rebuild the failed-finding index now that review actions are stamped — a
  // confirmed "No" attributes to team_member, a flip removes the row. Best-effort.
  writeFailedFindingRows(orgId, correctedFinding as Record<string, any>).catch((err) =>
    console.warn(`[REVIEW] ${findingId}: ⚠️ failed-finding index rebuild failed:`, err));

  await setStored("review-done", orgId, [findingId], { reviewedAt: new Date(reviewedAt).toISOString(), reviewScore, reviewedBy: reviewer });

  // Auto-enqueue confirmed failures into the manager remediation queue. This
  // wiring was dropped in the 2026-05-06 danet refactor, so nothing has landed
  // in the queue automatically since; re-attach it at the finalize point.
  // completedAt = reviewedAt so the queue Timestamp/date-window reflect the
  // audit. Best-effort + idempotent — a queue-write failure must never strand
  // the finalize, and the helper no-ops for a pass-after-review or an item
  // that's already queued. Dynamic import to avoid a review→manager cycle.
  try {
    const { enqueueRemediationForFinding } = await import(
      "@manager/domain/data/manager-repository/mod.ts"
    );
    const res = await enqueueRemediationForFinding(orgId, findingId, { completedAt: reviewedAt });
    if (res.enqueued) console.log(`📋 [REVIEW] ${findingId}: enqueued into manager remediation queue`);
  } catch (err) {
    console.warn(`[REVIEW] ${findingId}: ⚠️ manager-queue enqueue failed (non-fatal):`, err);
  }
  // Defensive sweep: drop any lingering locks for this finding. Per-question
  // locks should already be released by recordDecision, but if a question was
  // committed via a path that bypassed recordDecision (e.g. legacy backfill)
  // we'd leave a stranded lock that blocks future claims.
  await releaseLocksForFinding(orgId, findingId);

  // Drop any lingering review-active rows for this reviewer + finding.
  // claimNextItem's resume-stranded-audit branch (line ~461) hands an audit
  // BACK to a reviewer who still has active rows — fine for legitimate
  // browser-close mid-review, disastrous after a premature finalize where
  // some questions never got decided. Without this cleanup the reviewer
  // keeps getting served the same finalized audit on every /review visit
  // and every subsequent finalize correctly errors with "already finalized,
  // skipping" — exactly Ashley's report on h01QKxPfGbBYCjwB_P7Xm.
  //
  // Scoped to (reviewer, findingId) via key-prefix: review-active key shape
  // is [reviewer, findingId, questionIndex], so the prefix is well-defined
  // and the scan is constant-time per audit instead of org-wide.
  try {
    const activeForReviewerFinding = await listStoredByKeyPrefix<ReviewItem>(
      "review-active", orgId, reviewer, findingId,
    );
    await Promise.all(
      activeForReviewerFinding.map(({ key }) =>
        deleteStored("review-active", orgId, ...key).catch((e) => {
          console.warn(`[REVIEW] ${findingId}: failed to drain review-active ${JSON.stringify(key)}:`, e);
        })
      ),
    );
  } catch (e) {
    // Best-effort — finalize has already done the durable work above. A
    // lingering active row just means a redundant stranded-resume hand-
    // back which the idempotency guard will block as "already finalized".
    console.warn(`[REVIEW] ${findingId}: review-active sweep failed (non-fatal):`, e);
  }

  // One index row per finding: keyed at reviewedAt (so reviewer-throughput
  // still buckets the review in its week), and the original audit-time row is
  // point-deleted — that stale row is what double-counted reviewed findings in
  // audit-history / reports / reviewer stats.
  await writeSoleAuditDoneIndex(orgId, correctedFinding, {
    findingId,
    doneAt: reviewedAt,
    completed: true,
    reason: "reviewed",
    score: reviewScore,
    // buildIndexMeta keys recordId on the QB RecordId — what "Find by QB
    // Record" searches. (Previously fell through to RelatedDestinationId/
    // GenieNumber, keying review-completed findings under the wrong id.)
    ...buildIndexMeta(correctedFinding),
    reviewedBy: reviewer,
    reviewHandleMs: reviewedValidCount > 0 ? sumHandleMs : undefined,
    reviewedQuestionCount,
    reviewedValidCount,
  });

  await updateCompletedStatScore(orgId, findingId, reviewScore);

  // Keep the chargeback (date-leg) / wire (package) "payroll" entry in sync with
  // the REVIEWED score. The bot wrote it at the PRE-review score, so a flip to a
  // passing / fewer-fails result would otherwise leave a stale FAILING entry on
  // the chargeback sheet for an audit that now passes — the "failed VOs are
  // incorrect" report bug (prod record 483830). See syncChargebackWireToScore.
  await syncChargebackWireToScore(orgId, findingId, correctedFinding, reviewScore);

  // Drain review-decided for this finding. Without this, getReviewStats
  // counts every decision since the table was created as "decided
  // in-flight" — the Review Dashboard's Decided/Total Processed/Decision
  // Rate stays inflated and never reflects the finalize work. Best-effort
  // per-question delete; score is already saved so a failed cleanup
  // doesn't justify aborting the finalize. Parallelized — a 10-question
  // audit previously did 10 serial round-trips here.
  const drainResults = await Promise.all(
    [...decisions.keys()].map(async (qIndex) => {
      try {
        await deleteStored("review-decided", orgId, findingId, qIndex);
        return true;
      } catch (e) {
        console.warn(`[REVIEW] ${findingId}/${qIndex}: failed to drain review-decided:`, e);
        return false;
      }
    }),
  );
  const drained = drainResults.filter(Boolean).length;
  console.log(`[REVIEW] ${findingId}: drained ${drained}/${decisions.size} review-decided rows`);

  console.log(`✅ [REVIEW] ${findingId}: finalized score=${reviewScore}% (${yeses}/${total} yes) reviewer=${reviewer}`);

  // Fire the terminate webhook async — don't block the reviewer's response
  // on an external HTTP round-trip. The reviewer's work is durable
  // (review-done is saved, audit-done-idx is written, drain is complete)
  // before this point, so a webhook failure is recoverable via retry but
  // shouldn't slow down the UI. Failures are logged loud so they're
  // findable in production logs.
  void fireWebhook(orgId, "terminate", {
    findingId,
    finding: correctedFinding,
    correctedAnswers: answered,
    reviewedAt,
    reviewedBy: reviewer,
    reviewScore,
  }).catch((err) => {
    console.error(`❌ [REVIEW] ${findingId}: terminate webhook failed (deferred):`, err);
  });

  // Reviewer gamification — fire-and-forget. Lane handles its own errors
  // and Firestore I/O via runInBackgroundLane so this never blocks the
  // reviewer's response. questionsReviewed = decisions evaluated this
  // finalize, used as a per-question XP multiplier.
  void import("@gamification/domain/business/gamification-lane/mod.ts")
    .then(({ awardForCompletion }) =>
      awardForCompletion({
        orgId, email: reviewer, role: "reviewer",
        questionsReviewed: decisions.size,
      })
    )
    .catch((err) => console.error(`[REVIEW] ${findingId}: gamification lane import failed:`, err));

  return { ok: true, score: reviewScore, ...(skippedFlips > 0 ? { skippedFlips } : {}) };
}

// ── Undo Decision ───────────────────────────────────────────────────────────

export async function undoDecision(
  orgId: OrgId,
  reviewer: string,
  allowedTypes?: string[],
): Promise<{ buffer: BufferItem[]; remaining: number }> {
  // Determine current audit findingId from active items
  const myActive = await listStoredWithKeys<ReviewItem & { claimedAt: number }>("review-active", orgId);
  let currentFindingId: string | null = null;
  for (const { key, value } of myActive) {
    if (key[0] === reviewer) { currentFindingId = value.findingId; break; }
  }

  // Walk undo index newest-first looking for an eligible decided entry
  const undoRows = await listStoredWithKeys<{ findingId: string; questionIndex: number }>("review-undo-idx", orgId);
  const myUndo = undoRows.filter(({ key }) => key[0] === reviewer)
    // Keys in this index are reverse-chronological strings; sort ascending → newest first
    .sort((a, b) => String(a.key[1]).localeCompare(String(b.key[1])));

  let chosenDecided: { key: string[]; value: ReviewDecision } | null = null;
  let chosenUndoIdx: string[] | null = null;
  for (const { key, value } of myUndo.slice(0, 20)) {
    const { findingId: fid, questionIndex: qIdx } = value;
    if (currentFindingId && fid !== currentFindingId) continue;
    const counterCheck = await getStored<number>("review-audit-pending", orgId, fid);
    if (counterCheck === null) continue;
    const candidate = await getStored<ReviewDecision>("review-decided", orgId, fid, qIdx);
    if (!candidate || candidate.reviewer !== reviewer) continue;
    chosenDecided = { key: [fid, String(qIdx)], value: candidate };
    chosenUndoIdx = key;
    break;
  }

  // Fallback: full scan scoped to current finding
  if (!chosenDecided) {
    const decidedRows = await listStoredWithKeys<ReviewDecision>("review-decided", orgId);
    const myDecisions = decidedRows.filter(({ value }) =>
      value.reviewer === reviewer && (!currentFindingId || value.findingId === currentFindingId)
    );
    myDecisions.sort((a, b) => b.value.decidedAt - a.value.decidedAt);
    for (const candidate of myDecisions) {
      const counterCheck = await getStored<number>("review-audit-pending", orgId, candidate.value.findingId);
      if (counterCheck !== null) {
        chosenDecided = { key: candidate.key, value: candidate.value };
        break;
      }
    }
  }

  if (!chosenDecided) return { buffer: [], remaining: 0 };

  const decided = chosenDecided.value;
  const { findingId, questionIndex } = decided;
  let item: ReviewItem = {
    findingId: decided.findingId,
    questionIndex: decided.questionIndex,
    reviewIndex: decided.reviewIndex ?? 1,
    totalForFinding: decided.totalForFinding ?? 1,
    header: decided.header ?? "",
    populated: decided.populated ?? "",
    thinking: decided.thinking ?? "",
    defense: decided.defense ?? "",
    answer: decided.answer ?? "No",
    ...(decided.recordingIdField ? { recordingIdField: decided.recordingIdField } : {}),
    ...(decided.recordId ? { recordId: decided.recordId } : {}),
    ...(decided.recordMeta ? { recordMeta: decided.recordMeta } : {}),
    ...(decided.completedAt != null ? { completedAt: decided.completedAt } : {}),
  };

  // Safety net: if the decided record was saved with empty question/meta
  // fields (stale active buffer or race), re-derive from the finding so the
  // panel re-renders with full data. Shared with the resume-stranded path.
  item = await rehydrateItemFromFinding(orgId, item);

  const counterVal = (await getStored<number>("review-audit-pending", orgId, findingId)) ?? 0;
  await deleteStored("review-decided", orgId, ...chosenDecided.key);
  await setStored("review-active", orgId, [reviewer, findingId, questionIndex], { ...item, claimedAt: Date.now() });
  await setStored("review-audit-pending", orgId, [findingId], counterVal + 1);
  if (chosenUndoIdx) await deleteStored("review-undo-idx", orgId, ...chosenUndoIdx);

  return claimNextItem(orgId, reviewer, allowedTypes);
}

// ── Discard Review (release stranded audit) ─────────────────────────────────

/** Release this reviewer's claim on `findingId` and roll back any decisions
 *  they recorded — the audit goes back into review-pending so somebody else
 *  (or the same reviewer next time) can pick it up. Used when the finalize
 *  modal's "Discard This Audit" action fires. */
export async function discardReview(
  orgId: OrgId,
  reviewer: string,
  findingId: string,
): Promise<{ ok: true; restored: number }> {
  let restored = 0;

  // 1. Move any active claims this reviewer has on this finding back to pending.
  const active = await listStoredWithKeys<ReviewItem & { claimedAt: number }>("review-active", orgId);
  for (const { key, value } of active) {
    if (key[0] !== reviewer || value.findingId !== findingId) continue;
    const { claimedAt: _, ...baseItem } = value;
    await setStored("review-pending", orgId, [findingId, value.questionIndex], baseItem as ReviewItem);
    await deleteStored("review-active", orgId, ...key);
    restored++;
  }

  // 2. Move decisions back to pending so the audit isn't stuck "all decided
  //    but never finalized". Restore the audit-pending counter.
  const decided = await listStoredWithKeys<ReviewDecision>("review-decided", orgId);
  for (const { key, value } of decided) {
    if (key[0] !== findingId) continue;
    if (value.reviewer && value.reviewer !== reviewer) continue;
    const item: ReviewItem = {
      findingId: value.findingId,
      questionIndex: value.questionIndex,
      reviewIndex: value.reviewIndex ?? 1,
      totalForFinding: value.totalForFinding ?? 1,
      header: value.header ?? "",
      populated: value.populated ?? "",
      thinking: value.thinking ?? "",
      defense: value.defense ?? "",
      answer: value.answer ?? "No",
      ...(value.recordingIdField ? { recordingIdField: value.recordingIdField } : {}),
      ...(value.recordId ? { recordId: value.recordId } : {}),
      ...(value.recordMeta ? { recordMeta: value.recordMeta } : {}),
      ...(value.completedAt != null ? { completedAt: value.completedAt } : {}),
    };
    await setStored("review-pending", orgId, [findingId, value.questionIndex], item);
    await deleteStored("review-decided", orgId, ...key);
    restored++;
  }

  // 3. Refresh the audit-pending counter to match what's now in review-pending.
  const pendingForFinding = await listStoredWithKeys<ReviewItem>("review-pending", orgId);
  const newCount = pendingForFinding.filter(({ key }) => key[0] === findingId).length;
  if (newCount > 0) {
    await setStored("review-audit-pending", orgId, [findingId], newCount);
  } else {
    // No pending items remain — leave the counter alone (could be admin-flipped or already finalized).
  }

  // 4. Drop any undo-index entries this reviewer had for the finding so the
  //    next undo doesn't surface a stale ghost decision.
  const undo = await listStoredWithKeys<{ findingId: string; questionIndex: number }>("review-undo-idx", orgId);
  for (const { key, value } of undo) {
    if (key[0] !== reviewer) continue;
    if (value.findingId !== findingId) continue;
    await deleteStored("review-undo-idx", orgId, ...key);
  }

  // 5. Release every lock this reviewer was holding on the finding so the next
  //    claimNextItem can hand the audit to whoever picks it up next.
  await releaseLocksForFinding(orgId, findingId);

  console.log(`[REVIEW] ${reviewer}: Discarded audit ${findingId} (${restored} entries restored to pending)`);
  return { ok: true, restored };
}

// ── Admin-flip finding — set all "No" answers to "Yes" ──────────────────────

export async function adminFlipFinding(
  orgId: OrgId,
  findingId: string,
  flippedBy: string = "admin",
): Promise<{ success: boolean; score: number }> {
  const finding = await getFinding(orgId, findingId);
  if (!finding) return { success: false, score: 0 };

  // PREFER finding.answeredQuestions over batch-answers. batch-answers
  // is the raw output of the original step-ask-batch LLM run and is
  // NEVER updated when reviewer-queue finalize flips an answer; reading
  // from it first would silently revert every prior review flip the
  // moment we save. (MJ's duHcim5XQTTcXCXfeGWSM 2026-05-15: clicked
  // pencil on days/nights, citizenship reverted to "No" because the
  // reviewer's earlier flip on citizenship lived only in
  // finding.answeredQuestions and got overwritten by batch-answers.)
  // Falls back to batch-answers only if the finding doc lacks the
  // array entirely (legacy / corrupted state).
  const fromFinding = Array.isArray(finding.answeredQuestions) ? finding.answeredQuestions : [];
  const answers = fromFinding.length > 0 ? fromFinding : await getAllAnswersForFinding(orgId, findingId);
  // Stamp `reviewedBy` AND `reviewAction` on every flipped question.
  // Previously only `reviewAction: "admin-flip"` was set, which left the
  // judge view with no reviewer name to display when agents later appealed
  // bulk-flipped audits — see judge enrich's fallback path.
  const flippedAt = Date.now();
  const flippedHeaders: string[] = [];
  const corrected = answers.map((a: any) => {
    if (a.answer === "No") {
      if (a.header) flippedHeaders.push(String(a.header));
      return { ...a, answer: "Yes", reviewAction: "admin-flip", reviewedBy: flippedBy, reviewedAt: flippedAt };
    }
    return a;
  });
  const score = 100;
  // Per-question counters — every No→Yes in a bulk flip counts as a
  // flippedToPass. Fire-and-forget so a counter write failure can't strand
  // the admin action.
  const cfgKeyBulk = configKeyForFinding(finding as Record<string, any>);
  for (const header of flippedHeaders) {
    incrFlipToPass(orgId, cfgKeyBulk, header, findingId, flippedAt).catch((err) =>
      console.warn(`[ADMIN-FLIP] ${findingId}: ⚠️ flipToPass counter incr failed for "${header}":`, err),
    );
  }

  finding.answeredQuestions = corrected;
  (finding as Record<string, unknown>).reviewedAt = new Date().toISOString();
  (finding as Record<string, unknown>).reviewScore = score;
  // Mark the finding so terminate-webhook emails are suppressed. Bulk-flip
  // is an admin cleanup action — the customer should not get an
  // "audit reviewed" email when an admin retroactively flips an old
  // unreviewed audit to 100%. n8n / Firestore-watching external systems
  // pick up the reviewedAt change and POST to /webhooks/audit-complete;
  // this flag rides on the finding doc so sendAuditCompleteEmail can
  // refuse to send. Contract locked in webhook-handlers/test.ts.
  (finding as Record<string, unknown>).noWebhook = true;
  await saveFinding(orgId, finding);
  // Bulk flip clears every "No", so this rebuild removes the finding's failure
  // rows. Best-effort.
  writeFailedFindingRows(orgId, finding as Record<string, any>).catch((err) =>
    console.warn(`[ADMIN-FLIP] ${findingId}: ⚠️ failed-finding index rebuild failed:`, err));
  await saveBatchAnswers(orgId, findingId, 0, corrected);

  // Clean up review queue entries for this finding
  let cleared = 0;
  const pending = await listStoredWithKeys("review-pending", orgId);
  for (const { key } of pending) {
    if (key[0] === findingId) { await deleteStored("review-pending", orgId, ...key); cleared++; }
  }
  const decided = await listStoredWithKeys("review-decided", orgId);
  for (const { key } of decided) {
    if (key[0] === findingId) { await deleteStored("review-decided", orgId, ...key); cleared++; }
  }
  const active = await listStoredWithKeys<{ findingId?: string }>("review-active", orgId);
  for (const { key, value } of active) {
    if (value?.findingId === findingId) { await deleteStored("review-active", orgId, ...key); cleared++; }
  }
  await deleteStored("review-audit-pending", orgId, findingId); cleared++;
  await releaseLocksForFinding(orgId, findingId);

  await setStored("review-done", orgId, [findingId], {
    reviewedAt: new Date().toISOString(),
    reviewScore: score,
    reviewedBy: flippedBy,
  });

  try {
    await writeSoleAuditDoneIndex(orgId, finding, {
      findingId,
      score,
      completed: true,
      doneAt: Date.now(),
      reason: "reviewed",
      ...buildIndexMeta(finding),
      reviewedBy: flippedBy,
    });
  } catch { /* index write is best-effort */ }
  await updateCompletedStatScore(orgId, findingId, score);

  await deleteChargebackEntry(orgId, findingId).catch(() => {});
  await deleteWireDeductionEntry(orgId, findingId).catch(() => {});

  console.log(`[ADMIN-FLIP] ✅ ${findingId} → 100% (${cleared} queue entries removed)`);
  return { success: true, score };
}

// ── Finalize an already-perfect finding (no flip, just queue cleanup) ───────
//
// Drift cleanup helper. When a reviewer pencil-flips questions one-by-one via
// adminFlipQuestion and the running score reaches 100, the answeredQuestions
// + reviewScore are correct on the finding but the review-pending /
// review-active / review-decided entries are NOT drained — adminFlipQuestion
// updates the finding but never touches the queue. So the dashboard keeps
// counting those audits as "Pending" forever even though their score is 100.
//
// This finalizes WITHOUT mutating answers or score: drain queue entries,
// write review-done, refresh audit-done-idx + completed-audit-stat. Caller
// is responsible for verifying the finding's liveScore is actually 100
// before calling — we don't recompute here because callers already have it.
export async function finalizePerfectFinding(
  orgId: OrgId,
  findingId: string,
  reviewer: string,
): Promise<{ cleared: number; alreadyFinalized?: boolean }> {
  // Idempotency — if review-done already exists, nothing to do.
  const existingDone = await getStored<{ reviewedAt?: string }>("review-done", orgId, findingId);
  if (existingDone) {
    return { cleared: 0, alreadyFinalized: true };
  }

  const finding = await getFinding(orgId, findingId);
  if (!finding) return { cleared: 0 };

  let cleared = 0;
  const pending = await listStoredWithKeys("review-pending", orgId);
  for (const { key } of pending) {
    if (key[0] === findingId) { await deleteStored("review-pending", orgId, ...key); cleared++; }
  }
  const decided = await listStoredWithKeys("review-decided", orgId);
  for (const { key } of decided) {
    if (key[0] === findingId) { await deleteStored("review-decided", orgId, ...key); cleared++; }
  }
  const active = await listStoredWithKeys<{ findingId?: string }>("review-active", orgId);
  for (const { key, value } of active) {
    if (value?.findingId === findingId) { await deleteStored("review-active", orgId, ...key); cleared++; }
  }
  await deleteStored("review-audit-pending", orgId, findingId); cleared++;
  await releaseLocksForFinding(orgId, findingId);

  const reviewedAt = new Date().toISOString();
  const reviewScore = typeof (finding as any).reviewScore === "number" ? (finding as any).reviewScore : 100;
  await setStored("review-done", orgId, [findingId], { reviewedAt, reviewScore, reviewedBy: reviewer });

  try {
    await writeSoleAuditDoneIndex(orgId, finding, {
      findingId,
      score: reviewScore,
      completed: true,
      doneAt: Date.now(),
      reason: "reviewed",
      ...buildIndexMeta(finding),
      reviewedBy: reviewer,
    });
  } catch { /* index write is best-effort */ }
  await updateCompletedStatScore(orgId, findingId, reviewScore);

  console.log(`[FINALIZE-PERFECT] ✅ ${findingId} → finalized at ${reviewScore}% (${cleared} queue entries removed)`);
  return { cleared };
}

/** Drain every review-store row for a finding: pending, decided, active,
 *  audit-pending counter, locks, and the review-done sentinel. Used by retry
 *  paths and the orphan sweep — anywhere we need to wipe review state because
 *  the upstream finding is being re-prepared from scratch. */
export async function drainReviewStoresForFinding(orgId: OrgId, findingId: string): Promise<number> {
  let cleared = 0;
  const pending = await listStoredWithKeys("review-pending", orgId);
  for (const { key } of pending) {
    if (key[0] === findingId) { await deleteStored("review-pending", orgId, ...key); cleared++; }
  }
  const decided = await listStoredWithKeys("review-decided", orgId);
  for (const { key } of decided) {
    if (key[0] === findingId) { await deleteStored("review-decided", orgId, ...key); cleared++; }
  }
  const active = await listStoredWithKeys<{ findingId?: string }>("review-active", orgId);
  for (const { key, value } of active) {
    if (value?.findingId === findingId) { await deleteStored("review-active", orgId, ...key); cleared++; }
  }
  await deleteStored("review-audit-pending", orgId, findingId); cleared++;
  await deleteStored("review-done", orgId, findingId); cleared++;
  await releaseLocksForFinding(orgId, findingId);
  return cleared;
}

/** Wipe every derived/cached/index store for a finding so the next pipeline
 *  pass starts from a clean slate. Used by retry-finding + reset-finding
 *  before re-publishing the prepare step. Does NOT touch audit-finding /
 *  audit-transcript / audit-job — those are the inputs the re-run rebuilds
 *  *from*. Idempotent. */
export async function resetFindingDerivedState(
  orgId: OrgId,
  findingId: string,
): Promise<{ reviewCleared: number; doneIdxRemoved: number }> {
  const reviewCleared = await drainReviewStoresForFinding(orgId, findingId);
  const doneIdxRemoved = await deleteAuditDoneIdxByFindingId(orgId, findingId);
  await deleteCompletedStat(orgId, findingId);
  await deleteChargebackEntry(orgId, findingId).catch(() => {});
  await deleteWireDeductionEntry(orgId, findingId).catch(() => {});
  console.log(`🧹 [RESET-DERIVED] ${findingId}: review=${reviewCleared} done-idx=${doneIdxRemoved} completed-stat+chargeback+wire cleared`);
  return { reviewCleared, doneIdxRemoved };
}

// Sweep all currently-pending findings whose live score is already 100 and
// finalize them. One-shot reconciliation for the drift caused by pencil-
// flips reaching 100 without auto-finalize.
export async function reconcilePerfectPending(
  orgId: OrgId,
  reviewer: string,
): Promise<{ scanned: number; swept: number; alreadyFinalized: number; notPerfect: number; missing: number }> {
  const pending = await getPendingReviewFindings(orgId);
  let swept = 0, alreadyFinalized = 0, notPerfect = 0, missing = 0;
  for (const fid of pending.keys()) {
    const finding = await getFinding(orgId, fid);
    if (!finding) { missing++; continue; }
    // Compute live score the same way the admin /unreviewed-audits endpoint
    // does — reviewScore preferred, else derived from answeredQuestions.
    let liveScore: number;
    if (typeof (finding as any).reviewScore === "number") {
      liveScore = (finding as any).reviewScore;
    } else {
      const answered = (finding as any).answeredQuestions as Array<{ answer?: string }> | undefined;
      if (Array.isArray(answered) && answered.length > 0) {
        const yeses = answered.filter((q) =>
          String(q?.answer ?? "").trim().toLowerCase().startsWith("y")
        ).length;
        liveScore = Math.round((yeses / answered.length) * 100);
      } else {
        liveScore = 0;
      }
    }
    if (liveScore !== 100) { notPerfect++; continue; }
    const r = await finalizePerfectFinding(orgId, fid, reviewer);
    if (r.alreadyFinalized) alreadyFinalized++;
    else swept++;
  }
  console.log(`[RECONCILE-PERFECT] scanned=${pending.size} swept=${swept} alreadyFinalized=${alreadyFinalized} notPerfect=${notPerfect} missing=${missing}`);
  return { scanned: pending.size, swept, alreadyFinalized, notPerfect, missing };
}

/** The handful of finding fields the chargeback/wire sync reads. The `record`
 *  payload is an external CRM blob with hundreds of fields, so we model only
 *  what's used (incl. the QB raw ids "314" = destination, "706" = revenue). */
type SyncRecord = {
  RecordId?: unknown;
  GuestName?: unknown;
  DestinationDisplay?: unknown;
  "314"?: unknown;
  "706"?: unknown;
};
type SyncFinding = {
  record?: SyncRecord;
  answeredQuestions?: Array<{ answer?: unknown; header?: unknown; egregious?: unknown }>;
  completedAt?: number;
};

/** Resync the chargeback (date-leg) / wire (package) "payroll" entry to a
 *  finding's CURRENT answers after a human flip (reviewer finalize or admin
 *  pencil-flip). Without it the entry keeps the bot's PRE-flip grade and a
 *  now-passing audit lingers on the chargeback sheet (prod bug record 483830).
 *  A chargeable fail is an explicit "No" header — matching step-finalize, so
 *  N/A / Error / blank answers never count — and the caller's `score` is the
 *  authority for pass/fail, so the fail set and the score can't disagree. The
 *  entry ts stays the original completedAt so the deduction lands in the same
 *  pay period. Best-effort; a sync failure leaves a stale row the next backfill
 *  repairs. */
async function syncChargebackWireToScore(
  orgId: OrgId,
  findingId: string,
  finding: SyncFinding,
  score: number,
): Promise<void> {
  try {
    const rec = finding.record ?? {};
    const meta = buildIndexMeta(finding);
    const ts = typeof finding.completedAt === "number" ? finding.completedAt : Date.now();
    const answers = Array.isArray(finding.answeredQuestions) ? finding.answeredQuestions : [];
    const failedQs = answers
      .map((a) => ({ header: String(a.header ?? ""), egregious: !!a.egregious, answer: String(a.answer ?? "") }))
      .filter((q) => q.answer === "No" && q.header);
    // `score` (from the same grader that finalized) is authoritative; an empty
    // "No" set is the same condition seen from the answers. Either ⇒ no charge.
    const passing = score >= 100 || failedQs.length === 0;

    if (meta.isPackage) {
      // Partner finding → wire deduction. Delete when passing, SYMMETRIC with the
      // chargeback leg, rather than leaving a hidden 100% row for the report's
      // score<100 read filter to hide — so a filter change can't resurface it.
      if (passing) {
        await deleteWireDeductionEntry(orgId, findingId).catch(() => {});
      } else {
        await saveWireDeductionEntry(orgId, {
          findingId,
          ts,
          score,
          questionsAudited: answers.length,
          totalSuccess: answers.filter((a) => String(a.answer ?? "") === "Yes").length,
          recordId: String(rec.RecordId ?? ""),
          office: meta.department ?? "",
          excellenceAuditor: meta.voName ?? "",
          guestName: String(rec.GuestName ?? ""),
        });
      }
    } else if (passing) {
      // Internal date-leg, every fail cleared → drop any stale entry.
      await deleteChargebackEntry(orgId, findingId).catch(() => {});
    } else {
      await saveChargebackEntry(orgId, {
        findingId,
        ts,
        voName: meta.voName ?? "",
        destination: String(rec.DestinationDisplay ?? rec["314"] ?? ""),
        revenue: String(rec["706"] ?? ""),
        recordId: String(rec.RecordId ?? ""),
        score,
        failedQHeaders: failedQs.map((q) => q.header),
        egregiousHeaders: failedQs.filter((q) => q.egregious).map((q) => q.header),
        omissionHeaders: failedQs.filter((q) => !q.egregious).map((q) => q.header),
      });
    }
    console.log(`[CHARGEBACK-SYNC] ${findingId}: 💰 ${passing ? "cleared" : "rewrote"} entry at score=${score}%`);
  } catch (err) {
    console.error(`[CHARGEBACK-SYNC] ${findingId}: ⚠️ sync failed (sheet may show a stale fail until backfill):`, err);
  }
}

// ── Admin-flip single question — toggle one Yes↔No on a finding ─────────────

export async function adminFlipQuestion(
  orgId: OrgId,
  findingId: string,
  questionIndex: number,
  flippedBy: string = "admin",
): Promise<{ success: boolean; score: number; answer?: string }> {
  const finding = await getFinding(orgId, findingId);
  if (!finding) return { success: false, score: 0 };
  // Same read-preference fix as adminFlipFinding — finding.answeredQuestions
  // is the live source of truth post-review; batch-answers is stale.
  // See the long comment in adminFlipFinding for the incident this prevents.
  const fromFinding = Array.isArray(finding.answeredQuestions) ? finding.answeredQuestions : [];
  const answers = fromFinding.length > 0 ? fromFinding : await getAllAnswersForFinding(orgId, findingId);
  if (questionIndex < 0 || questionIndex >= answers.length) return { success: false, score: 0 };

  const current = String((answers[questionIndex] as any).answer ?? "").trim().toLowerCase();
  const wasYes = current.startsWith("yes") || current === "true" || current === "y" || current === "1";
  const flippedAt = Date.now();
  const flipped = answers.map((a: any, i: number) =>
    i === questionIndex
      ? { ...a, answer: wasYes ? "No" : "Yes", reviewAction: "admin-flip", reviewedBy: flippedBy, reviewedAt: flippedAt }
      : a,
  );
  // Per-question counter — single-question pencil flip. Yes→No bumps the
  // failed count + flippedToFail; No→Yes decrements failed + bumps
  // flippedToPass. Header is read off the in-memory question. Fire-and-
  // forget; counter write failure doesn't block the flip.
  const flipHeader = String((answers[questionIndex] as any).header ?? "");
  if (flipHeader) {
    const cfgKeyQ = configKeyForFinding(finding as Record<string, any>);
    const fn = wasYes ? incrFlipToFail : incrFlipToPass;
    fn(orgId, cfgKeyQ, flipHeader, findingId, flippedAt).catch((err) =>
      console.warn(`[ADMIN-FLIP-Q] ${findingId}: ⚠️ flip counter incr failed for "${flipHeader}":`, err),
    );
  }
  const yesCount = flipped.filter((a: any) =>
    String(a.answer ?? "").trim().toLowerCase().startsWith("yes"),
  ).length;
  const score = flipped.length > 0 ? Math.round((yesCount / flipped.length) * 100) : 0;

  finding.answeredQuestions = flipped;
  (finding as Record<string, unknown>).reviewedAt = new Date().toISOString();
  (finding as Record<string, unknown>).reviewScore = score;
  await saveFinding(orgId, finding);
  // Single-question pencil flip: rebuild this finding's failure rows (Yes->No
  // adds an autobot-attributed row, No->Yes removes one). Best-effort.
  writeFailedFindingRows(orgId, finding as Record<string, any>).catch((err) =>
    console.warn(`[ADMIN-FLIP-Q] ${findingId}: ⚠️ failed-finding index rebuild failed:`, err));
  await saveBatchAnswers(orgId, findingId, 0, flipped);
  await updateCompletedStatScore(orgId, findingId, score);

  // Keep the chargeback/wire "payroll" entry in sync with the flipped result —
  // a No→Yes pencil-flip that clears the last fail must drop the chargeback
  // entry; a Yes→No flip that creates a fail must add one. Same staleness bug as
  // the reviewer path. score reflects the post-flip answers above.
  await syncChargebackWireToScore(orgId, findingId, finding as SyncFinding, score);

  // Keep audit-done-idx in sync with the live finding. Without this write,
  // /admin/unreviewed-audits + audit-history queries kept showing the pre-flip
  // score forever — user-visible bug: bulk-flip listed 18 audits as 80-90%
  // when the report rendered 100%. Mirrors adminFlipFinding's pattern above.
  // Only marks "completed: true" when score reaches 100, otherwise leaves the
  // entry as a non-perfect index row (still surfaceable in unreviewed lists
  // until either reviewer-finalize or admin-bulk-flip lifts it to 100).
  try {
    await writeSoleAuditDoneIndex(orgId, finding, {
      findingId,
      score,
      completed: score === 100,
      ...(score === 100 ? { doneAt: Date.now(), reason: "reviewed" as const } : {}),
      ...buildIndexMeta(finding),
      reviewedBy: flippedBy,
    });
  } catch (err) {
    console.warn(`⚠️ [ADMIN-FLIP-Q] ${findingId} writeAuditDoneIndex failed (best-effort):`, err);
  }

  console.log(`[ADMIN-FLIP-Q] ${findingId} q[${questionIndex}] ${wasYes ? "Yes→No" : "No→Yes"} → score=${score}%`);

  // Auto-finalize at 100. Without this the finding sits in review-pending /
  // review-active forever — pencil-flips don't drain queue state, only the
  // explicit finalize click does. That was the cause of the "57 pending at
  // 100%" drift the operator caught.
  if (score === 100) {
    try {
      // Pass the admin's email through so review-done.reviewedBy is a real
      // identifier instead of the legacy sentinel "admin-flip-q".
      await finalizePerfectFinding(orgId, findingId, flippedBy);
    } catch (err) {
      console.warn(`⚠️ [ADMIN-FLIP-Q] ${findingId} auto-finalize at 100% failed (best-effort):`, err);
    }
  }

  return { success: true, score, answer: wasYes ? "No" : "Yes" };
}

// ── Preview finding ─────────────────────────────────────────────────────────

export async function previewFinding(orgId: OrgId, findingId: string): Promise<BufferItem[] | null> {
  const finding = await getFinding(orgId, findingId);
  if (!finding || !finding.answeredQuestions?.length) return null;
  const transcript = await getTranscript(orgId, findingId);
  const items: BufferItem[] = finding.answeredQuestions.map((q: any, i: number) => ({
    findingId,
    questionIndex: i,
    reviewIndex: i + 1,
    totalForFinding: finding.answeredQuestions!.length,
    header: q.header ?? "",
    populated: q.populated ?? "",
    thinking: q.thinking ?? "",
    defense: q.defense ?? "",
    answer: q.answer ?? "No",
    recordingIdField: (finding.record as any)?.GenieNumber != null ? "GenieNumber" : undefined,
    recordId: String((finding.record as any)?.RecordId ?? ""),
    auditRemaining: 0,
    transcript,
  }));
  return items;
}

// ── Full failed-questions buffer + decisions for a finding ─────────────────
// Used by /review/api/decide and /review/api/next so the UI can render the
// full failed-questions list with status dots that don't shrink as decisions
// are made.

export async function getFailedQuestionsForFinding(orgId: OrgId, findingId: string): Promise<BufferItem[]> {
  const finding = await getFinding(orgId, findingId);
  if (!finding || !finding.answeredQuestions?.length) return [];
  const transcript = await getTranscript(orgId, findingId);
  // Match populateReviewQueue's phantom filter (empty header AND empty
  // populated). Without this, jump-to-question can target a phantom No-
  // answered slot whose decision would land in review-decided with empty
  // header — finalize's identity match then has nothing to work with and
  // the audit gets stuck. populateReviewQueue already drops these for the
  // initial claim flow; we add it here so the pill list is consistent.
  const noAnswers = (finding.answeredQuestions as any[])
    .map((q: any, i: number) => ({ ...q, index: i }))
    .filter((q: any) => q.answer === "No")
    .filter((q: any) => {
      const hasHeader = String(q.header ?? "").trim().length > 0;
      const hasPopulated = String(q.populated ?? "").trim().length > 0;
      return hasHeader || hasPopulated;
    });
  const recRaw = (finding.record ?? {}) as Record<string, unknown>;
  const recordingIdField = recRaw.GenieNumber != null ? "GenieNumber" : undefined;
  const recordId = String(recRaw.RecordId ?? recRaw.RelatedDestinationId ?? recRaw.GenieNumber ?? "");
  return noAnswers.map((q, idx) => ({
    findingId,
    questionIndex: q.index,
    reviewIndex: idx + 1,
    totalForFinding: noAnswers.length,
    header: q.header ?? "",
    populated: q.populated ?? "",
    thinking: q.thinking ?? "",
    defense: q.defense ?? "",
    answer: q.answer ?? "No",
    recordingIdField,
    recordId,
    auditRemaining: 0,
    transcript,
  }));
}

export async function getDecisionsByFinding(
  orgId: OrgId,
  findingId: string,
  reviewer?: string,
): Promise<Record<string, "confirm" | "flip">> {
  // When `reviewer` is provided, return only that reviewer's decisions.
  // The finalize modal counts "X confirmed / Y flipped" come from this map;
  // without the filter, a stale decision left over from a prior reviewer
  // shows up in the new reviewer's count (Ashley saw "3 flipped" after
  // making 1 decision because Josh's earlier decisions on the same audit
  // were still in review-decided). The abandon-on-lock-expiry path also
  // wipes those rows, but reviewer filtering is defense-in-depth.
  //
  // Scoped to this finding via key-prefix scan (doc IDs encode
  // `review-decided__<org>__<findingId>__<qIndex>`) — every reviewer
  // action fires this helper, so the org-wide scan it used to do was a
  // dominant cost on busy queues.
  const all = await listStoredByKeyPrefix<ReviewDecision>("review-decided", orgId, findingId);
  const out: Record<string, "confirm" | "flip"> = {};
  for (const { value } of all) {
    if (reviewer && value?.reviewer !== reviewer) continue;
    if (value?.questionIndex != null && (value.decision === "confirm" || value.decision === "flip")) {
      out[String(value.questionIndex)] = value.decision;
    }
  }
  return out;
}

// ── Jump to a specific question within an already-claimed audit ─────────────
// Restores the prod-parity ability to click between failed questions on the
// review queue side panel. Pre-refactor reviewers could revisit a decided
// question and flip their answer; this wires that behavior back up.
//
// Restores a review-active row for the target question (so recordDecision
// finds the full ReviewItem and writes a useful review-decided record) and
// returns the buffer/fullBuffer/decisions shape the queue fragment expects.
// Idempotent: a no-op when the row already exists.

export async function jumpToQuestion(
  orgId: OrgId,
  reviewer: string,
  findingId: string,
  questionIndex: number,
): Promise<{
  buffer: BufferItem[];
  remaining: number;
  fullBuffer: BufferItem[];
  decisions: Record<string, "confirm" | "flip">;
} | { error: string }> {
  const fullBuffer = await getFailedQuestionsForFinding(orgId, findingId);
  const baseTarget = fullBuffer.find((b) => b.questionIndex === questionIndex);
  if (!baseTarget) return { error: `question ${questionIndex} not found on finding ${findingId}` };

  // Rehydrate recordMeta + recordingIdField from the finding doc.
  // getFailedQuestionsForFinding builds bare items (no recordMeta), but the
  // verdict panel's Guest/TM/Record header AND the Record Details accordion
  // BOTH read from item.recordMeta. Without this step a pill-click empties
  // those fields and the reviewer loses guest/record context.
  const rehydrated = await rehydrateItemFromFinding(orgId, baseTarget);

  // Wire auditRemaining to the REAL audit-pending counter, NOT the default
  // 0 from getFailedQuestionsForFinding. The verdict panel uses this to
  // decide isLastForAudit (auditRemaining <= 1) — when 0, every jumped
  // question masquerades as the audit's final question and clicking Y/N
  // pops the type-YES finalize modal. That triggered Ashley's premature
  // finalize on h01QKxPfGbBYCjwB_P7Xm (3 decisions of 7 → finalized at
  // 84% before the rest were even seen).
  const remainingForFinding = (await getStored<number>("review-audit-pending", orgId, findingId)) ?? 0;
  const target: BufferItem = {
    ...rehydrated,
    auditRemaining: remainingForFinding,
    transcript: baseTarget.transcript,
  };

  // Make sure the reviewer has a review-active row for this question so a
  // subsequent /decide picks up the full ReviewItem (header/populated/etc.)
  // — otherwise recordDecision falls back to an empty stub and finalize's
  // identity-match path can't line the decision up with answeredQuestions.
  const existingActive = await getStored<ReviewItem & { claimedAt?: number }>(
    "review-active", orgId, reviewer, findingId, questionIndex,
  );
  if (!existingActive) {
    const { transcript: _t, auditRemaining: _r, ...itemForActive } = target;
    await setStored(
      "review-active", orgId,
      [reviewer, findingId, questionIndex],
      { ...itemForActive, claimedAt: Date.now() },
    );
  }

  const decisions = await getDecisionsByFinding(orgId, findingId, reviewer);
  return { buffer: [target], remaining: remainingForFinding, fullBuffer, decisions };
}

// ── Backfill review queue from finished findings ────────────────────────────

export async function backfillFromFinished(orgId: OrgId): Promise<{ queued: number }> {
  let queued = 0;

  // List all audit-finding header docs (key length === 1, not chunks)
  const findingDocs = await listStoredWithKeys<unknown>("audit-finding", orgId);
  const findingIds = new Set<string>();
  for (const { key } of findingDocs) {
    // Skip chunk docs (their key has more parts than just findingId)
    if (key.length === 1) findingIds.add(String(key[0]));
  }

  for (const findingId of findingIds) {
    const finding = await getFinding(orgId, findingId);
    if (!finding) continue;
    if (finding.findingStatus !== "finished") continue;
    if (!finding.answeredQuestions?.length) continue;

    // Skip if review queue already has a counter for this finding
    const existingCounter = await getStored("review-audit-pending", orgId, findingId);
    if (existingCounter !== null) continue;

    // Skip if any decided items exist for this finding
    const allDecided = await listStoredWithKeys("review-decided", orgId);
    const hasDecided = allDecided.some(({ key }) => key[0] === findingId);
    if (hasDecided) continue;

    const noAnswers = (finding.answeredQuestions as any[])
      .map((q: any, i: number) => ({ ...q, index: i }))
      .filter((q: any) => q.answer === "No");
    if (noAnswers.length === 0) continue;

    for (const [reviewIdx, q] of noAnswers.entries()) {
      const item: ReviewItem = {
        findingId,
        questionIndex: q.index,
        reviewIndex: reviewIdx + 1,
        totalForFinding: noAnswers.length,
        header: q.header ?? "",
        populated: q.populated ?? "",
        thinking: q.thinking ?? "",
        defense: q.defense ?? "",
        answer: q.answer,
      };
      await setStored("review-pending", orgId, [findingId, q.index], item);
    }
    await setStored("review-audit-pending", orgId, [findingId], noAnswers.length);
    queued += noAnswers.length;
  }

  return { queued };
}

// ── Stats ────────────────────────────────────────────────────────────────────

export async function getReviewStats(orgId: OrgId): Promise<{
  pending: number;
  decided: number;
  pendingAuditCount: number;
  dateLegPending: number;
  dateLegDecided: number;
  packagePending: number;
  packageDecided: number;
}> {
  return withTiming("getReviewStats", () => _getReviewStatsRaw(orgId));
}

async function _getReviewStatsRaw(orgId: OrgId): Promise<{
  pending: number;
  decided: number;
  pendingAuditCount: number;
  dateLegPending: number;
  dateLegDecided: number;
  packagePending: number;
  packageDecided: number;
}> {
  let dateLegPending = 0, packagePending = 0;
  let dateLegDecided = 0, packageDecided = 0;
  const pendingFindings = new Set<string>();

  // Filter out findings flagged by the dedup soft-hide path. Dedup writes
  // an `audit-hidden` doc per loser instead of deleting from review-pending
  // / review-active / review-decided — so without this filter the dashboard
  // shows inflated totals (the same numbers that triggered Josh & Ashley
  // seeing 740 pending while the queue had been deduped).
  const hidden = await getHiddenFindingIds(orgId);

  const bumpPending = (item: ReviewItem) => {
    if (item.recordingIdField === "GenieNumber") packagePending++;
    else dateLegPending++;
    pendingFindings.add(item.findingId);
  };

  // Parallel FS scans. Was sequential: each scan is a paginated read; a
  // wedge in any one used to drag the total past our 25s foreground
  // watchdog. Parallel via Promise.all means the wall-clock is the slowest
  // single scan, not the sum. Foreground lane has 64 slots — three in
  // flight is well under cap even with multiple reviewers polling.
  const [pending, active, decided] = await Promise.all([
    listStoredWithKeys<ReviewItem>("review-pending", orgId),
    listStoredWithKeys<ReviewItem>("review-active", orgId),
    listStoredWithKeys<ReviewItem>("review-decided", orgId),
  ]);
  for (const { value } of pending) {
    if (hidden.has(value.findingId)) continue;
    bumpPending(value);
  }
  for (const { value } of active) {
    if (hidden.has(value.findingId)) continue;
    bumpPending(value);
  }
  for (const { value } of decided) {
    if (hidden.has(value.findingId)) continue;
    if (value.recordingIdField === "GenieNumber") packageDecided++;
    else dateLegDecided++;
  }

  return {
    pending: dateLegPending + packagePending,
    decided: dateLegDecided + packageDecided,
    pendingAuditCount: pendingFindings.size,
    dateLegPending, dateLegDecided,
    packagePending, packageDecided,
  };
}

// ── Reviewed finding IDs ─────────────────────────────────────────────────────

export async function getReviewedFindingIds(orgId: OrgId): Promise<Set<string>> {
  const ids = new Set<string>();
  // MUST be the uncapped/paged scan. listStoredWithKeys truncates at 1000, so
  // once >1000 findings had ever been reviewed the set silently froze — every
  // report gated on "reviewed" (chargebacks, omissions, wire, audit-history's
  // Reviewed column) then treated the majority of reviewed findings as
  // unreviewed and dropped their rows. This was the chargeback-report cliff.
  const rows = await listStoredWithKeysAll<{ reviewedAt: string }>("review-done", orgId);
  for (const { key } of rows) ids.add(String(key[0]));
  return ids;
}

/** Distinct findingIds currently in the review queue. Unions
 *  `review-pending` (waiting) and `review-active` (claimed by a reviewer)
 *  — the same union getReviewStats uses for pendingAuditCount. Deliberately
 *  EXCLUDES `review-decided` (questions decided but audit not yet
 *  finalized); those entries can be months old and would balloon the count
 *  with historical noise. Applies the audit-hidden (dedup soft-hide)
 *  filter. */
export async function getPendingReviewFindings(
  orgId: OrgId,
  opts: { sinceMs?: number; untilMs?: number } = {},
): Promise<Map<string, ReviewItem>> {
  const out = new Map<string, ReviewItem>();
  const useIndex = typeof opts.sinceMs === "number" && typeof opts.untilMs === "number" && opts.untilMs >= opts.sinceMs;
  // Indexed path: server-side range filter on completedAt against both
  // review stores. Verified equivalent to the brute-force scan on prod
  // via the Index Tests Compare card (review-pending 522/522, review-
  // active 21/21, zero missing-field). The brute-force path stays as
  // the unfiltered default for callers that genuinely want every queue
  // entry regardless of date (e.g. reconcilePerfectPending).
  const fetchRows = useIndex
    ? () => Promise.all([
      listStoredByCompletedAtWithKeys<ReviewItem>("review-pending", orgId, opts.sinceMs!, opts.untilMs!, { fieldName: "completedAt", limit: 10_000 }),
      listStoredByCompletedAtWithKeys<ReviewItem>("review-active", orgId, opts.sinceMs!, opts.untilMs!, { fieldName: "completedAt", limit: 10_000 }),
    ])
    : () => Promise.all([
      listStoredWithKeys<ReviewItem>("review-pending", orgId),
      listStoredWithKeys<ReviewItem>("review-active", orgId),
    ]);
  const [[pending, active], hidden] = await Promise.all([
    fetchRows(),
    getHiddenFindingIds(orgId),
  ]);
  const ingest = (rows: { key: unknown[]; value: ReviewItem }[]) => {
    for (const { key, value } of rows) {
      const fid = String(key[0]);
      if (!value || hidden.has(fid)) continue;
      if (!out.has(fid)) out.set(fid, value);
    }
  };
  ingest(pending);
  ingest(active);
  return out;
}

// ── Clear queue ──────────────────────────────────────────────────────────────

export async function clearReviewQueue(orgId: OrgId): Promise<{ cleared: number }> {
  let cleared = 0;
  for (const { key } of await listStoredWithKeys("review-pending", orgId)) {
    await deleteStored("review-pending", orgId, ...key); cleared++;
  }
  for (const { key } of await listStoredWithKeys("review-active", orgId)) {
    await deleteStored("review-active", orgId, ...key); cleared++;
  }
  return { cleared };
}

// ── Legacy aliases ──────────────────────────────────────────────────────────

export const claimNextItemLegacy = claimNextItem;
export const undoDecisionLegacy = undoDecision;
export const previewFindingLegacy = previewFinding;
export const backfillFromFinishedLegacy = backfillFromFinished;
export const adminFlipFindingLegacy = adminFlipFinding;
