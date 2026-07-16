/** Manager audit-history query — reproduces prod's handleManagerAuditsData.
 *
 *  Pulls completed-audit index entries within a time window, hydrates missing
 *  department/shift fields, scopes to the manager's allowed departments/shifts
 *  (admins see everything), enforces "manager sees only reviewed audits", then
 *  filters/paginates and decorates each row with reviewed + appeal status. */

import type { OrgId } from "@core/data/deno-kv/mod.ts";
import type { AuditDoneIndexEntry } from "@core/dto/types.ts";
import { queryAuditDoneIndex } from "@audit/domain/data/stats-repository/mod.ts";
import { withTiming } from "@core/data/firestore/mod.ts";
import { getFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { getReviewedFindingIds } from "@review/domain/business/review-queue/mod.ts";
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
}

export interface AuditHistoryFilters {
  owner?: string;
  shift?: string;
  department?: string;
  reviewed?: string;          // "" | "yes" | "no" | "auto" | "invalid_genie"
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
  pages: number;
  page: number;
  owners: string[];
  shifts: string[];
  departments: string[];
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
  const scoreMin = Number.isFinite(filters.scoreMin) ? Number(filters.scoreMin) : 0;
  const scoreMax = Number.isFinite(filters.scoreMax) ? Number(filters.scoreMax) : 100;
  const page = Math.max(1, Number(filters.page) || 1);
  const limit = Math.min(100, Math.max(10, Number(filters.limit) || 50));
  const until = Number.isFinite(filters.until) ? Number(filters.until) : Date.now();
  const since = Number.isFinite(filters.since)
    ? Number(filters.since)
    : (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();

  const indexEntries = await queryAuditDoneIndex(orgId, since, until);
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

  const reviewedIds = await getReviewedFindingIds(orgId);
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
  const avgScore = scores.length > 0
    ? Math.round((scores.reduce((sum, s) => sum + s, 0) / scores.length) * 10) / 10
    : null;
  const pages = Math.max(1, Math.ceil(total / limit));
  const pageSlice = filtered.slice((page - 1) * limit, page * limit);
  const hydratedPage = await hydrateMissing(orgId, pageSlice);
  const appeals = await Promise.all(hydratedPage.map((c) => getAppeal(orgId, c.findingId)));
  const items: AuditHistoryRow[] = hydratedPage.map((c, i) => ({
    ...c,
    reviewed: reviewedIds.has(c.findingId),
    appealStatus: appeals[i] ? appeals[i]!.status : null,
  }));

  console.log(`🔍 [MANAGER-AUDITS] ${email} role=${role} → ${total}/${inWindow.length} in window, page=${page}/${pages}`);

  return { items, total, avgScore, pages, page, owners, shifts, departments };
}
