/** Failed-finding index — one row per failed (answer "No") question, denormalized
 *  for the Failed Audits dashboard.
 *
 *  Collection `failed-finding-idx`, keyed [findingId, questionKey] with the
 *  finding's completedAt stored in the body so range scans reuse the same
 *  composite index (_type, _org, completedAt, __name__) as audit-done-idx — no
 *  new Firestore index required. The key is findingId-prefixed so per-finding
 *  rebuilds can prefix-scan and delete cheaply.
 *
 *  The finding doc's answeredQuestions[] stays the source of truth; these rows
 *  are an idempotent projection rebuilt per finding (delete-then-emit), so the
 *  same writer composes safely across finalize, review flips, judge decisions,
 *  re-audits, and backfills. */
import {
  setStored, deleteStored, listStoredByCompletedAt, listStoredByKeyPrefix, listStoredKeysAll,
} from "@core/data/firestore/mod.ts";
import { getFinding, saveFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { getHiddenFindingIds } from "@audit/domain/data/stats-repository/mod.ts";
import { normalizeQuestionKey, configKeyForFinding, yyyymm } from "@audit/domain/data/question-stats-repository/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";
import { shortQuestionLabel } from "@core/business/question-labels/mod.ts";
import type { FailedFindingIndexEntry, FailureSource, IAnsweredQuestion } from "@core/dto/types.ts";

const COLL = "failed-finding-idx";
const DEFENSE_CAP = 600;

function yesIs(a: unknown): boolean {
  return String(a ?? "").toLowerCase().startsWith("yes");
}

/** A question is a failure only when its final answer is a non-empty non-"Yes". */
function isFail(q: { answer?: unknown }): boolean {
  const a = String(q?.answer ?? "").trim().toLowerCase();
  return a.length > 0 && !a.startsWith("yes");
}

/** Auto-seed the root cause for a failed question from the signals already
 *  captured during review / judge. A human override (failureSourceBy set) always
 *  wins. Order: manual > autobot (bot miss corrected to a fail) > vo_app
 *  (recording / transcript fault) > team_member (a confirmed / upheld fail) >
 *  unknown (never reviewed). */
export function deriveFailureSource(q: Partial<IAnsweredQuestion>): FailureSource {
  if (q?.failureSourceBy && q?.failureSource) return q.failureSource;
  if (q?.reviewAction === "admin-flip") return "autobot";
  if (q?.judgeReason === "fragment" || q?.judgeReason === "transcript") return "vo_app";
  if (q?.reviewAction === "confirm" || q?.judgeAction === "uphold") return "team_member";
  return "unknown";
}

export interface WriteFailedRowsOpts {
  appealedQuestionKeys?: Set<string>;
  deniedQuestionKeys?: Set<string>;
}

/** Rebuild this finding's failure rows from its current answeredQuestions[].
 *  Idempotent: deletes the finding's existing rows, then emits one per final
 *  "No" question. Returns the number of rows written. */
export async function writeFailedFindingRows(
  orgId: OrgId, finding: Record<string, any>, opts?: WriteFailedRowsOpts,
): Promise<number> {
  const findingId = String(finding?.id ?? "");
  if (!findingId) return 0;
  await deleteFailedFindingRows(orgId, findingId);

  const answered = finding?.answeredQuestions as IAnsweredQuestion[] | undefined;
  if (!Array.isArray(answered) || answered.length === 0) return 0;

  const completedAt = Number(finding?.completedAt) || Date.now();
  const rec = (finding?.record ?? {}) as Record<string, unknown>;
  const isPackage = finding?.recordingIdField === "GenieNumber";
  const rawVo = String(rec.VoName ?? "");
  const voName = rawVo.includes(" - ") ? rawVo.split(" - ").slice(1).join(" - ").trim() : rawVo.trim();
  const department = String(isPackage ? (rec.OfficeName ?? "") : (rec.ActivatingOffice ?? "")).trim();
  const shift = isPackage ? "" : String(rec.Shift ?? "").trim();
  const cfgKey = configKeyForFinding(finding);
  const month = yyyymm(completedAt);
  const total = answered.length;
  const yes = answered.filter((q) => yesIs(q.answer)).length;
  const score = typeof finding?.score === "number" ? finding.score : (total ? Math.round((yes / total) * 100) : 0);

  let written = 0;
  for (const q of answered) {
    if (!isFail(q)) continue;
    const header = String(q.header ?? "").trim();
    if (!header) continue;
    const questionKey = normalizeQuestionKey(header);
    const entry: FailedFindingIndexEntry = {
      findingId,
      questionKey,
      header,
      completedAt,
      voName: voName || undefined,
      // Same derivation as buildIndexMeta — the two indexes must agree on who
      // a finding belongs to, or a person's audit list and their most-missed
      // questions would be scoped to different sets of people.
      employeeId: rec.RelatedEmployeeId != null ? String(rec.RelatedEmployeeId) : undefined,
      owner: typeof finding?.owner === "string" ? finding.owner : undefined,
      department: department || undefined,
      shift: shift || undefined,
      recordId: String(rec.RecordId ?? "") || undefined,
      recordingId: typeof finding?.recordingId === "string" ? finding.recordingId : undefined,
      isPackage,
      score,
      defense: String(q.defense ?? "").slice(0, DEFENSE_CAP) || undefined,
      failureSource: deriveFailureSource(q),
      appealed: opts?.appealedQuestionKeys?.has(questionKey) ?? undefined,
      appealDenied: opts?.deniedQuestionKeys?.has(questionKey) ?? undefined,
      configKey: cfgKey,
      yyyymm: month,
    };
    await setStored(COLL, orgId, [findingId, questionKey], entry);
    written++;
  }
  return written;
}

/** Remove all failure rows for a finding (prefix scan). Idempotent. */
export async function deleteFailedFindingRows(orgId: OrgId, findingId: string): Promise<number> {
  if (!findingId) return 0;
  const rows = await listStoredByKeyPrefix<FailedFindingIndexEntry>(COLL, orgId, findingId);
  for (const { key } of rows) await deleteStored(COLL, orgId, ...key);
  return rows.length;
}

export interface FailedFilters {
  voName?: string;
  /** Exact QuickBase employee id. Prefer this over voName when you mean ONE
   *  person — voName is a case-insensitive substring match, so "Mariah Brown"
   *  pulls in every Mariah Brown. */
  employeeId?: string;
  department?: string;
  shift?: string;
  header?: string;
  failureSource?: FailureSource;
  /** View 2: appealed AND the appeal was denied (the fail stuck). */
  appealedOnly?: boolean;
}

/** Range-scan failure rows, drop dedup-hidden findings, apply in-memory filters.
 *  voName / header are case-insensitive substring; department / shift are exact. */
export async function queryFailedFindings(
  orgId: OrgId, from: number, to: number, filters: FailedFilters = {},
): Promise<FailedFindingIndexEntry[]> {
  const rows = await listStoredByCompletedAt<FailedFindingIndexEntry>(
    COLL, orgId, from, to, { fieldName: "completedAt", limit: Number.MAX_SAFE_INTEGER },
  );
  const hidden = await getHiddenFindingIds(orgId);
  const eid = filters.employeeId?.trim();
  const v = filters.voName?.trim().toLowerCase();
  const dep = filters.department?.trim().toLowerCase();
  const sh = filters.shift?.trim().toLowerCase();
  const hd = filters.header?.trim().toLowerCase();
  const src = filters.failureSource;
  return rows.filter((r) => {
    if (hidden.has(r.findingId)) return false;
    // Exact, and deliberately no name fallback: matching on voName when the id
    // is missing would silently fold two same-named people back together.
    if (eid && r.employeeId !== eid) return false;
    if (v && !(r.voName ?? "").toLowerCase().includes(v)) return false;
    if (dep && (r.department ?? "").toLowerCase() !== dep) return false;
    if (sh && (r.shift ?? "").toLowerCase() !== sh) return false;
    // Match the stored header OR the name it displays under, so searching
    // "11% Service Fee" finds rows whose header is still "9% Service Fee".
    if (hd) {
      const raw = String(r.header ?? "");
      const shown = shortQuestionLabel(raw);
      if (!raw.toLowerCase().includes(hd) && !shown.toLowerCase().includes(hd)) return false;
    }
    if (src && r.failureSource !== src) return false;
    if (filters.appealedOnly && !(r.appealed && r.appealDenied)) return false;
    return true;
  });
}

/** Manual admin override of a failed question's source. Writes the finding doc
 *  (so the heuristic honors it forever) then rebuilds the index rows. */
export async function setQuestionFailureSource(
  orgId: OrgId, findingId: string, questionKey: string, source: FailureSource, by: string,
): Promise<{ ok: boolean }> {
  const finding = await getFinding(orgId, findingId);
  if (!finding) return { ok: false };
  const answered = (finding as Record<string, any>).answeredQuestions as IAnsweredQuestion[] | undefined;
  if (!Array.isArray(answered)) return { ok: false };
  let matched = false;
  for (const q of answered) {
    if (normalizeQuestionKey(String(q.header ?? "")) === questionKey) {
      q.failureSource = source;
      q.failureSourceBy = by;
      matched = true;
    }
  }
  if (!matched) return { ok: false };
  const updated = { ...finding, answeredQuestions: answered };
  await saveFinding(orgId, updated);
  await writeFailedFindingRows(orgId, updated);
  console.log(`✅ [FAILED-IDX] ${findingId}/${questionKey} source set to ${source} by ${by}`);
  return { ok: true };
}

/** Wipe the whole index for an org (for a clean re-backfill). */
export async function resetFailedFindingIndex(orgId: OrgId): Promise<number> {
  const keys = await listStoredKeysAll(COLL, orgId);
  for (const { key } of keys) await deleteStored(COLL, orgId, ...key);
  console.log(`⚠️ [FAILED-IDX] reset org=${orgId} removed=${keys.length}`);
  return keys.length;
}
