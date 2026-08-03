/** Manager audit-history query — reproduces prod's handleManagerAuditsData.
 *
 *  Pulls completed-audit index entries within a time window, hydrates missing
 *  department/shift fields, scopes to the manager's allowed departments/shifts
 *  (admins see everything), enforces "manager sees only reviewed audits", then
 *  filters/paginates and decorates each row with reviewed + appeal status. */

import type { OrgId } from "@core/data/deno-kv/mod.ts";
import { shortQuestionLabel } from "@core/business/question-labels/mod.ts";
import type { AuditDoneIndexEntry } from "@core/dto/types.ts";
import { queryAuditDoneIndex, backfillSaleFlags } from "@audit/domain/data/stats-repository/mod.ts";
import { queryFailedFindings } from "@audit/domain/data/failed-finding-repository/mod.ts";
import { withTiming } from "@core/data/firestore/mod.ts";
import { getFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { getReviewedFindingIdsCached } from "@review/domain/business/review-queue/mod.ts";
import { getManagerScope, getOfficeBypassConfig } from "@admin/domain/data/admin-repository/mod.ts";
import { isOfficeBypassed } from "@audit/domain/business/chargeback-engine/mod.ts";
import { getAppeal } from "@judge/domain/data/judge-repository/mod.ts";

/** Offices the super-manager (president) role never sees. Matched
 *  case-insensitively as a substring via isOfficeBypassed(), so "JAY" also
 *  covers the whole family — JAY209, JAY123, "JAY Resort", etc. The
 *  super-manager view is "every department EXCEPT these". */
const SUPER_MANAGER_EXCLUDED_OFFICES = ["JAY"];

export interface AuditHistoryRow {
  findingId: string;
  ts: number;
  score: number;
  recordId?: string;
  isPackage?: boolean;
  voName?: string;
  owner?: string;
  department?: string;
  shift?: string;
  startedAt?: number;
  durationMs?: number;
  reason?: string;
  reviewed?: boolean;
  appealStatus?: string | null;
  /** Appeal state copied off the audit-done-idx row, when that row has it.
   *  Internal to this module — stripped before the response is built, which
   *  keeps `appealStatus` the single field the frontend reads. */
  indexAppealStatus?: "none" | "pending" | "complete";
  /** WGS/MCC sale flags. Undefined = legacy index row not yet backfilled. */
  wgs?: boolean;
  mcc?: boolean;
}

export interface AuditHistoryFilters {
  owner?: string;
  shift?: string;
  department?: string;
  reviewed?: string;          // "" | "yes" | "no" | "auto" | "invalid_genie"
  sale?: string;              // "" | "wgs" | "mcc" | "none" (neither sold)
  sort?: string;              // "" (most recent, default) | "fails" (score < 100 first)
  scoreMin?: number;
  scoreMax?: number;
  page?: number;
  limit?: number;
  since?: number;
  until?: number;
}

export interface AuditHistoryResult {
  items: AuditHistoryRow[];
  total: number;
  /** Average score across ALL filtered audits in the window (not just the
   *  current page), rounded to one decimal. Null when no audit has a score. */
  avgScore: number | null;
  /** Scored audits in the window, and how many of them hit PASS_SCORE.
   *  The filter bar reports the pass RATE off these (audits counted, not
   *  points averaged) — an audit passes only at a perfect score. Unscored
   *  audits are in `total` but in neither, so the two rates still sum to 100. */
  scoredCount: number;
  passedCount: number;
  /** WGS / MCC sale counts across ALL filtered audits in the window. */
  wgsCount: number;
  mccCount: number;
  /** Filtered audits whose sale flags aren't backfilled yet (legacy rows). */
  saleUnknownCount: number;
  /** Most-missed questions across the filtered window (top 3, from
   *  failed-finding-idx, restricted to the same finding set as total). */
  topMissed: Array<{ header: string; count: number }>;
  pages: number;
  page: number;
  owners: string[];
  shifts: string[];
  departments: string[];
  /** Per-department aggregates over the SAME filtered window as total /
   *  avgScore. Powers the Operations Portal's all-departments overview.
   *
   *  Computed here rather than by the caller because this function has
   *  already walked the whole window — the alternative (one audit-history
   *  call per department) is a read per department on a page load, the
   *  pattern that has taken prod down before. */
  deptRollup: DeptRollupRow[];
}

/** An audit "passes" only at a perfect score. That's this system's rule
 *  everywhere else (the terminate email prints Passed/Failed off
 *  `score === 100`, and the chargeback report treats `score < 100` as the
 *  failing set), so the Operations Portal must not invent a softer bar. */
const PASS_SCORE = 100;

/** Display name for an auditee, matching the queue's convention: the enriched
 *  voName first, else a real owner email's local-part. The pipeline writes the
 *  literal "api" as owner for API-triggered audits — that's not a person, so
 *  it can never be named the weakest team member. */
function auditeeLabel(row: { voName?: string; owner?: string }): string | null {
  if (row.voName) return row.voName;
  if (row.owner && row.owner !== "api") return row.owner.split("@")[0];
  return null;
}

export interface DeptRollupRow {
  department: string;
  /** Every audit in the window for this department, scored or not. */
  count: number;
  /** Audits that scored a perfect 100 / scored below it. Unscored audits are
   *  in `count` but in neither of these — they aren't yet a pass or a fail. */
  passed: number;
  failed: number;
  /** failed ÷ (passed + failed), as a percentage. Null when nothing is scored,
   *  so "no data" can't render as a reassuring 0% fail rate. */
  failPct: number | null;
  avgScore: number | null;
  /** Lowest-scoring auditee in this department. `audits` is carried so a
   *  one-bad-call outlier is visible rather than silently branded the
   *  weakest performer. Null when nobody has a scored audit. */
  worstMember: { name: string; avgScore: number; audits: number } | null;
  /** This department's three most-missed questions in the window. */
  topMissed: Array<{ header: string; count: number }>;
}

/** Bucket audits by department for the Operations Portal's overview. Pure, so
 *  it's testable without a Firestore round-trip.
 *
 *  Rows with no department are skipped rather than bucketed under "" — an
 *  audit we can't attribute must not invent a department row.
 *
 *  `failedRows` is the failed-question index for the same window (one row per
 *  failed question per audit). It's already fetched for the org-wide
 *  most-missed list, so reusing it here adds no reads. */
export function rollupByDepartment(
  rows: Array<{ findingId?: string; department?: string; score?: number | null; voName?: string; owner?: string }>,
  failedRows: Array<{ findingId: string; questionKey: string; header: string }> = [],
): DeptRollupRow[] {
  interface Bucket {
    sum: number; scored: number; count: number; passed: number; failed: number;
    members: Map<string, { sum: number; audits: number }>;
    missed: Map<string, { header: string; count: number }>;
  }
  const buckets = new Map<string, Bucket>();
  const deptOfFinding = new Map<string, string>();

  for (const row of rows) {
    const name = row.department ?? "";
    if (!name) continue;
    if (row.findingId) deptOfFinding.set(row.findingId, name);
    const bucket = buckets.get(name) ?? {
      sum: 0, scored: 0, count: 0, passed: 0, failed: 0,
      members: new Map(), missed: new Map(),
    };
    bucket.count++;
    if (typeof row.score === "number" && Number.isFinite(row.score)) {
      bucket.sum += row.score;
      bucket.scored++;
      if (row.score >= PASS_SCORE) bucket.passed++;
      else bucket.failed++;
      const member = auditeeLabel(row);
      if (member) {
        const m = bucket.members.get(member) ?? { sum: 0, audits: 0 };
        m.sum += row.score;
        m.audits++;
        bucket.members.set(member, m);
      }
    }
    buckets.set(name, bucket);
  }

  // Attribute each failed question to its audit's department.
  for (const fr of failedRows) {
    const name = deptOfFinding.get(fr.findingId);
    if (!name) continue;
    const bucket = buckets.get(name);
    if (!bucket) continue;
    const cur = bucket.missed.get(fr.questionKey) ?? { header: shortQuestionLabel(fr.header), count: 0 };
    cur.count++;
    bucket.missed.set(fr.questionKey, cur);
  }

  return [...buckets.entries()]
    .map(([department, b]) => {
      // Weakest = lowest average. Ties break toward the person with MORE
      // audits (the better-evidenced case), then by name for stability.
      let worstMember: DeptRollupRow["worstMember"] = null;
      for (const [name, m] of b.members) {
        const avg = Math.round((m.sum / m.audits) * 10) / 10;
        if (
          !worstMember || avg < worstMember.avgScore ||
          (avg === worstMember.avgScore && m.audits > worstMember.audits) ||
          (avg === worstMember.avgScore && m.audits === worstMember.audits && name.localeCompare(worstMember.name) < 0)
        ) {
          worstMember = { name, avgScore: avg, audits: m.audits };
        }
      }
      return {
        department,
        count: b.count,
        passed: b.passed,
        failed: b.failed,
        failPct: b.scored > 0 ? Math.round((b.failed / b.scored) * 1000) / 10 : null,
        avgScore: b.scored > 0 ? Math.round((b.sum / b.scored) * 10) / 10 : null,
        worstMember,
        topMissed: [...b.missed.values()].sort((x, y) => y.count - x.count).slice(0, 3),
      };
    })
    .sort((a, b) => a.department.localeCompare(b.department));
}

/** Decide whether the audit-done-idx row can answer "what's this audit's
 *  appeal state?" on its own, and what that answer renders as.
 *
 *  Pure + exported because this is the one spot where reading the cheap index
 *  instead of the live appeal doc could silently change a badge. `"none"` must
 *  map to null — the frontend renders a pill only for "pending"/"complete", so
 *  turning "none" into a truthy value would paint an appeal badge on audits
 *  that were never appealed. `undefined` means the row predates the stamped
 *  field and the caller must fall back to getAppeal(). */
export function appealStatusFromIndex(
  indexStatus: "none" | "pending" | "complete" | undefined,
): { resolved: true; status: "pending" | "complete" | null } | { resolved: false } {
  if (indexStatus === undefined) return { resolved: false };
  return { resolved: true, status: indexStatus === "none" ? null : indexStatus };
}

/** Hydrate rows with missing voName/owner/department/shift via getFinding(). */
async function hydrateMissing(orgId: OrgId, rows: AuditHistoryRow[]): Promise<AuditHistoryRow[]> {
  const needsHydration = rows.filter((r) => r.voName === undefined && r.owner === undefined);
  if (needsHydration.length === 0) return rows;
  const findings = await Promise.all(needsHydration.map((r) => getFinding(orgId, r.findingId)));
  const findingMap = new Map<string, Record<string, unknown>>();
  findings.forEach((f, i) => { if (f) findingMap.set(needsHydration[i].findingId, f as Record<string, unknown>); });
  return rows.map((r) => {
    if (r.voName !== undefined || r.owner !== undefined) return r;
    const f = findingMap.get(r.findingId);
    if (!f) return r;
    const rec = f.record as Record<string, unknown> | undefined;
    const isPkg = f.recordingIdField === "GenieNumber";
    const rawVo = String(rec?.VoName ?? "");
    const vo = rawVo.includes(" - ") ? rawVo.split(" - ").slice(1).join(" - ").trim() : rawVo.trim();
    return {
      ...r,
      isPackage: isPkg,
      voName: vo || undefined,
      owner: f.owner as string | undefined,
      department: String(isPkg ? (rec?.OfficeName ?? "") : (rec?.ActivatingOffice ?? "")) || undefined,
      shift: isPkg ? undefined : String(rec?.Shift ?? "") || undefined,
      startedAt: f.startedAt as number | undefined,
    };
  });
}

function toRow(e: AuditDoneIndexEntry): AuditHistoryRow {
  return {
    findingId: e.findingId,
    ts: e.completedAt,
    score: e.score,
    recordId: e.recordId,
    isPackage: e.isPackage,
    voName: e.voName,
    owner: e.owner,
    department: e.department,
    shift: e.shift,
    startedAt: e.startedAt,
    durationMs: e.durationMs,
    reason: e.reason,
    wgs: e.wgs,
    mcc: e.mcc,
    // Carried so the page slice can skip a per-row getAppeal() read. Stays
    // undefined on index rows written before appealStatus was stamped —
    // those still fall back to the live appeal doc. See `appeals` below.
    indexAppealStatus: e.appealStatus,
  };
}

/** Compute the manager-audit-history payload.
 *
 *  - role==="manager"       → restrict to scope (departments/shifts) and to
 *    reviewed audits (manually reviewed, perfect_score, or invalid_genie).
 *  - role==="super-manager" → every department EXCEPT the JAY family, still
 *    reviewed-only (the president's "manager view of all offices but JAY").
 *  - role==="admin"         → see everything in the window. */
export function getAuditHistory(
  orgId: OrgId,
  email: string,
  role: "admin" | "manager" | "super-manager",
  filters: AuditHistoryFilters,
): Promise<AuditHistoryResult> {
  return withTiming("getAuditHistory", () => _getAuditHistoryRaw(orgId, email, role, filters), { category: "db" });
}
async function _getAuditHistoryRaw(
  orgId: OrgId,
  email: string,
  role: "admin" | "manager" | "super-manager",
  filters: AuditHistoryFilters,
): Promise<AuditHistoryResult> {
  const owner = filters.owner ?? "";
  const shift = filters.shift ?? "";
  const department = filters.department ?? "";
  const reviewed = filters.reviewed ?? "";
  const sale = filters.sale ?? "";
  const scoreMin = Number.isFinite(filters.scoreMin) ? Number(filters.scoreMin) : 0;
  const scoreMax = Number.isFinite(filters.scoreMax) ? Number(filters.scoreMax) : 100;
  const page = Math.max(1, Number(filters.page) || 1);
  const limit = Math.min(100, Math.max(10, Number(filters.limit) || 50));
  const until = Number.isFinite(filters.until) ? Number(filters.until) : Date.now();
  const since = Number.isFinite(filters.since)
    ? Number(filters.since)
    : (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();

  const indexEntries = await queryAuditDoneIndex(orgId, since, until);
  // Lazy WGS/MCC backfill on legacy index rows — bounded to 20 findings per
  // request (this endpoint is user-triggered, not auto-polling); mutates the
  // cached entries in place and persists, converging one request at a time.
  try { await backfillSaleFlags(orgId, indexEntries, 20); }
  catch (err) { console.warn("⚠️ [MANAGER-AUDITS] sale-flag backfill skipped:", err); }
  const windowEntries: AuditHistoryRow[] = indexEntries.map(toRow).sort((a, b) => b.ts - a.ts);

  // Hydrate entries with missing department BEFORE scope filtering — old index
  // entries don't carry these fields and would otherwise be excluded.
  const needsHydrationForScope = windowEntries.filter((r) => r.department === undefined);
  if (needsHydrationForScope.length > 0) {
    const hydrated = await hydrateMissing(orgId, needsHydrationForScope);
    const hydratedMap = new Map(hydrated.map((r) => [r.findingId, r]));
    for (let i = 0; i < windowEntries.length; i++) {
      const h = hydratedMap.get(windowEntries[i].findingId);
      if (h) windowEntries[i] = h;
    }
  }

  // Bypassed offices (e.g. JAY) are hidden from EVERY view — admin and manager.
  const bypassCfg = await getOfficeBypassConfig(orgId);
  const bypassPatterns = bypassCfg.patterns ?? [];
  const afterBypass = bypassPatterns.length === 0
    ? windowEntries
    : windowEntries.filter((c) => !isOfficeBypassed(String(c.department ?? ""), bypassPatterns));

  // Scope to the manager's department+shift configuration; admin sees all.
  // Super-manager sees every department EXCEPT the JAY family — no per-manager
  // scope lookup, just the office exclusion.
  let scopedEntries = afterBypass;
  if (role === "manager") {
    const scope = await getManagerScope(orgId, email);
    scopedEntries = afterBypass.filter((c) => {
      if (scope.departments.length > 0 && !scope.departments.includes(c.department ?? "")) return false;
      if (scope.shifts.length > 0 && !c.isPackage && !scope.shifts.includes(c.shift ?? "")) return false;
      return true;
    });
  } else if (role === "super-manager") {
    scopedEntries = afterBypass.filter(
      (c) => !isOfficeBypassed(String(c.department ?? ""), SUPER_MANAGER_EXCLUDED_OFFICES),
    );
  }

  // Cached variant: this is a display read (the Reviewed column + the
  // manager "reviewed audits only" gate), not a payroll gate, so a bounded
  // staleness window beats paying the ~6s uncached scan on every page load.
  const reviewedIds = await getReviewedFindingIdsCached(orgId);
  const isReviewed = (c: AuditHistoryRow) =>
    reviewedIds.has(c.findingId) || c.reason === "perfect_score" || c.reason === "invalid_genie";

  // Managers and super-managers only see reviewed audits; admin sees all.
  const managerView = role === "manager" || role === "super-manager";
  const inWindow = scopedEntries.filter((c) => (!until || c.ts <= until) && (!managerView || isReviewed(c)));

  const filtered = inWindow.filter((c) => {
    if (owner && (c.voName || c.owner) !== owner) return false;
    if (shift && c.shift !== shift) return false;
    if (department && c.department !== department) return false;
    if (reviewed === "yes" && !reviewedIds.has(c.findingId)) return false;
    if (reviewed === "no" && (reviewedIds.has(c.findingId) || c.reason === "perfect_score" || c.reason === "invalid_genie")) return false;
    if (reviewed === "auto" && c.reason !== "perfect_score" && c.reason !== "invalid_genie") return false;
    if (reviewed === "invalid_genie" && c.reason !== "invalid_genie") return false;
    // Sale-type filter: rows with unknown flags (legacy, not yet backfilled)
    // never match a specific sale filter — they converge via backfillSaleFlags.
    if (sale === "wgs" && c.wgs !== true) return false;
    if (sale === "mcc" && c.mcc !== true) return false;
    if (sale === "none" && (c.wgs !== false || c.mcc !== false)) return false;
    if (c.score != null && (c.score < scoreMin || c.score > scoreMax)) return false;
    return true;
  });

  const owners = [...new Set(inWindow.map((c) => c.voName || c.owner).filter(Boolean))].sort() as string[];
  const shifts = [...new Set(inWindow.map((c) => c.shift).filter(Boolean))].sort() as string[];
  const departments = [...new Set(inWindow.map((c) => c.department).filter(Boolean))].sort() as string[];
  // "Lowest score first" sort: worst scores at the top, unscored rows at the
  // bottom, most recent first on ties. Sorts the WHOLE filtered window before
  // pagination so the worst audits land on page 1 no matter the window size.
  if (filters.sort === "fails") {
    filtered.sort((a, b) => ((a.score ?? Infinity) - (b.score ?? Infinity)) || (b.ts - a.ts));
  }

  const total = filtered.length;
  // Average score over every filtered audit in the window — the whole result
  // set, not just the page slice — so the stat matches "Total in window".
  const scores = filtered.map((c) => c.score).filter((s): s is number => typeof s === "number" && Number.isFinite(s));
  const passedCount = scores.filter((s) => s >= PASS_SCORE).length;
  const avgScore = scores.length > 0
    ? Math.round((scores.reduce((sum, s) => sum + s, 0) / scores.length) * 10) / 10
    : null;
  // WGS/MCC sale counts over the same filtered window as total/avgScore.
  const wgsCount = filtered.filter((c) => c.wgs === true).length;
  const mccCount = filtered.filter((c) => c.mcc === true).length;
  const saleUnknownCount = filtered.filter((c) => c.wgs === undefined).length;

  // Most-missed questions: one failed-finding-idx row per failed question per
  // audit, counted only for findings in the SAME filtered set as total /
  // avgScore — so the team-member/dept/shift/sale/score filters all apply.
  let topMissed: Array<{ header: string; count: number }> = [];
  // Hoisted so the per-department rollup can reuse the SAME rows for its own
  // top-3 — one failed-question query serves both. On failure it stays empty
  // and every top-3 list is simply absent; the rest of the rollup is fine.
  let failedRows: Array<{ findingId: string; questionKey: string; header: string }> = [];
  try {
    failedRows = await queryFailedFindings(orgId, since, until);
    const inSet = new Set(filtered.map((c) => c.findingId));
    const counts = new Map<string, { header: string; count: number }>();
    for (const r of failedRows) {
      if (!inSet.has(r.findingId)) continue;
      const cur = counts.get(r.questionKey) ?? { header: shortQuestionLabel(r.header), count: 0 };
      cur.count++;
      counts.set(r.questionKey, cur);
    }
    topMissed = [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 3);
  } catch (err) {
    console.warn("⚠️ [MANAGER-AUDITS] top-missed query skipped:", err);
  }
  // rollupByDepartment only counts failed rows whose finding is in `filtered`
  // (it maps findingId → department from those rows), so the same filters
  // apply here as to topMissed.
  const deptRollup = rollupByDepartment(filtered, failedRows);

  const pages = Math.max(1, Math.ceil(total / limit));
  const pageSlice = filtered.slice((page - 1) * limit, page * limit);
  const hydratedPage = await hydrateMissing(orgId, pageSlice);
  // Appeal state comes off the index row when it's stamped there — filing an
  // appeal re-stamps the row (file-appeal/mod.ts), as do completion, review,
  // judge and flip, so the index is kept current. Only rows written before
  // that field existed pay a live getAppeal() read, and they self-heal as the
  // window rolls forward. Same index-only pattern as the email report engine.
  const appeals = await Promise.all(hydratedPage.map(async (c) => {
    const fromIndex = appealStatusFromIndex(c.indexAppealStatus);
    if (fromIndex.resolved) return fromIndex.status;
    const live = await getAppeal(orgId, c.findingId);
    return live ? live.status : null;
  }));
  const items: AuditHistoryRow[] = hydratedPage.map((c, i) => {
    const { indexAppealStatus: _dropped, ...row } = c;
    return {
      ...row,
      reviewed: reviewedIds.has(c.findingId),
      appealStatus: appeals[i] ?? null,
    };
  });

  console.log(`🔍 [MANAGER-AUDITS] ${email} role=${role} → ${total}/${inWindow.length} in window, page=${page}/${pages}`);

  return { items, total, avgScore, scoredCount: scores.length, passedCount, wgsCount, mccCount, saleUnknownCount, topMissed, pages, page, owners, shifts, departments, deptRollup };
}
