/** Manager queue repository. Firestore-backed. */

import {
  getStored, setStored, deleteStored, listStoredWithKeys,
  listStoredWithKeysAll, listStoredByFieldIn, listStoredByQuery, FIELD_IN_MAX_VALUES,
} from "@core/data/firestore/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";
import { questionLabel } from "@core/business/question-labels/mod.ts";
import type { ReviewDecision, AuditDoneIndexEntry } from "@core/dto/types.ts";
import { getFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { buildIndexMeta, readDoneIdxEntry, saleFlagsFromFinding } from "@audit/domain/data/stats-repository/mod.ts";

export interface ManagerQueueItem {
  findingId: string;
  addedAt: number;
  status: string;
  owner?: string;
  /** Team member display name (VoName minus the "DEST - " prefix). Empty
   *  string means "enriched, but the record has no VoName" — undefined means
   *  the item predates enrichment and is still pending a lazy backfill. */
  voName?: string;
  /** QuickBase employee id (fid 143) — the person key the queue's team-member
   *  name links on. voName can't do it: two different Mariah Browns share both
   *  a name AND a VO email, so a name-built link opens the wrong report.
   *  Undefined on items queued before 2026-08-10, and on items whose finding
   *  predates the id — those render as plain text, deliberately unlinked. */
  employeeId?: string;
  /** Audit-result email tracking, mirroring AuditDoneIndexEntry — denormalized
   *  so the queue's "Email Opened" column costs no per-row reads. Undefined
   *  `emailSentAt` means no email has gone out yet. */
  emailSentAt?: number;
  emailOpenedAt?: number;
  recordId?: string;
  recordingId?: string;
  totalQuestions?: number;
  failedCount?: number;
  /** Headers of the currently-failing (answer "No") questions, denormalized
   *  so the queue table can list them without hydrating findings per render. */
  failedQuestions?: string[];
  /** WGS/MCC sale flags (saleFlagsFromFinding); undefined until enriched. */
  wgs?: boolean;
  mcc?: boolean;
  /** Department (ActivatingOffice, or OfficeName for packages) + shift,
   *  denormalized so the queue can be scoped to a manager's team without
   *  hydrating findings per request. Empty string means "enriched, but the
   *  record has no value" — undefined means pending the lazy backfill. */
  department?: string;
  shift?: string;
  isPackage?: boolean;
  completedAt?: number;
  jobTimestamp?: string;
  /** Set while this audit is out for appeal — either a judge appeal
   *  ("appealed") or a re-audit with new/different audio ("re-audited").
   *
   *  An audit awaiting an appeal is not ready to coach on: the failure it was
   *  queued for may be about to vanish. So it leaves the pending queue and
   *  shows on the Completed side under its own flag. Deliberately independent
   *  of `status`, which stays the remediation lifecycle — a manager can still
   *  record remediation notes on an appealed audit, and the row then carries
   *  both marks.
   *
   *  Cleared by the judge path when the appeal is decided and the failure
   *  STILL stands (see clearQueueItemAppeal): the row returns to Pending,
   *  because someone does have to coach it after all. */
  appealState?: "appealed" | "re-audited";
  appealedAt?: number;
  /** Whoever filed it — the manager off the remediation page, or the team
   *  member off the audit-report link. Shown in Completed's "By" column. */
  appealedBy?: string;
  appealNote?: string;
  /** Stamped when a decided appeal sent the row back to Pending, so the queue
   *  row can say why it reappeared instead of looking like a new failure. */
  appealDeniedAt?: number;
  remediatedBy?: string;
  remediatedAt?: number;
  notes?: string;
  /** The audit never got usable audio — the bot could not grade it, so there
   *  is no question-level failure to coach. It still belongs in the queue (a
   *  rep whose call did not record needs following up) but it needs its own
   *  badge, and its 0% score is an artefact rather than a real result. */
  invalidGenie?: boolean;
  /** A manager decided this one is not worth coaching. Closes the row the same
   *  way remediation does, but records no write-up — the button is one click. */
  skippedBy?: string;
  skippedAt?: number;
}

/** Open work: still needs a manager. Excludes anything closed out — whether
 *  that was remediation notes or an appeal taking it off the table.
 *
 *  This predicate is THE definition of "in the remediation queue", and the
 *  frontend mirrors it (routes/api/manager/queue.tsx isOpenItem). Both sides
 *  must agree or a row shows in neither pane, or in both. */
export function isOpenQueueItem(i: { status?: string; appealState?: string }): boolean {
  return i.status !== "remediated" && i.status !== "skipped" && !i.appealState;
}

/** Closed out — remediated, appealed, or both. The Completed side. */
export function isClosedQueueItem(i: { status?: string; appealState?: string }): boolean {
  return !isOpenQueueItem(i);
}

/** Did the bot ever get usable audio for this audit? Mirrors step-finalize's
 *  `isInvalid` exactly (rawTranscript carrying "Invalid Genie" / "Genie
 *  Invalid", or findingStatus "no recording") so the queue badge and the
 *  index's reason="invalid_genie" can never disagree. */
export function isInvalidGenieFinding(finding: Record<string, unknown>): boolean {
  const raw = String(finding.rawTranscript ?? "");
  return raw.includes("Invalid Genie") || raw.includes("Genie Invalid") ||
    finding.findingStatus === "no recording";
}

/** Queue-display fields derivable from the finding doc. Always sets voName
 *  (possibly "") so enriched items stop matching the lazy-backfill filter. */
function enrichmentFromFinding(finding: Record<string, unknown>): Partial<ManagerQueueItem> {
  const rec = (finding.record ?? {}) as Record<string, unknown>;
  const rawVo = String(rec.VoName ?? "");
  const voName = rawVo.includes(" - ") ? rawVo.split(" - ").slice(1).join(" - ").trim() : rawVo.trim();
  const answered = (finding.answeredQuestions ?? []) as Array<{ header?: string; answer?: string }>;
  const failed = answered.filter((q) => String(q.answer ?? "").trim().toLowerCase() === "no");
  // Same department/shift derivation as audit-history hydrateMissing():
  // packages carry OfficeName and have no shift; date legs carry
  // ActivatingOffice + Shift. Always set (possibly "") so enriched items
  // stop matching the lazy-backfill staleness filter.
  const isPackage = finding.recordingIdField === "GenieNumber";
  return {
    owner: (finding.owner as string | undefined) ?? "",
    voName,
    // Left undefined (not "") when the record has no id, matching buildIndexMeta
    // — the queue table decides "link or plain text" on exactly this.
    employeeId: rec.RelatedEmployeeId != null ? String(rec.RelatedEmployeeId) : undefined,
    recordId: String(rec.RecordId ?? rec.id ?? ""),
    recordingId: (finding.recordingId as string | undefined) ?? "",
    totalQuestions: answered.length,
    failedQuestions: failed.map((q) => questionLabel(q)).filter(Boolean),
    department: String(isPackage ? (rec.OfficeName ?? "") : (rec.ActivatingOffice ?? "")),
    shift: isPackage ? "" : String(rec.Shift ?? ""),
    isPackage,
    ...saleFlagsFromFinding(finding),
  };
}

export async function populateManagerQueue(orgId: OrgId, findingId: string): Promise<void> {
  const item: ManagerQueueItem = { findingId, addedAt: Date.now(), status: "pending" };
  try {
    const finding = await getFinding(orgId, findingId);
    if (finding) {
      const enrich = enrichmentFromFinding(finding);
      Object.assign(item, enrich, { failedCount: enrich.failedQuestions?.length ?? 0 });
    }
  } catch { /* enrichment is display-only — queue the item regardless */ }
  await setStored("manager-queue", orgId, [findingId], item);
}

/** Live enqueue for a just-finalized review: add the finding to the manager
 *  remediation queue IFF it still has confirmed failures. Idempotent (skips a
 *  finding that's already in the queue, so it never clobbers a remediated item
 *  or resets addedAt) and a no-op for audits that passed after review. Stamps
 *  completedAt (the review-finalize time) + jobTimestamp so the queue's
 *  Timestamp column and date window reflect the audit — same item shape as
 *  backfillManagerQueue, just for one finding. Called from finalizeReviewedAudit.
 *
 *  This wiring was dropped in the 2026-05-06 danet refactor (populateManagerQueue
 *  went call-less), so nothing landed in the queue automatically after that. */
export async function enqueueRemediationForFinding(
  orgId: OrgId, findingId: string, opts: { completedAt?: number } = {},
): Promise<{ enqueued: boolean; reason?: string }> {
  const existing = await getStored<ManagerQueueItem>("manager-queue", orgId, findingId);
  if (existing) return { enqueued: false, reason: "already-queued" };
  const finding = await getFinding(orgId, findingId);
  if (!finding) return { enqueued: false, reason: "no-finding" };
  const enrich = enrichmentFromFinding(finding);
  const failedCount = enrich.failedQuestions?.length ?? 0;
  // An invalid-genie audit has NO graded questions, so failedCount is 0 — but
  // it is still a failure a manager has to follow up (the call never
  // recorded). Gating purely on failedCount kept every one of them out.
  const invalidGenie = isInvalidGenieFinding(finding);
  if (failedCount === 0 && !invalidGenie) return { enqueued: false, reason: "no-failures" };
  const item: ManagerQueueItem = {
    findingId,
    addedAt: Date.now(),
    status: "pending",
    ...enrich,
    failedCount,
    ...(invalidGenie ? { invalidGenie: true } : {}),
    completedAt: opts.completedAt ?? Date.now(),
    jobTimestamp: (finding.job as { timestamp?: string } | undefined)?.timestamp ?? "",
  };
  await setStored("manager-queue", orgId, [findingId], item);
  return { enqueued: true };
}

/** Stamp email sent/opened onto a finding's remediation-queue row, so the queue
 *  can show an "Email Opened" column without reading a mark per row.
 *
 *  A no-op when the finding isn't queued (most audits aren't), and best-effort
 *  throughout — this runs off the email send + open-pixel paths, where failing
 *  loudly would cost a real email or a pixel response for a cosmetic column.
 *  Both fields are first-write-wins so a second open can't clear the send time. */
export async function stampEmailOnQueueItem(
  orgId: OrgId,
  findingId: string,
  patch: { emailSentAt?: number; emailOpenedAt?: number },
): Promise<boolean> {
  try {
    const existing = await getStored<ManagerQueueItem>("manager-queue", orgId, findingId);
    if (!existing) return false;
    const merged: ManagerQueueItem = {
      ...existing,
      ...(patch.emailSentAt != null && existing.emailSentAt == null ? { emailSentAt: patch.emailSentAt } : {}),
      ...(patch.emailOpenedAt != null && existing.emailOpenedAt == null ? { emailOpenedAt: patch.emailOpenedAt } : {}),
    };
    await setStored("manager-queue", orgId, [findingId], merged);
    return true;
  } catch (err) {
    console.warn(`⚠️ [MANAGER-QUEUE] ${findingId}: email stamp failed (non-fatal):`, err);
    return false;
  }
}

/** WHOLE-ORG queue read. Capped by listStored's 1000-row default, which the
 *  queue outgrew: at 1,518 rows in prod that silently hid 518 of them, and
 *  because Firestore returns document-id order with no sort, it hid the SAME
 *  518 on every request. Five departments were more than half invisible and
 *  three saw none of their queue at all.
 *
 *  So this is now only for callers that genuinely need every row (admin /
 *  super-manager stat totals). A manager reads their own team through
 *  getManagerQueueForDepartments instead, which is both correct AND cheaper. */
export async function getManagerQueue(orgId: OrgId): Promise<ManagerQueueItem[]> {
  const rows = await listStoredWithKeysAll<ManagerQueueItem>("manager-queue", orgId);
  return rows.map((r) => r.value);
}

/** A manager's queue, narrowed to their departments BY THE DATABASE.
 *
 *  The rows already carry a denormalized `department` (that is what lets
 *  filterQueueToManagerScope work without hydrating findings), so the filter
 *  belongs in the query rather than in memory after a capped read. Reads then
 *  scale with the manager's team instead of the org: 29 docs for a VBA PM
 *  manager, 275 for the largest single department, against 1,000 before.
 *
 *  Returns null when the caller must fall back to the full scan:
 *    - no departments in scope — an empty scope means "no restriction" in
 *      filterQueueToManagerScope's semantics, not "nothing".
 *    - more departments than Firestore's IN operator accepts. One prod
 *      account (48 departments) is effectively org-wide anyway.
 *
 *  Shift is deliberately NOT pushed into the query: packages carry no shift
 *  and are meant to skip that check, so a shift filter in the query would
 *  silently drop them. filterQueueToManagerScope still applies it in memory
 *  over the already-small result. */
export async function getManagerQueueForDepartments(
  orgId: OrgId,
  departments: string[],
): Promise<ManagerQueueItem[] | null> {
  const depts = [...new Set(departments.map((d) => d.trim()).filter(Boolean))];
  if (depts.length === 0 || depts.length > FIELD_IN_MAX_VALUES) return null;
  return await listStoredByFieldIn<ManagerQueueItem>("manager-queue", orgId, "department", depts);
}

/** DERIVED manager queue: the failing audits for these departments, read
 *  straight from audit-done-idx, with the stored row used only as an overlay
 *  for the manager's own work.
 *
 *  The stored manager-queue row was a SNAPSHOT — written once at review-
 *  finalize and never recomputed — so every way an audit could stop failing
 *  (judge overturn, reviewer flip, re-audit) left a row behind asking someone
 *  to coach a mistake that no longer existed. dropResolvedQueueItems, the
 *  100%-removal on the judge path and the appeal flags were all bookkeeping to
 *  keep that copy in step with audit-done-idx, which had the truth the whole
 *  time. Deriving removes the copy, and with it the whole class of staleness.
 *
 *  What the index CAN'T know is the manager's own work — the remediation note,
 *  who closed it, when — so that stays a stored row. It is sparse by nature
 *  (9 of 1,518 rows in prod carried any) and is layered on by findingId.
 *
 *  The predicate, and why each part:
 *    completed === true    — an audit still awaiting review is not a confirmed
 *                            failure yet (~1,190 sit unreviewed at any time).
 *    score < 100           — a perfect audit has nothing to coach.
 *    appealStatus !== pending — an audit whose result is being contested is
 *                            not ready to coach on. This is the SAME rule the
 *                            appeal flag encoded, except the index already
 *                            tracks it, so nothing has to be kept in sync.
 *  A re-audit needs no rule at all: it deletes the old index row outright, so
 *  the audit simply stops being derived.
 *
 *  Invalid-genie audits (reason="invalid_genie") are INCLUDED: the bot never
 *  got usable audio, so there is no question-level failure, but the rep's call
 *  did not record and that still needs following up. They carry their own
 *  badge, and their 0% score is flagged as an artefact rather than shown as a
 *  real result.
 *
 *  appealStatus is filtered in memory rather than in the query on purpose —
 *  each extra field makes the composite index narrower and less reusable, and
 *  the result set is already department-sized by then. */
export async function deriveManagerQueue(
  orgId: OrgId,
  departments: string[],
): Promise<ManagerQueueItem[] | null> {
  const depts = [...new Set(departments.map((d) => d.trim()).filter(Boolean))];
  if (depts.length === 0 || depts.length > FIELD_IN_MAX_VALUES) return null;

  const [rows, stored] = await Promise.all([
    listStoredByQuery<AuditDoneIndexEntry>("audit-done-idx", orgId, {
      equals: { completed: true },
      oneOf: { field: "department", values: depts },
      lessThan: { field: "score", value: 100 },
    }),
    getManagerQueueForDepartments(orgId, depts),
  ]);

  const overlay = new Map((stored ?? []).map((i) => [i.findingId, i]));
  const out: ManagerQueueItem[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r.findingId || seen.has(r.findingId)) continue;
    // Invalid genies STAY. There is no graded question to coach, but a call
    // that never recorded is still a failure a manager has to follow up, so it
    // shows with its own badge instead of being filtered out.
    if (r.appealStatus === "pending") continue;
    seen.add(r.findingId);
    out.push(mergeIndexRowWithStored(r, overlay.get(r.findingId)));
  }
  // Rows a manager already closed out keep their place on the Completed side
  // even once the audit stops being derived — an appeal that WON takes the
  // audit to 100%, and the write-up is still a record of work done.
  for (const item of overlay.values()) {
    if (!seen.has(item.findingId) && isClosedQueueItem(item)) out.push(item);
  }
  return out;
}

/** One derived row: display fields from the index, manager work from the
 *  stored overlay. `addedAt` falls back to the audit's own completion time —
 *  the index has no notion of "when this entered a queue", and completedAt is
 *  the honest answer to "how long has this been waiting". */
function mergeIndexRowWithStored(
  r: AuditDoneIndexEntry,
  stored: ManagerQueueItem | undefined,
): ManagerQueueItem {
  const at = r.doneAt ?? r.completedAt ?? 0;
  return {
    findingId: r.findingId,
    addedAt: stored?.addedAt ?? at,
    completedAt: r.completedAt ?? at,
    status: stored?.status ?? "pending",
    owner: r.owner,
    voName: r.voName ?? "",
    employeeId: r.employeeId,
    emailSentAt: r.emailSentAt,
    emailOpenedAt: r.emailOpenedAt,
    recordId: r.recordId,
    recordingId: r.recordingId,
    department: r.department ?? "",
    shift: r.shift ?? "",
    isPackage: r.isPackage,
    wgs: r.wgs,
    mcc: r.mcc,
    ...(r.reason === "invalid_genie" || stored?.invalidGenie ? { invalidGenie: true } : {}),
    // The index carries the SCORE, not the per-question detail. failedCount is
    // reconstructed from it when the total is known; failedQuestions stays on
    // the stored row (it is written at enqueue time) and is simply absent for
    // rows that never had one — the table already renders a dash for that,
    // and hydrating questions per row is the pattern that has 503'd prod.
    totalQuestions: stored?.totalQuestions,
    failedCount: stored?.failedCount
      ?? (stored?.totalQuestions ? Math.round(stored.totalQuestions * (100 - (r.score ?? 0)) / 100) : undefined),
    failedQuestions: stored?.failedQuestions,
    jobTimestamp: stored?.jobTimestamp,
    ...(stored?.remediatedBy ? { remediatedBy: stored.remediatedBy } : {}),
    ...(stored?.remediatedAt ? { remediatedAt: stored.remediatedAt } : {}),
    ...(stored?.notes ? { notes: stored.notes } : {}),
    ...(stored?.skippedBy ? { skippedBy: stored.skippedBy } : {}),
    ...(stored?.skippedAt ? { skippedAt: stored.skippedAt } : {}),
    ...(stored?.appealState ? { appealState: stored.appealState } : {}),
    ...(stored?.appealedAt ? { appealedAt: stored.appealedAt } : {}),
    ...(stored?.appealedBy ? { appealedBy: stored.appealedBy } : {}),
    ...(stored?.appealNote ? { appealNote: stored.appealNote } : {}),
  } as ManagerQueueItem;
}

/** Restrict queue items to a manager's department+shift scope — same
 *  semantics as the audit-history scope filter: an empty scope list means
 *  "no restriction on that axis", and packages skip the shift check (they
 *  have no shift). Items not yet stamped with a department (undefined —
 *  pending the lazy backfill) are HIDDEN, so a manager never sees a row
 *  that might belong to another team. */
export function filterQueueToManagerScope(
  items: ManagerQueueItem[],
  scope: { departments: string[]; shifts: string[] },
): ManagerQueueItem[] {
  return items.filter((i) => {
    if (i.department === undefined) return false;
    if (scope.departments.length > 0 && !scope.departments.includes(i.department)) return false;
    if (scope.shifts.length > 0 && !i.isPackage && !scope.shifts.includes(i.shift ?? "")) return false;
    return true;
  });
}

/** Lazily enrich queue items that predate the failedQuestions/department
 *  denorms, at most `max` per call so an auto-refreshing dashboard can never
 *  trigger unbounded finding hydration (that pattern has crashed prod
 *  before). Staleness keys off fields ONLY enrichment writes —
 *  failedQuestions, wgs, and now department (added for manager scoping, so
 *  previously-enriched items re-enrich once to pick it up). Mutates the
 *  passed items in place AND persists, so the queue converges one poll at
 *  a time. Items whose finding is gone get an empty marker to stop re-tries. */
export async function enrichManagerQueueBatch(orgId: OrgId, items: ManagerQueueItem[], max = 10): Promise<number> {
  const stale = items.filter((i) => (i.failedQuestions === undefined || i.wgs === undefined || i.department === undefined) && i.findingId).slice(0, max);
  if (stale.length === 0) return 0;
  await Promise.all(stale.map(async (item) => {
    try {
      const finding = await getFinding(orgId, item.findingId);
      // Finding truly gone → persist an empty marker (keeping any existing
      // voName) so it stops matching the filter; a transient read/write error
      // throws and leaves the item untouched, so the next poll retries it.
      const patch = finding
        ? enrichmentFromFinding(finding)
        : { voName: item.voName ?? "", failedQuestions: item.failedQuestions ?? [], wgs: false, mcc: false, department: "", shift: "", isPackage: false };
      Object.assign(item, patch);
      await setStored("manager-queue", orgId, [item.findingId], { ...item });
    } catch { /* transient — retried on the next poll */ }
  }));
  return stale.length;
}

/** Flag a queued audit as out for appeal, which takes it off the pending
 *  queue and onto the Completed side (see isOpenQueueItem).
 *
 *  Called from BOTH appeal paths — the judge appeal (fileJudgeAppeal) and the
 *  two re-audit paths (startReauditWithGenies / startUploadReaudit) — because
 *  the rule is about the audit's state, not who filed it or how: an audit
 *  whose result is being contested isn't something to coach on yet.
 *
 *  A no-op when the finding isn't queued (most audits aren't) and when a flag
 *  is already set, so a second appeal can't overwrite the first one's author
 *  or timestamp. Best-effort by contract: the caller's appeal must succeed
 *  whether or not a cosmetic queue row moved, so this returns a boolean and
 *  never throws.
 *
 *  Clears any prior appealDeniedAt — a row that came back from a denied appeal
 *  and is now being appealed again is out for appeal, not denied. */
export async function markQueueItemAppealed(
  orgId: OrgId,
  findingId: string,
  patch: { appealState: "appealed" | "re-audited"; appealedAt?: number; appealedBy?: string; appealNote?: string },
): Promise<boolean> {
  try {
    const existing = await getStored<ManagerQueueItem>("manager-queue", orgId, findingId);
    if (!existing) return false;
    if (existing.appealState) return false;
    const { appealDeniedAt: _cleared, ...rest } = existing;
    await setStored("manager-queue", orgId, [findingId], {
      ...rest,
      appealState: patch.appealState,
      appealedAt: patch.appealedAt ?? Date.now(),
      ...(patch.appealedBy ? { appealedBy: patch.appealedBy } : {}),
      ...(patch.appealNote ? { appealNote: patch.appealNote } : {}),
    });
    console.log(`📋 [MANAGER-QUEUE] ${findingId}: flagged ${patch.appealState} — off the pending queue`);
    return true;
  } catch (err) {
    console.warn(`⚠️ [MANAGER-QUEUE] ${findingId}: appeal flag failed (non-fatal):`, err);
    return false;
  }
}

/** Send an appealed row back to Pending because the appeal was decided and the
 *  failure still stands. The coaching ask is real again, so the flag comes off
 *  and appealDeniedAt goes on to explain the reappearance.
 *
 *  Only for a row still carrying an appeal flag — a remediated row stays
 *  remediated (that is a manager's completed work, not a pending ask), and a
 *  row with no flag never left. Best-effort, same contract as the mark. */
export async function clearQueueItemAppeal(orgId: OrgId, findingId: string): Promise<boolean> {
  try {
    const existing = await getStored<ManagerQueueItem>("manager-queue", orgId, findingId);
    if (!existing?.appealState) return false;
    const { appealState: _s, appealedAt: _a, appealedBy: _b, appealNote: _n, ...rest } = existing;
    await setStored("manager-queue", orgId, [findingId], { ...rest, appealDeniedAt: Date.now() });
    console.log(`📋 [MANAGER-QUEUE] ${findingId}: appeal decided, failure stands — back on the pending queue`);
    return true;
  } catch (err) {
    console.warn(`⚠️ [MANAGER-QUEUE] ${findingId}: appeal clear failed (non-fatal):`, err);
    return false;
  }
}

/** Take one finding out of the remediation queue. Used by the judge path when
 *  an overturn puts the audit back at 100% — there is nothing left to coach on,
 *  and the queue row would otherwise outlive the failure that created it.
 *  Returns whether a row was actually there. A row that is already closed out
 *  is left alone — remediated or appealed, that is a manager's completed work
 *  and its record on the Completed side, not a pending ask. */
export async function removeFromManagerQueue(orgId: OrgId, findingId: string): Promise<boolean> {
  const existing = await getStored<ManagerQueueItem>("manager-queue", orgId, findingId);
  if (!existing || !isOpenQueueItem(existing)) return false;
  await deleteStored("manager-queue", orgId, findingId);
  return true;
}

/** Drop queue items whose audit has gone back to 100% on audit-done-idx.
 *
 *  The queue is a SNAPSHOT taken at review-finalize: it records the failures
 *  as they stood then, and nothing recomputes it. When a judge overturns the
 *  last confirmed failure (or a reviewer/admin flips it), the audit returns to
 *  100% and its audit-done-idx row is rewritten — but the queue item stayed
 *  put, so a manager was still asked to remediate a failure that no longer
 *  exists. Prod case: qJfmNgg8lCKwSGfaIY0qW sat in VBA PM's queue with
 *  failedQuestions ["Conf Email"] nine hours after that question was overturned.
 *
 *  Read-time drain: check the items the caller is about to show, take the
 *  resolved ones out of the list AND delete their rows, so each one is paid
 *  for once instead of on every poll. Bounded per call — this runs on an
 *  auto-polling dashboard, so it must never do unbounded work per request —
 *  and costs one or two small point-gets per item: no finding hydration, no
 *  index scan.
 *
 *  An item whose index row can't be found is KEPT. Unknown is not the same as
 *  passed, and silently emptying a manager's queue on a failed read is the
 *  worse failure.
 *
 *  Mutates `items` in place (same convention as enrichManagerQueueBatch) and
 *  returns how many it dropped. */
export async function dropResolvedQueueItems(
  orgId: OrgId,
  items: ManagerQueueItem[],
  max = 25,
): Promise<number> {
  const candidates = items.filter((i) => isOpenQueueItem(i) && i.findingId).slice(0, max);
  if (candidates.length === 0) return 0;

  const scores = await Promise.all(candidates.map(async (item) => {
    try {
      const entry = await readDoneIdxEntry(orgId, item.findingId, { at: item.completedAt });
      return { findingId: item.findingId, score: entry?.score };
    } catch {
      // Transient read failure — keep the item, the next poll retries it.
      return { findingId: item.findingId, score: undefined };
    }
  }));

  const resolved = scores.filter((s) => s.score === 100).map((s) => s.findingId);
  if (resolved.length === 0) return 0;

  const drop = new Set(resolved);
  for (let i = items.length - 1; i >= 0; i--) {
    if (drop.has(items[i].findingId)) items.splice(i, 1);
  }
  for (const findingId of resolved) {
    try {
      await deleteStored("manager-queue", orgId, findingId);
      console.log(`🧹 [MANAGER-QUEUE] ${findingId}: dropped — audit is back to 100%`);
    } catch (err) {
      // Already out of the returned list; the next poll deletes it for real.
      console.warn(`⚠️ [MANAGER-QUEUE] ${findingId}: drop delete failed (non-fatal):`, err);
    }
  }
  return resolved.length;
}

// ── Data maintenance: clear queue items by team / date ───────────────────────

export interface ManagerQueueFilter {
  /** Exact (trimmed) department match, e.g. "2ND". */
  department?: string;
  /** Exact (trimmed) shift match, e.g. "AM". */
  shift?: string;
  /** Audit-date window (ms). `since` inclusive, `until` exclusive. */
  since?: number;
  until?: number;
}

export interface ManagerQueueClearMatch {
  findingId: string;
  owner?: string;
  department?: string;
  shift?: string;
  date?: number;
}

export interface ManagerQueueClearResult {
  total: number;
  matched: number;
  deleted: number;
  dryRun: boolean;
  /** Up to 50 matched items, for an admin preview before committing. */
  sample: ManagerQueueClearMatch[];
}

/** Clear manager-queue items matching any combination of department / shift /
 *  date-range. dept + shift are exact (trimmed) matches resolved from each
 *  finding (so a stale queue can be scoped to a manager's team before they go
 *  live); the date is the audit's completion date (`completedAt`, falling back
 *  to `addedAt`). Pass `{ dryRun: true }` to preview the count + a sample
 *  without deleting.
 *
 *  Requires at least one filter — refuses an unfiltered wipe so an empty admin
 *  form can never nuke the entire queue. A pure date-range clear reads no
 *  findings; dept/shift filters resolve each finding once (deduped). */
export async function clearManagerQueue(
  orgId: OrgId,
  filter: ManagerQueueFilter,
  opts: { dryRun?: boolean } = {},
): Promise<ManagerQueueClearResult> {
  const dept = filter.department?.trim() || undefined;
  const shift = filter.shift?.trim() || undefined;
  const since = Number.isFinite(filter.since) ? Number(filter.since) : undefined;
  const until = Number.isFinite(filter.until) ? Number(filter.until) : undefined;

  if (!dept && !shift && since == null && until == null) {
    throw new Error("clearManagerQueue: at least one filter (department, shift, since, until) is required");
  }

  const items = await getManagerQueue(orgId);
  const needDeptShift = !!dept || !!shift;
  const metaCache = new Map<string, { department?: string; shift?: string }>();
  const matches: ManagerQueueClearMatch[] = [];

  for (const item of items) {
    const date = item.completedAt ?? item.addedAt;
    // Date filter first — cheap, and a pure date clear needs no finding read.
    if (since != null && (date == null || date < since)) continue;
    if (until != null && (date == null || date >= until)) continue;

    let itemDept: string | undefined;
    let itemShift: string | undefined;
    if (needDeptShift) {
      if (!metaCache.has(item.findingId)) {
        let resolved: { department?: string; shift?: string } = {};
        try {
          const finding = await getFinding(orgId, item.findingId);
          if (finding) {
            const meta = buildIndexMeta(finding);
            resolved = { department: meta.department, shift: meta.shift };
          }
        } catch { /* finding gone — unresolvable; won't match a dept/shift filter */ }
        metaCache.set(item.findingId, resolved);
      }
      const m = metaCache.get(item.findingId)!;
      itemDept = m.department;
      itemShift = m.shift;
      if (dept && itemDept !== dept) continue;
      if (shift && itemShift !== shift) continue;
    }

    matches.push({ findingId: item.findingId, owner: item.owner, department: itemDept, shift: itemShift, date });
  }

  let deleted = 0;
  if (!opts.dryRun) {
    for (const m of matches) {
      await deleteStored("manager-queue", orgId, m.findingId);
      deleted++;
    }
  }

  return { total: items.length, matched: matches.length, deleted, dryRun: !!opts.dryRun, sample: matches.slice(0, 50) };
}

export async function submitRemediation(orgId: OrgId, findingId: string, notes: string, username: string): Promise<{ ok: boolean }> {
  const existing = await getStored<ManagerQueueItem>("manager-queue", orgId, findingId);
  if (!existing) return { ok: false };
  const remediatedAt = Date.now();
  await setStored("manager-queue", orgId, [findingId], { ...existing, status: "remediated", remediatedBy: username, remediatedAt, notes });

  // Fire the `manager` webhook — best-effort
  try {
    const { fireWebhook } = await import("@admin/domain/data/admin-repository/mod.ts");
    const finding = await getFinding(orgId, findingId);
    if (finding) {
      fireWebhook(orgId, "manager", {
        findingId,
        finding,
        remediation: { notes, addressedBy: username, addressedAt: remediatedAt },
        remediatedAt: new Date(remediatedAt).toISOString(),
      }).catch((err) => console.error(`[MANAGER] ${findingId}: fireWebhook failed:`, err));
    }
  } catch (err) {
    console.error(`[MANAGER] ${findingId}: webhook prep failed:`, err);
  }

  // Manager gamification — fire-and-forget. Latency = arrival → submit;
  // sub-24h triggers the same-day XP bonus + 24h badge counters.
  void import("@gamification/domain/business/gamification-lane/mod.ts")
    .then(({ awardForCompletion }) =>
      awardForCompletion({
        orgId, email: username, role: "manager",
        remediationLatencyMs: existing.addedAt ? Math.max(0, remediatedAt - existing.addedAt) : undefined,
      })
    )
    .catch((err) => console.error(`[MANAGER] ${findingId}: gamification lane import failed:`, err));

  return { ok: true };
}

/** Close a row out WITHOUT a remediation write-up — the manager has looked at
 *  it and decided it is not worth coaching (a bot artefact, a call that never
 *  recorded, a rep who has already left).
 *
 *  Deliberately different from submitRemediation in two ways:
 *    - no notes are required, because the whole point is that it is one click;
 *    - no XP and no webhook, because nothing was coached. Paying out for
 *      skipping would make clearing the queue the cheapest way to earn.
 *  Who skipped it and when ARE recorded, so the decision is attributable.
 *
 *  Refuses a row that is already closed out: re-skipping a remediated audit
 *  would bury a real write-up behind a skip. */
export async function skipRemediation(
  orgId: OrgId,
  findingId: string,
  username: string,
): Promise<{ ok: boolean; reason?: string }> {
  const existing = await getStored<ManagerQueueItem>("manager-queue", orgId, findingId);
  if (!existing) return { ok: false, reason: "not-queued" };
  if (!isOpenQueueItem(existing)) return { ok: false, reason: "already-closed" };
  await setStored("manager-queue", orgId, [findingId], {
    ...existing,
    status: "skipped",
    skippedBy: username,
    skippedAt: Date.now(),
  });
  console.log(`📋 [MANAGER-QUEUE] ${findingId}: skipped by ${username}`);
  return { ok: true };
}

export async function getManagerStats(
  orgId: OrgId,
): Promise<{ total: number; pending: number; remediated: number; appealed: number }> {
  const items = await getManagerQueue(orgId);
  return {
    total: items.length,
    // Pending is open work only, so an audit out for appeal no longer counts
    // against a manager — it isn't theirs to act on until the appeal lands.
    pending: items.filter(isOpenQueueItem).length,
    // Skipped counts as closed out alongside remediated: both are a manager
    // having dealt with the row, and a sixth stat card earns less than it costs.
    remediated: items.filter((i) => i.status === "remediated" || i.status === "skipped").length,
    appealed: items.filter((i) => !!i.appealState).length,
  };
}

// ── Backfill manager queue from review-decided failures ─────────────────────

export async function backfillManagerQueue(orgId: OrgId): Promise<{ added: number }> {
  let added = 0;

  const decidedRows = await listStoredWithKeys<ReviewDecision>("review-decided", orgId);
  const decidedByFinding: Record<string, ReviewDecision[]> = {};
  for (const { value } of decidedRows) {
    const fid = value.findingId;
    if (!decidedByFinding[fid]) decidedByFinding[fid] = [];
    decidedByFinding[fid].push(value);
  }

  const pendingRows = await listStoredWithKeys("review-pending", orgId);
  const pendingFindingIds = new Set<string>();
  for (const { key } of pendingRows) pendingFindingIds.add(String(key[0]));

  for (const [findingId, decisions] of Object.entries(decidedByFinding)) {
    if (pendingFindingIds.has(findingId)) continue;
    const existing = await getStored("manager-queue", orgId, findingId);
    if (existing) continue;

    const confirmedFailures = decisions.filter((d) => d.decision === "confirm");
    if (confirmedFailures.length === 0) continue;

    const finding = await getFinding(orgId, findingId);
    if (!finding) continue;

    const completedAt = decisions.reduce((max, d) => Math.max(max, d.decidedAt), 0);

    const queueItem: ManagerQueueItem = {
      findingId,
      addedAt: Date.now(),
      status: "pending",
      ...enrichmentFromFinding(finding),
      failedCount: confirmedFailures.length,
      completedAt,
      jobTimestamp: (finding.job as { timestamp?: string } | undefined)?.timestamp ?? "",
    };

    await setStored("manager-queue", orgId, [findingId], queueItem);
    added++;
  }

  return { added };
}

export const backfillManagerQueueLegacy = backfillManagerQueue;
