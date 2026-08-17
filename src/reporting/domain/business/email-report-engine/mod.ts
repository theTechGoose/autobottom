/** Report engine — consolidated query + render + send. */
/** Report query engine — evaluates criteria rules against finalized findings
 *  and returns structured section results for email rendering. */

import type { OrgId } from "@core/data/deno-kv/mod.ts";
import { queryAuditDoneIndex } from "@audit/domain/data/stats-repository/mod.ts";
import { getFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { getEmailTemplate, saveWeeklyReportView } from "@reporting/domain/data/email-repository/mod.ts";
import type {
  EmailReportConfig,
  DateRangeConfig,
  AuditDoneIndexEntry,
  CriteriaRule,
  ReportColumnKey,
  AppealRecord,
} from "@core/dto/types.ts";
import { getAppeal, listOpenAppealFindingIds } from "@judge/domain/data/judge-repository/mod.ts";
import { sendEmail } from "@reporting/domain/data/postmark/mod.ts";
import { queryFailedFindings } from "@audit/domain/data/failed-finding-repository/mod.ts";
import {
  claimedDepartments, normalizeDept, normalizeEmail, parseManagers, sectionForAbsorbed,
} from "@reporting/domain/business/manager-routing/mod.ts";
import { listEmailReportConfigs } from "@reporting/domain/data/email-repository/mod.ts";
import {
  buildDigest, renderDigestEmail, renderDigestPage, shortQuestionLabel,
} from "@reporting/domain/business/weekly-digest/mod.ts";
import type { DigestGroup } from "@reporting/domain/business/weekly-digest/mod.ts";
import {
  getReservationRidsForDateLegs,
  getReservationRidsForPackages,
  getMccIdsForReservations,
} from "@audit/domain/data/quickbase/mod.ts";

export type AppealStatus = "none" | "pending" | "complete";

// ── Manager routing lookups (cached; see manager-routing/mod.ts for the rules) ─

/** Which office codes some weekly report already claims. Cached briefly: all
 *  eleven reports fire in the same cron minute and ask the same question. */
let _claimedCache: { value: Set<string>; expiresAt: number } | null = null;
const CLAIMED_TTL_MS = 5 * 60_000;

export function _resetManagerRoutingCachesForTests(): void {
  _claimedCache = null;
  _managerCache.clear();
}

async function claimedDepartmentCodes(orgId: OrgId): Promise<Set<string>> {
  if (_claimedCache && _claimedCache.expiresAt > Date.now()) return _claimedCache.value;
  const configs = await listEmailReportConfigs(orgId);
  const value = claimedDepartments(configs);
  _claimedCache = { value, expiresAt: Date.now() + CLAIMED_TTL_MS };
  return value;
}

/** findingId → its VO managers. Only ever asked for audits in UNCLAIMED office
 *  codes (~10% of a week), so this never becomes the per-finding crawl that
 *  wedges prod — and the cache is keyed per finding, so the first report to run
 *  pays for the reads and the other ten hit memory. */
const _managerCache = new Map<string, { value: string[]; expiresAt: number }>();
const MANAGER_TTL_MS = 30 * 60_000;
/** Hard stop, so an unexpected flood of unmapped office codes can't turn a send
 *  into thousands of document reads. */
const MAX_MANAGER_LOOKUPS = 1500;

/** Same idea for the judge queue behind an "open-appeals" section — one
 *  getFinding per open appeal, bounded so a runaway queue can't turn a send into
 *  thousands of reads. */
const MAX_OPEN_APPEAL_LOOKUPS = 500;

async function managersForFindings(orgId: OrgId, findingIds: string[]): Promise<Map<string, string[]>> {
  const now = Date.now();
  const out = new Map<string, string[]>();
  const misses: string[] = [];
  for (const id of findingIds) {
    const hit = _managerCache.get(id);
    if (hit && hit.expiresAt > now) out.set(id, hit.value);
    else misses.push(id);
  }
  if (misses.length > MAX_MANAGER_LOOKUPS) {
    console.warn(`[EMAIL-REPORT] manager lookup capped at ${MAX_MANAGER_LOOKUPS} of ${misses.length} — some audits will not be routed by manager`);
    misses.length = MAX_MANAGER_LOOKUPS;
  }
  const BATCH = 20;
  for (let i = 0; i < misses.length; i += BATCH) {
    const batch = misses.slice(i, i + BATCH);
    const found = await Promise.all(batch.map(async (id) => {
      const finding = await getFinding(orgId, id) as Record<string, any> | null;
      return [id, parseManagers((finding?.record as any)?.SupervisorEmail)] as const;
    }));
    for (const [id, managers] of found) {
      _managerCache.set(id, { value: managers, expiresAt: now + MANAGER_TTL_MS });
      out.set(id, managers);
    }
  }
  return out;
}

// ── Public types ─────────────────────────────────────────────────────────────

export interface ReportRow {
  recordId?: string;
  findingId?: string;
  guestName?: string;
  voName?: string;
  department?: string;
  score?: number;
  appealStatus?: AppealStatus;
  finalizedAt?: number;
  markedForReview?: boolean;
  mostRecentActiveMccId?: string;
  /** Always populated (not column-driven) — the weekly digest groups by shift
   *  and counts invalid genies, and neither is ever a report column. Tables and
   *  CSV render `columns`, so carrying these costs nothing there. */
  shift?: string;
  invalidGenie?: boolean;
}

export interface SectionResult {
  header: string;
  columns: ReportColumnKey[];
  rows: ReportRow[];
}

// ── Date range resolution ─────────────────────────────────────────────────────

/** The weekly Monday→Sunday window is anchored to this wall-clock zone, so the
 *  week resets at Eastern midnight (DST-safe), not on the server's UTC clock. */
const WEEK_TZ = "America/New_York";

/** Wall-clock fields for `atMs` projected into `tz` (DST-safe via Intl).
 *  Exported so the weekly-sheets cron anchors its window to the same clock. */
export function tzParts(tz: string, atMs: number): {
  year: number; month: number; day: number; hour: number; minute: number; second: number; dow: number;
} {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric", weekday: "short", hour12: false,
  });
  const p = dtf.formatToParts(new Date(atMs));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  const wd: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  let hour = Number(get("hour"));
  if (hour === 24) hour = 0; // en-US returns "24" at midnight
  return {
    year: Number(get("year")), month: Number(get("month")), day: Number(get("day")),
    hour, minute: Number(get("minute")), second: Number(get("second")), dow: wd[get("weekday")] ?? 0,
  };
}

/** Epoch ms for a given wall-clock time in `tz` (DST-safe, with one edge-correction pass). */
export function zonedToMs(tz: string, y: number, mo: number, d: number, h: number, mi: number, s: number, ms: number): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s, ms);
  const offset = (a: number) => {
    // tz offsets are whole seconds and tzParts has no ms, so compare against
    // `a` floored to the second — otherwise the sub-second part leaks into the
    // offset and shifts the result (e.g. the .999 on a Sunday-23:59:59.999 end).
    const pr = tzParts(tz, a);
    return Date.UTC(pr.year, pr.month - 1, pr.day, pr.hour, pr.minute, pr.second) - Math.floor(a / 1000) * 1000;
  };
  let result = guess - offset(guess);
  if (offset(result) !== offset(guess)) result = guess - offset(result);
  return result;
}

export function resolveDateRange(
  dateRange: DateRangeConfig | undefined,
  nowMs: number = Date.now(),
): { from: number; to: number } {
  if (!dateRange) {
    // Default: rolling 24 hours (backward compat for old configs)
    return { from: nowMs - 86_400_000, to: nowMs };
  }
  if (dateRange.mode === "rolling") {
    return { from: nowMs - dateRange.hours * 3_600_000, to: nowMs };
  }
  if (dateRange.mode === "weekly") {
    // The reporting week is startDay-anchored (Monday), but the window ENDS at the
    // end of YESTERDAY — not "now". These reports go out each morning at 9am, before
    // anyone is on the phones, so "today" carries no data worth showing. Anchoring
    // the week on yesterday (not today) is also what makes the Monday send report the
    // week that just finished: on Monday, yesterday is Sunday, which still belongs to
    // last week's Mon→Sun. On Tuesday, yesterday is Monday, so the window resets to a
    // fresh week (just Monday) and then accumulates day by day through the week.
    const today = tzParts(WEEK_TZ, nowMs);
    const to = zonedToMs(WEEK_TZ, today.year, today.month, today.day, 0, 0, 0, 0) - 1; // 23:59:59.999 ET, yesterday
    const ref = tzParts(WEEK_TZ, to); // the day the window ends on (yesterday)
    const diff = (ref.dow - dateRange.startDay + 7) % 7; // days from the week's start day up to `ref`
    const startCal = new Date(Date.UTC(ref.year, ref.month - 1, ref.day));
    startCal.setUTCDate(startCal.getUTCDate() - diff);
    const from = zonedToMs(WEEK_TZ, startCal.getUTCFullYear(), startCal.getUTCMonth() + 1, startCal.getUTCDate(), 0, 0, 0, 0);
    return { from, to };
  }
  // fixed
  return { from: dateRange.from, to: dateRange.to };
}

/** The "Week of M/D–M/D" label used in the weekly report subject line. Always
 *  names the FULL reporting week (Mon→Sun), even though the body only accumulates
 *  through yesterday — so the label reads naturally every day and the Monday send
 *  is titled with the just-finished week's dates. Both ends are derived from the
 *  week's Monday (resolveDateRange's `from`), NOT the through-yesterday `to`, and
 *  formatted in Eastern (WEEK_TZ) so neither end rolls a day via UTC. Pure +
 *  exported for unit testing. */
export function weeklySubjectRange(
  dateRange: DateRangeConfig | undefined,
  nowMs: number = Date.now(),
): string {
  const { from } = resolveDateRange(dateRange, nowMs);
  const startP = tzParts(WEEK_TZ, from);
  const startCal = new Date(Date.UTC(startP.year, startP.month - 1, startP.day));
  const endCal = new Date(startCal);
  endCal.setUTCDate(endCal.getUTCDate() + 6);
  const fmt = (d: Date) => (d.getUTCMonth() + 1) + "/" + d.getUTCDate();
  return "Week of " + fmt(startCal) + "–" + fmt(endCal);
}

/** The long-form week label at the top of a weekly report body:
 *  "Week of Jul 13 – Jul 19, 2026". Names the same full Mon→Sun week as the
 *  subject line, just spelled out for a header rather than a subject. */
export function weeklyHeadline(
  dateRange: DateRangeConfig | undefined,
  nowMs: number = Date.now(),
): string {
  const { from } = resolveDateRange(dateRange, nowMs);
  const startP = tzParts(WEEK_TZ, from);
  const startCal = new Date(Date.UTC(startP.year, startP.month - 1, startP.day));
  const endCal = new Date(startCal);
  endCal.setUTCDate(endCal.getUTCDate() + 6);
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmt = (d: Date) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return `Week of ${fmt(startCal)} – ${fmt(endCal)}, ${endCal.getUTCFullYear()}`;
}

// ── Record-level dedup ────────────────────────────────────────────────────────

/** A real, dedup-able record id, or "" for blank / placeholder ids that must NOT
 *  be collapsed together (empty, or all-zeros like "00000000"). */
function normalizeRecordId(recordId: string | undefined): string {
  const v = String(recordId ?? "").trim();
  return v === "" || /^0+$/.test(v) ? "" : v;
}

/** True if `a` is the "newer" finding to keep: greater completedAt wins, and an
 *  EXACT completedAt tie is broken by the greater findingId — so the survivor is
 *  deterministic and never depends on input order. */
function isNewerFinding(a: AuditDoneIndexEntry, b: AuditDoneIndexEntry): boolean {
  const at = a.completedAt ?? 0;
  const bt = b.completedAt ?? 0;
  if (at !== bt) return at > bt;
  return (a.findingId ?? "") > (b.findingId ?? "");
}

/** Keep only the newest finding per REAL recordId; drop the rest. Rows with a
 *  blank/placeholder recordId pass through untouched (they aren't duplicates of
 *  one another). This is what removes a nullified audit once a re-audit — a
 *  newer finding on the same record — exists. Surviving rows stay in their
 *  ORIGINAL order (the index's completedAt order): dedup drops superseded rows
 *  in place rather than reshuffling, since queryReportData renders rows in this
 *  order without re-sorting. Pure + exported for unit testing. */
export function dedupeByRecordKeepNewest(entries: AuditDoneIndexEntry[]): AuditDoneIndexEntry[] {
  // First pass: pick the single winning finding per real recordId.
  const winnerByRecord = new Map<string, AuditDoneIndexEntry>();
  for (const e of entries) {
    const rid = normalizeRecordId(e.recordId);
    if (!rid) continue;
    const cur = winnerByRecord.get(rid);
    if (!cur || isNewerFinding(e, cur)) winnerByRecord.set(rid, e);
  }
  // Second pass: emit passthrough rows + each record's winner at its own
  // position, preserving input order. (=== identity matches exactly one entry,
  // so a record contributes exactly one row.)
  return entries.filter((e) => {
    const rid = normalizeRecordId(e.recordId);
    return !rid || winnerByRecord.get(rid) === e;
  });
}

// ── Main entry point ─────────────────────────────────────────────────────────

export async function queryReportData(
  orgId: OrgId,
  config: EmailReportConfig,
): Promise<SectionResult[]> {
  const sections = config.reportSections ?? [];
  if (sections.length === 0) return [];

  const onlyCompleted = config.onlyCompleted ?? true;
  const { from, to } = resolveDateRange(config.dateRange);

  // Scan index by completedAt. For onlyCompleted=true, the actual doneAt filter
  // is applied below in code — the scan range is intentionally wider to catch
  // audits bot-finalized before the window that were reviewed within it.
  const indexEntries = await queryAuditDoneIndex(orgId, from, to);

  // Apply master filter
  let candidates: AuditDoneIndexEntry[] = onlyCompleted
    ? indexEntries.filter(
        (e) => e.completed && e.doneAt !== undefined && e.doneAt >= from && e.doneAt <= to,
      )
    : indexEntries;

  // Collapse re-audited / duplicate rows: keep only the newest finding per real
  // recordId. This drops a nullified audit (e.g. a 0% later re-submitted with new
  // audio) once its re-audit — a newer finding on the same record — is present,
  // so superseded findings don't pollute the report. Runs BEFORE failedOnly so a
  // record re-audited from fail→pass is judged on its newest result.
  candidates = dedupeByRecordKeepNewest(candidates);

  // Weekly: only failed audits
  if (config.failedOnly) {
    candidates = candidates.filter((e) => e.score < 100);
  }

  const results: any[] = sections.map((s) => ({
    header: s.header,
    columns: s.columns,
    rows: [],
  }));

  // A weekly report renders the digest, not the columns the config happens to
  // list, so extract everything the digest needs even when a section omits it.
  // `columns` (what tables and the CSV render) is untouched.
  const DIGEST_FIELDS: ReportColumnKey[] = ["voName", "score", "recordId", "findingId", "finalizedAt"];
  const extractColumns: ReportColumnKey[][] = sections.map((s) =>
    config.weeklyType
      ? [...new Set([...(s.columns as ReportColumnKey[]), ...DIGEST_FIELDS])]
      : (s.columns as ReportColumnKey[]),
  );

  const needsMcc = sections.some((s) => s.columns.includes("mostRecentActiveMccId"));
  const mccRowMeta: { sectionIdx: number; rowIdx: number; recordId: string; isPackage: boolean }[] = [];

  // The finding doc is only needed for question-level criteria
  // (questionHeader / questionAnswer) or the guestName column. Otherwise every
  // field the report uses is on the index row, so we synthesize a minimal
  // finding + appeal from the entry and skip getFinding/getAppeal entirely.
  // The downstream filter/extract code runs identically against the synthetic
  // docs — this is what removes the per-finding crawl at send time.
  const needsFinding = reportNeedsFinding(config);
  const HYDRATE_BATCH = 20;
  const hydrated: { entry: AuditDoneIndexEntry; finding: Awaited<ReturnType<typeof getFinding>>; appealRecord: Awaited<ReturnType<typeof getAppeal>> }[] = [];
  for (let i = 0; i < candidates.length; i += HYDRATE_BATCH) {
    const batch = candidates.slice(i, i + HYDRATE_BATCH);
    const batchHydrated = await Promise.all(batch.map(async (entry) => {
      if (needsFinding) {
        const [finding, appealRecord] = await Promise.all([
          getFinding(orgId, entry.findingId),
          getAppeal(orgId, entry.findingId),
        ]);
        return { entry, finding, appealRecord };
      }
      // Index-only: appeal is read ONLY for rows written before appealStatus was
      // stamped (transitional — they self-heal as the weekly window rolls past
      // the deploy). Stamped rows need no DB read at all.
      const appealRecord = entry.appealStatus !== undefined
        ? syntheticAppealFromStatus(entry.appealStatus)
        : await getAppeal(orgId, entry.findingId);
      return { entry, finding: syntheticFindingFromEntry(entry) as Awaited<ReturnType<typeof getFinding>>, appealRecord };
    }));
    hydrated.push(...batchHydrated);
  }

  const topFilters = (config as any).topLevelFilters ?? [];

  // Manager routing: audits whose office code NO weekly report claims follow
  // their VO manager into this report. Claimed office codes are untouched, so a
  // manager who spans reports stays split exactly as the department rule has
  // them. Absorbed rows are placed after the main pass, once we know which
  // section already holds each manager's work.
  const routeByManager = !!config.weeklyManagers?.length;
  const claimed = routeByManager ? await claimedDepartmentCodes(orgId) : new Set<string>();
  const myManagers = new Set((config.weeklyManagers ?? []).map(normalizeEmail));
  // The manager lives on the audit document, not the index row, so it is read
  // ONLY for the unclaimed office codes — the audits that actually need routing.
  const managersByFinding = routeByManager
    ? await managersForFindings(
      orgId,
      candidates.filter((e) => !claimed.has(normalizeDept(e.department))).map((e) => e.findingId),
    )
    : new Map<string, string[]>();
  /** manager email → section index → rows already routed there by department. */
  const managerSectionCounts = new Map<string, Map<number, number>>();
  const pendingAbsorbed: { finding: Record<string, any>; stat: Record<string, any>; appealStatus: AppealStatus; markedForReview: boolean; managers: string[] }[] = [];

  for (const { entry, finding, appealRecord } of hydrated) {
    if (!finding) continue;

    const isPackage = finding.recordingIdField === "GenieNumber";
    const rawVoName = (finding.record as any)?.VoName as string | undefined;
    const voName = rawVoName
      ? (rawVoName.includes(" - ")
          ? rawVoName.split(" - ").slice(1).join(" - ").trim()
          : rawVoName.trim()) || undefined
      : undefined;
    const department =
      String(isPackage
        ? ((finding.record as any)?.OfficeName ?? "")
        : ((finding.record as any)?.ActivatingOffice ?? "")) || undefined;

    const stat: Record<string, any> = {
      isPackage,
      score: entry.score,
      reason: entry.reason ?? "",
      voName: voName ?? "",
      department: department ?? "",
      recordId: String((finding.record as any)?.RecordId ?? "") || undefined,
      shift: String((finding.record as any)?.Shift ?? "") || undefined,
      ts: entry.completedAt,
    };

    const reviewed = entry.reason === "reviewed";

    const appealStatus: AppealStatus = !appealRecord
      ? "none"
      : appealRecord.status === "pending"
      ? "pending"
      : "complete";

    if (topFilters.length > 0) {
      if (!evaluateRules(finding, stat, appealStatus, reviewed, topFilters)) continue;
    }

    const markedForReview = !onlyCompleted && !entry.completed && entry.score > 0;
    const managers = routeByManager
      ? (managersByFinding.get(entry.findingId) ?? parseManagers((finding.record as any)?.SupervisorEmail))
      : [];

    let placed = false;
    for (let i = 0; i < sections.length; i++) {
      // Open-appeals sections are filled from the judge queue below, not from
      // this window's index rows.
      if (sections[i].source === "open-appeals") continue;
      if (evaluateRules(finding, stat, appealStatus, reviewed, sections[i].criteria)) {
        placed = true;
        const rowIdx = results[i].rows.length;
        results[i].rows.push(extractRow(finding, stat, appealStatus, extractColumns[i], markedForReview));
        if (needsMcc && sections[i].columns.includes("mostRecentActiveMccId") && stat.recordId) {
          mccRowMeta.push({ sectionIdx: i, rowIdx, recordId: stat.recordId, isPackage });
        }
        for (const m of managers) {
          const counts = managerSectionCounts.get(m) ?? new Map<number, number>();
          counts.set(i, (counts.get(i) ?? 0) + 1);
          managerSectionCounts.set(m, counts);
        }
      }
    }

    // No section wanted it. If nobody claims its office code and one of its
    // managers is ours, hold it for placement below.
    if (
      !placed && routeByManager &&
      !claimed.has(normalizeDept(stat.department)) &&
      managers.some((m) => myManagers.has(m))
    ) {
      pendingAbsorbed.push({ finding, stat, appealStatus, markedForReview, managers });
    }
  }

  for (const p of pendingAbsorbed) {
    const i = sectionForAbsorbed(p.managers, managerSectionCounts, results.map((r: any) => r.rows.length));
    if (i < 0) continue;
    // Never absorb an audit into the judge-queue section — it is a live backlog
    // list, not a bucket for unrouted work.
    if (sections[i].source === "open-appeals") continue;
    const rowIdx = results[i].rows.length;
    results[i].rows.push(extractRow(p.finding, p.stat, p.appealStatus, extractColumns[i], p.markedForReview));
    if (needsMcc && sections[i].columns.includes("mostRecentActiveMccId") && p.stat.recordId) {
      mccRowMeta.push({ sectionIdx: i, rowIdx, recordId: p.stat.recordId, isPackage: p.stat.isPackage });
    }
  }
  if (pendingAbsorbed.length > 0) {
    console.log(`[EMAIL-REPORT] "${config.name}" absorbed ${pendingAbsorbed.length} audit(s) by manager (office code claimed by no report)`);
  }

  // Open-appeals sections: the live judge queue, at any age, ignoring the
  // report's date window. Filled after the index pass so it can't be perturbed
  // by dedup or the manager routing above.
  for (let i = 0; i < sections.length; i++) {
    if (sections[i].source !== "open-appeals") continue;
    results[i].rows = await queryOpenAppealRows(
      orgId, topFilters, sections[i].criteria, extractColumns[i],
    );
  }

  if (needsMcc && mccRowMeta.length > 0) {
    const dateLegRids = new Set<string>();
    const packageRids = new Set<string>();
    for (const m of mccRowMeta) {
      (m.isPackage ? packageRids : dateLegRids).add(m.recordId);
    }
    const [dlMap, pkgMap] = await Promise.all([
      getReservationRidsForDateLegs([...dateLegRids]),
      getReservationRidsForPackages([...packageRids]),
    ]);
    const childToParent = new Map<string, string>();
    for (const [c, p] of dlMap) childToParent.set(c, p);
    for (const [c, p] of pkgMap) childToParent.set(c, p);
    const reservationRids = [...new Set(childToParent.values())];
    const mccMap = await getMccIdsForReservations(reservationRids);
    for (const m of mccRowMeta) {
      const parent = childToParent.get(m.recordId);
      if (!parent) continue;
      const mcc = mccMap.get(parent);
      if (mcc) results[m.sectionIdx].rows[m.rowIdx].mostRecentActiveMccId = mcc;
    }
  }

  // Weekly reports list audits worst-first (0% → 100%) so failures surface at
  // the top of each section — and so the email's row-trim keeps the worst ones.
  // Runs last, after MCC write-backs resolve their captured row indices. Other
  // report types keep their natural (completedAt) order.
  if (config.weeklyType) {
    for (const section of results) sortRowsFailsFirst(section.rows as ReportRow[]);
  }

  return results;
}

/** Rows for an "open-appeals" section: every finding still sitting in the judge
 *  queue, at any age, scoped by the same filters an ordinary section uses.
 *
 *  The queue is small by nature (a judge works it down; it held 2 rows org-wide
 *  on 2026-08-17), so a getFinding per appeal is cheap — but it is a live queue,
 *  so the lookup is capped and batched like every other hydration path here
 *  rather than trusted to stay small forever. */
async function queryOpenAppealRows(
  orgId: OrgId,
  topFilters: CriteriaRule[],
  criteria: CriteriaRule[],
  columns: ReportColumnKey[],
): Promise<ReportRow[]> {
  const findingIds = await listOpenAppealFindingIds(orgId);
  if (findingIds.length === 0) return [];

  const capped = findingIds.slice(0, MAX_OPEN_APPEAL_LOOKUPS);
  if (findingIds.length > capped.length) {
    console.warn(
      `[EMAIL-REPORT] open-appeals capped at ${capped.length} of ${findingIds.length} — the section under-reports`,
    );
  }

  const rows: ReportRow[] = [];
  const BATCH = 20;
  for (let i = 0; i < capped.length; i += BATCH) {
    const batch = await Promise.all(
      capped.slice(i, i + BATCH).map((id) => getFinding(orgId, id)),
    );
    for (const finding of batch as Record<string, any>[]) {
      if (!finding) continue;
      const isPackage = finding.recordingIdField === "GenieNumber";
      const rec = (finding.record ?? {}) as Record<string, any>;
      const rawVoName = rec.VoName as string | undefined;
      const stat: Record<string, any> = {
        isPackage,
        score: scoreOfFinding(finding),
        reason: "",
        voName: rawVoName
          ? (rawVoName.includes(" - ") ? rawVoName.split(" - ").slice(1).join(" - ").trim() : rawVoName.trim())
          : "",
        department: String(isPackage ? (rec.OfficeName ?? "") : (rec.ActivatingOffice ?? "")),
        recordId: String(rec.RecordId ?? "") || undefined,
        shift: String(rec.Shift ?? "") || undefined,
        ts: finding.appealedAt ?? finding.completedAt ?? undefined,
      };
      // These are by definition awaiting a judge, so appealStatus is "pending"
      // regardless of what the (possibly stale) index row says.
      if (topFilters.length > 0 && !evaluateRules(finding, stat, "pending", false, topFilters)) continue;
      if (!evaluateRules(finding, stat, "pending", false, criteria)) continue;
      rows.push(extractRow(finding, stat, "pending", columns, false));
    }
  }
  return rows;
}

/** A finding's score, mirroring failed-finding-repository: the stored score when
 *  present, else recomputed from the answered questions. */
function scoreOfFinding(finding: Record<string, any>): number {
  if (typeof finding?.score === "number") return finding.score;
  const answered: any[] = finding?.answeredQuestions ?? [];
  if (answered.length === 0) return 0;
  const yes = answered.filter((q) => String(q?.answer ?? "").toLowerCase() === "yes").length;
  return Math.round((yes / answered.length) * 100);
}

/** Order rows worst-first (0% → 100%); ties break most-recent-first. Mutates in
 *  place and returns the same array. Pure + exported for unit testing. */
export function sortRowsFailsFirst(rows: ReportRow[]): ReportRow[] {
  return rows.sort((a, b) => {
    const sa = a.score ?? Number.POSITIVE_INFINITY;
    const sb = b.score ?? Number.POSITIVE_INFINITY;
    if (sa !== sb) return sa - sb;
    return (b.finalizedAt ?? 0) - (a.finalizedAt ?? 0);
  });
}

/** A report only needs the (heavy) finding doc when it filters on question-level
 *  criteria (questionHeader / questionAnswer) or renders the guestName column.
 *  Everything else lives on the index row. */
function reportNeedsFinding(config: EmailReportConfig): boolean {
  const rules: CriteriaRule[] = [
    ...((config as any).topLevelFilters ?? []),
    ...(config.reportSections ?? []).flatMap((s) => s.criteria ?? []),
  ];
  if (rules.some((r) => r.field === "questionHeader" || r.field === "questionAnswer")) return true;
  const columns = (config.reportSections ?? []).flatMap((s) => s.columns ?? []);
  return columns.includes("guestName");
}

/** Minimal finding shaped so the existing stat-derivation + extractRow produce
 *  the same values they would from a real finding — sourced entirely from the
 *  index row. Only used when reportNeedsFinding(config) is false. */
function syntheticFindingFromEntry(entry: AuditDoneIndexEntry): Record<string, any> {
  return {
    id: entry.findingId,
    recordingIdField: entry.isPackage ? "GenieNumber" : undefined,
    record: {
      RecordId: entry.recordId,
      VoName: entry.voName,
      ...(entry.isPackage ? { OfficeName: entry.department } : { ActivatingOffice: entry.department }),
      Shift: entry.shift,
    },
  };
}

function syntheticAppealFromStatus(status: "none" | "pending" | "complete"): AppealRecord | null {
  if (status === "none") return null;
  return { findingId: "", appealedAt: 0, status: status === "complete" ? "complete" : "pending" };
}

// ── Criteria evaluator ───────────────────────────────────────────────────────

export function evaluateRules(
  finding: Record<string, any>,
  stat: Record<string, any>,
  appealStatus: AppealStatus,
  reviewed: boolean,
  rules: CriteriaRule[],
): boolean {
  if (rules.length === 0) return true;

  const questionRules = rules.filter(
    (r) => r.field === "questionHeader" || r.field === "questionAnswer",
  );
  const otherRules = rules.filter(
    (r) => r.field !== "questionHeader" && r.field !== "questionAnswer",
  );

  // Non-question rules: all must pass
  for (const rule of otherRules) {
    if (!evaluateScalarRule(stat, appealStatus, reviewed, rule)) return false;
  }

  // Question rules: at least one question must satisfy all question rules
  // simultaneously (same question must match header AND answer)
  if (questionRules.length > 0) {
    const answered: any[] = finding.answeredQuestions ?? [];
    const headerRules = questionRules.filter((r) => r.field === "questionHeader");
    const answerRules = questionRules.filter((r) => r.field === "questionAnswer");

    const anyMatch = answered.some((q) => {
      const headerOk = headerRules.every((r) => applyOperator(q.header ?? "", r));
      const answerOk = answerRules.every((r) => applyOperator(q.answer ?? "", r));
      return headerOk && answerOk;
    });

    if (!anyMatch) return false;
  }

  return true;
}

function evaluateScalarRule(
  stat: Record<string, any>,
  appealStatus: AppealStatus,
  reviewed: boolean,
  rule: CriteriaRule,
): boolean {
  if (rule.field === "appealStatus") {
    return applyOperator(appealStatus, rule);
  }

  if (rule.field === "auditType") {
    const resolved = stat.isPackage ? "partner" : "internal";
    return applyOperator(resolved, rule);
  }

  if (rule.field === "reviewed") {
    return applyOperator(String(reviewed), rule);
  }

  const raw = stat[rule.field];

  if (rule.operator === "less_than" || rule.operator === "greater_than") {
    const num = parseFloat(String(raw ?? ""));
    const target = parseFloat(rule.value);
    if (isNaN(num) || isNaN(target)) return false;
    return rule.operator === "less_than" ? num < target : num > target;
  }

  return applyOperator(String(raw ?? ""), rule);
}

function applyOperator(value: string, rule: CriteriaRule): boolean {
  const v = value.toLowerCase();
  const t = rule.value.toLowerCase();

  switch (rule.operator) {
    case "equals":       return v === t;
    case "not_equals":   return v !== t;
    case "contains":     return v.includes(t);
    case "not_contains": return !v.includes(t);
    case "starts_with":  return v.startsWith(t);
    default:             return false;
  }
}

// ── Row extractor ─────────────────────────────────────────────────────────────

function extractRow(
  finding: Record<string, any>,
  stat: Record<string, any>,
  appealStatus: AppealStatus,
  columns: ReportColumnKey[],
  markedForReview: boolean,
): ReportRow {
  const row: ReportRow = {};
  if (markedForReview) row.markedForReview = true;

  // Digest fields — set regardless of the configured columns (see ReportRow).
  row.shift = stat.shift || undefined;
  row.invalidGenie = stat.reason === "invalid_genie";

  for (const col of columns) {
    switch (col) {
      case "recordId":
        row.recordId = finding.record?.["RecordId"]
          ?? finding.record?.["Record ID#"]
          ?? stat.recordId
          ?? undefined;
        break;
      case "findingId":
        row.findingId = finding.id ?? undefined;
        break;
      case "guestName":
        row.guestName = finding.record?.["GuestName"]
          ?? finding.record?.["32"]
          ?? undefined;
        break;
      case "voName":
        row.voName = stat.voName || finding.record?.["VoName"] || undefined;
        break;
      case "department":
        row.department = stat.department || finding.record?.["Department"] || undefined;
        break;
      case "score":
        row.score = stat.score ?? undefined;
        break;
      case "appealStatus":
        row.appealStatus = appealStatus;
        break;
      case "finalizedAt":
        row.finalizedAt = stat.ts ?? undefined;
        break;
      case "markedForReview":
        // value already set above from the markedForReview param; no-op here
        break;
    }
  }

  return row;
}

// ── CSV export ────────────────────────────────────────────────────────────────

function csvEscape(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function cellPlainValue(col: ReportColumnKey, row: ReportRow): string {
  switch (col) {
    case "recordId":              return row.recordId ?? "";
    case "findingId":             return row.findingId ?? "";
    case "guestName":             return row.guestName ?? "";
    case "voName":                return row.voName ?? "";
    case "department":            return row.department ?? "";
    case "score":                 return row.score != null ? String(row.score) : "";
    case "appealStatus":          return row.appealStatus ? APPEAL_LABELS[row.appealStatus] : "";
    case "finalizedAt":           return row.finalizedAt ? formatEst(row.finalizedAt) : "";
    case "markedForReview":       return row.markedForReview ? "In Review" : "Complete";
    case "mostRecentActiveMccId": return row.mostRecentActiveMccId ?? "";
    default: {
      const val = row[col as keyof ReportRow];
      return val != null ? String(val) : "";
    }
  }
}

export function buildCsv(sections: SectionResult[]): string {
  const allCols: ReportColumnKey[] = [];
  for (const s of sections) {
    for (const c of s.columns) {
      if (!allCols.includes(c)) allCols.push(c);
    }
  }
  // The id columns stay clean (just "485817") so the data imports cleanly; the
  // clickable links live in their own appended URL columns.
  const hasRecord = allCols.includes("recordId");
  const hasFinding = allCols.includes("findingId");
  const urlHeaders = [
    ...(hasRecord ? ["Record ID URL"] : []),
    ...(hasFinding ? ["Audit Report URL"] : []),
  ];
  const header = ["Section", ...allCols.map((c) => COLUMN_LABELS[c]), ...urlHeaders].map(csvEscape).join(",");
  const lines = [header];
  for (const s of sections) {
    for (const row of s.rows) {
      const urlCells = [
        ...(hasRecord ? [row.recordId ? recordUrl(row.recordId) : ""] : []),
        ...(hasFinding ? [row.findingId ? findingUrl(row.findingId) : ""] : []),
      ];
      const cells = [s.header, ...allCols.map((c) => cellPlainValue(c, row)), ...urlCells];
      lines.push(cells.map(csvEscape).join(","));
    }
  }
  return lines.join("\r\n") + "\r\n";
}

function safeFilename(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "report";
}

function toBase64Utf8(s: string): string {
  return btoa(unescape(encodeURIComponent(s)));
}

// ── "View full report" page: slug + size-aware email body ─────────────────────

/** Gmail clips the inbox view around ~102 KB. Stay under this with a margin; a
 *  bigger report trims what it shows inline and links to the full page. */
const EMAIL_INLINE_LIMIT = 90 * 1024;

/** Deterministic, unguessable slug for a report's weekly page — same report +
 *  same week → same slug, so every daily send links to (and overwrites) one
 *  page instead of piling up a copy per send. */
export async function weeklyReportSlug(orgId: string, configId: string, weekFromMs: number): Promise<string> {
  const bytes = new TextEncoder().encode(`${orgId}|${configId}|${weekFromMs}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** "View full report" button block — inline-styled so it survives Gmail. */
function renderLightViewLinkBlock(url: string, note?: string): string {
  return `
<div style="margin:8px 0 20px 0;text-align:center;">
  ${note ? `<p style="margin:0 0 12px 0;font-size:13px;color:#59636e;">${esc(note)}</p>` : ""}
  <a href="${url}" style="display:inline-block;padding:12px 28px;background:#0969da;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">View full report</a>
</div>`.trim();
}

// ── Weekly digest ─────────────────────────────────────────────────────────────

/** The failed-question index scan is the one extra read a weekly report makes.
 *  Every weekly report fires in the same cron minute and shares the same
 *  (org, week) window, so the first one pays for the scan and the rest read
 *  memory — the same trick queryAuditDoneIndex uses for the audit index. */
const _failScanCache = new Map<string, { value: Map<string, string[]>; expiresAt: number }>();
const _failScanPending = new Map<string, Promise<Map<string, string[]>>>();
const FAIL_SCAN_TTL_MS = 10 * 60_000;

/** How far BEFORE the report window to scan for failed questions.
 *
 *  The two indexes are filed under different dates: a report includes an audit
 *  by `doneAt` (when a person finished reviewing it), while the failed-question
 *  index range-scans on `completedAt` (when the bot graded it). Sunday's work
 *  reviewed on Monday is in the report but its question rows sit in the previous
 *  week's range — which showed up as cards reading "4 Failed / Categories: None".
 *  Measured on one week: 103 of 461 failed audits lost their categories this way.
 *
 *  Scanning wider cannot pull in audits the report doesn't contain: the result
 *  is joined by findingId, so extra rows simply find no match. Two weeks covers
 *  any realistic review backlog. */
const FAIL_SCAN_LOOKBACK_MS = 14 * 86_400_000;

/** Test-only: clear the failed-question scan cache. */
export function _resetFailScanCacheForTests(): void {
  _failScanCache.clear();
  _failScanPending.clear();
}

/** findingId → the short labels for every question it failed, for the window. */
export async function failedCategoriesByFinding(
  orgId: OrgId, from: number, to: number,
): Promise<Map<string, string[]>> {
  const scanFrom = from - FAIL_SCAN_LOOKBACK_MS;
  const key = `${orgId}|${scanFrom}|${to}`;
  const hit = _failScanCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const pending = _failScanPending.get(key);
  if (pending) return pending;

  const run = (async () => {
    const rows = await queryFailedFindings(orgId, scanFrom, to);
    const map = new Map<string, string[]>();
    for (const r of rows) {
      const label = shortQuestionLabel(r.header);
      const cur = map.get(r.findingId);
      if (cur) { if (!cur.includes(label)) cur.push(label); }
      else map.set(r.findingId, [label]);
    }
    _failScanCache.set(key, { value: map, expiresAt: Date.now() + FAIL_SCAN_TTL_MS });
    return map;
  })().finally(() => _failScanPending.delete(key));

  _failScanPending.set(key, run);
  return run;
}

/** Team-member cards kept per group when the digest email would otherwise clip
 *  in Gmail — tried in order until one fits. Every group keeps its summary card
 *  at every step; only the tail of the member cards moves to the linked full
 *  report, and the email says how many it held back. */
const INLINE_MEMBER_CAPS = [20, 12, 8, 5, 3];

export interface WeeklyRender {
  /** Light, flat digest — the email body. */
  emailHtml: string;
  /** Dark, expandable, itemised digest — the /r/<slug> page. */
  pageHtml: string;
  groups: DigestGroup[];
}

/** Query-free: turns already-queried sections into the two weekly renderings.
 *  `viewUrl` omitted (preview) simply leaves out the full-report button. */
export function renderWeeklyDigest(
  sections: SectionResult[],
  config: EmailReportConfig,
  failsByFinding: Map<string, string[]>,
  viewUrl?: string,
  nowMs: number = Date.now(),
): WeeklyRender {
  const groups = buildDigest(sections, failsByFinding, config.weeklySplitByShift !== false);
  const opts = {
    title: config.name,
    weekLabel: weeklyHeadline(config.dateRange, nowMs),
    generatedAt: formatEst(nowMs),
  };

  const pageHtml = renderDigestPage(groups, opts, { recordUrl, findingUrl });

  const withLink = (maxMembers: number, note?: string) =>
    renderDigestEmail(
      groups,
      { ...opts, footerHtml: viewUrl ? renderLightViewLinkBlock(viewUrl, note) : undefined },
      maxMembers,
    );

  const total = groups.reduce((n, g) => n + g.members.length, 0);
  let emailHtml = withLink(Number.POSITIVE_INFINITY);
  for (const cap of INLINE_MEMBER_CAPS) {
    if (emailHtml.length <= EMAIL_INLINE_LIMIT) break;
    const shown = groups.reduce((n, g) => n + Math.min(g.members.length, cap), 0);
    if (shown === total) continue; // this cap trims nothing — try a tighter one
    emailHtml = withLink(
      cap,
      `Showing ${shown} of ${total} team members — open the full report for all of them.`,
    );
  }

  return { emailHtml, pageHtml, groups };
}

/** Query the week's failed questions, then render both weekly views. Shared by
 *  the send path and the admin preview so the two can never drift; a preview
 *  passes no `viewUrl` and simply omits the full-report button. */
export async function buildWeeklyRender(
  orgId: OrgId, config: EmailReportConfig, sections: SectionResult[], viewUrl?: string,
): Promise<WeeklyRender> {
  const { from, to } = resolveDateRange(config.dateRange);
  const failsByFinding = await failedCategoriesByFinding(orgId, from, to);
  return renderWeeklyDigest(sections, config, failsByFinding, viewUrl);
}

/** The email body for any report: the weekly digest, or the classic section
 *  tables for every other report type. */
export async function renderReportEmailHtml(
  orgId: OrgId, config: EmailReportConfig, sections: SectionResult[], templateHtml: string | null = null,
): Promise<string> {
  if (config.weeklyType) return (await buildWeeklyRender(orgId, config, sections)).emailHtml;
  return renderFullEmail(templateHtml, renderSections(sections), config.name);
}

// ── Run report ────────────────────────────────────────────────────────────────

/** Output of `prepareReport` — everything needed to actually send the email,
 *  fully resolved (data queried, HTML rendered, attachment built). Split out
 *  so the cron tick can wrap the (potentially long) query+render in a
 *  timeout but let the final sendEmail run to completion without a race.
 *  Mid-`sendEmail` timeouts otherwise double-send: customer gets the email
 *  AND lastRunStatus shows error AND next tick retries. */
export interface PreparedReport {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  htmlBody: string;
  attachments?: Array<{ name: string; content: string; contentType: string }>;
  totalRows: number;
}

/** Query + render only — safe to wrap in a timeout. */
export async function prepareReport(orgId: OrgId, config: EmailReportConfig): Promise<PreparedReport | null> {
  const label = `[EMAIL-REPORT] org=${orgId} report="${config.name}" id=${config.id}`;

  if (!config.recipients?.length) {
    console.warn(`${label} — skipped: no recipients`);
    return null;
  }

  console.log(`${label} — [1/3] querying data...`);
  const sections = await queryReportData(orgId, config);
  const totalRows = sections.reduce((sum, s) => sum + s.rows.length, 0);
  console.log(`${label} — [2/3] ${sections.length} section(s), ${totalRows} row(s)`);

  const template = config.templateId
    ? await getEmailTemplate(orgId, config.templateId)
    : null;

  console.log(`${label} — [3/3] rendering HTML...`);

  let htmlBody: string;
  if (config.weeklyType) {
    // Weekly reports render the digest: a summary card and a card per team
    // member for each shift/department, with the itemised failures living on
    // the public "View full report" page. That page is stored once per
    // (report, week) under a deterministic slug, so the daily sends overwrite
    // one record (latest wins) instead of piling up a copy per send.
    const { from } = resolveDateRange(config.dateRange);
    const slug = await weeklyReportSlug(orgId, config.id, from);
    const viewUrl = `${selfUrl()}/r/${slug}`;
    const { emailHtml, pageHtml } = await buildWeeklyRender(orgId, config, sections, viewUrl);
    try {
      await saveWeeklyReportView(slug, pageHtml);
    } catch (err) {
      console.error(`${label} — failed to store view page:`, err);
    }
    htmlBody = emailHtml;
  } else {
    htmlBody = renderFullEmail(template?.html ?? null, renderSections(sections), config.name);
  }

  let subject = config.name;
  if (config.weeklyType) {
    subject = config.name + " \u2014 " + weeklySubjectRange(config.dateRange);
  }

  const attachments = totalRows > 0
    ? [{
      name: `${safeFilename(config.name)}.csv`,
      content: toBase64Utf8(buildCsv(sections)),
      contentType: "text/csv",
    }]
    : undefined;

  return {
    to: config.recipients,
    ...(config.cc?.length ? { cc: config.cc } : {}),
    ...(config.bcc?.length ? { bcc: config.bcc } : {}),
    subject,
    htmlBody,
    ...(attachments ? { attachments } : {}),
    totalRows,
  };
}

/** Sends a prepared report — fire only once the Promise.race timeout window
 *  has closed. Returns the Postmark messageId so callers can stamp it on the
 *  status doc for retry-safety. */
export async function sendPreparedReport(prepared: PreparedReport): Promise<{ messageId?: string }> {
  const result = await sendEmail({
    to: prepared.to,
    ...(prepared.cc ? { cc: prepared.cc } : {}),
    ...(prepared.bcc ? { bcc: prepared.bcc } : {}),
    subject: prepared.subject,
    htmlBody: prepared.htmlBody,
    ...(prepared.attachments ? { attachments: prepared.attachments } : {}),
  });
  return { messageId: (result as { messageId?: string } | undefined)?.messageId };
}

export async function runReport(orgId: OrgId, config: EmailReportConfig): Promise<void> {
  const label = `[EMAIL-REPORT] org=${orgId} report="${config.name}" id=${config.id}`;
  const prepared = await prepareReport(orgId, config);
  if (!prepared) return;
  console.log(`${label} — sending to ${prepared.to.length} recipient(s)...`);
  await sendPreparedReport(prepared);
  console.log(`${label} — ✅ sent successfully`);
}
/** Report renderer — converts SectionResult[] into email-ready HTML.
 *  Pure functions only; no KV, no external calls.
 *  Styled to match autobottom's existing email aesthetic. */



const QB_RECORD_URL = "https://monsterrg.quickbase.com/nav/app/bmhvhc7sk/table/bpb28qsnn/action/dr?rid=";

/** This deployment's base URL (for building report/finding links). */
export function selfUrl(): string {
  return Deno.env.get("SELF_URL") ?? "http://localhost:3000";
}
/** QuickBase deep-link for a record id. */
export function recordUrl(recordId: string): string {
  return QB_RECORD_URL + encodeURIComponent(recordId);
}
/** Public audit-report page link for a finding id. */
export function findingUrl(findingId: string): string {
  return `${selfUrl()}/audit/report?id=${encodeURIComponent(findingId)}`;
}

// ── Palette (matches autobottom email theme) ──────────────────────────────────

const C = {
  bg:         "#0b0f15",
  card:       "#111620",
  cardAlt:    "#161c28",
  border:     "#1c2333",
  text:       "#c9d1d9",
  textBright: "#e6edf3",
  textMuted:  "#6e7681",
  textDim:    "#484f58",
  blue:       "#58a6ff",
  green:      "#3fb950",
  yellow:     "#d29922",
  red:        "#f85149",
};

const COLUMN_LABELS: Record<ReportColumnKey, string> = {
  recordId:              "Record ID",
  findingId:             "Audit Report",
  guestName:             "Guest Name",
  voName:                "VO Name",
  department:            "Department",
  score:                 "Score",
  appealStatus:          "Appeal",
  finalizedAt:           "Timestamp",
  markedForReview:       "Status",
  mostRecentActiveMccId: "MCC ID",
};

const APPEAL_LABELS: Record<AppealStatus, string> = {
  none:     "None",
  pending:  "Pending",
  complete: "Complete",
};

const APPEAL_COLORS: Record<AppealStatus, string> = {
  none:     C.textMuted,
  pending:  C.yellow,
  complete: C.green,
};

// ── EST formatter ─────────────────────────────────────────────────────────────

const estFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function formatEst(ts: number): string {
  return estFmt.format(new Date(ts));
}

// ── Cell renderer ─────────────────────────────────────────────────────────────

function renderCell(col: ReportColumnKey, row: ReportRow): string {
  switch (col) {
    case "recordId": {
      if (!row.recordId) return `<span style="color:${C.textDim};">&mdash;</span>`;
      return `<a href="${recordUrl(row.recordId)}" style="color:${C.blue};text-decoration:none;font-family:monospace;font-size:12px;">${esc(row.recordId)}</a>`;
    }
    case "findingId": {
      if (!row.findingId) return `<span style="color:${C.textDim};">&mdash;</span>`;
      return `<a href="${findingUrl(row.findingId)}" style="color:${C.blue};text-decoration:none;font-family:monospace;font-size:11px;">${esc(row.findingId)}</a>`;
    }
    case "score": {
      if (row.score == null) return `<span style="color:${C.textDim};">&mdash;</span>`;
      const color = row.score === 100 ? C.green : row.score >= 80 ? C.blue : row.score >= 60 ? C.yellow : C.red;
      return `<span style="color:${color};font-weight:600;">${row.score}%</span>`;
    }
    case "appealStatus": {
      if (!row.appealStatus) return `<span style="color:${C.textDim};">&mdash;</span>`;
      const color = APPEAL_COLORS[row.appealStatus];
      return `<span style="color:${color};font-weight:500;">${APPEAL_LABELS[row.appealStatus]}</span>`;
    }
    case "finalizedAt":
      return row.finalizedAt
        ? `<span style="color:${C.textMuted};font-size:12px;">${esc(formatEst(row.finalizedAt))}</span>`
        : `<span style="color:${C.textDim};">&mdash;</span>`;
    case "markedForReview":
      return row.markedForReview
        ? `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:rgba(210,153,34,0.15);color:${C.yellow};border:1px solid rgba(210,153,34,0.3);">In Review</span>`
        : `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:rgba(63,185,80,0.12);color:${C.green};border:1px solid rgba(63,185,80,0.25);">Complete</span>`;
    default: {
      const val = row[col as keyof ReportRow];
      return val != null
        ? `<span style="color:${C.text};">${esc(String(val))}</span>`
        : `<span style="color:${C.textDim};">&mdash;</span>`;
    }
  }
}

// ── Section renderer ──────────────────────────────────────────────────────────

function renderSection(section: SectionResult): string {
  const thStyle = `padding:8px 14px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:${C.textMuted};border-bottom:1px solid ${C.border};white-space:nowrap;`;
  const tdBase  = `padding:10px 14px;border-bottom:1px solid ${C.border};vertical-align:top;font-size:13px;`;

  const headerCells = section.columns
    .map((col) => `<th style="${thStyle}">${COLUMN_LABELS[col]}</th>`)
    .join("");

  let bodyRows: string;

  if (section.rows.length === 0) {
    bodyRows = `
      <tr>
        <td colspan="${section.columns.length}" style="${tdBase}text-align:center;color:${C.textDim};font-style:italic;padding:20px 14px;">
          No records
        </td>
      </tr>`;
  } else {
    bodyRows = section.rows.map((row, i) => {
      const bg = i % 2 === 0 ? C.card : C.cardAlt;
      const cells = section.columns
        .map((col) => `<td style="${tdBase}background:${bg};">${renderCell(col, row)}</td>`)
        .join("");
      return `<tr>${cells}</tr>`;
    }).join("");
  }

  return `
<div style="margin-bottom:28px;">
  <p style="margin:0 0 10px 0;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:${C.textMuted};">REPORT SECTION</p>
  <h2 style="margin:0 0 14px 0;font-size:18px;font-weight:700;color:${C.textBright};">${esc(section.header)} <span style="font-weight:800;color:${C.textMuted};">(${section.rows.length})</span></h2>
  <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${C.border};border-radius:8px;overflow:hidden;">
    <thead style="background:${C.cardAlt};">
      <tr>${headerCells}</tr>
    </thead>
    <tbody>${bodyRows}</tbody>
  </table>
</div>`.trim();
}

// ── Public: render all sections ───────────────────────────────────────────────

export function renderSections(sections: SectionResult[]): string {
  return sections.map((s) => renderSection(s)).join("\n");
}

// ── Public: render full email ─────────────────────────────────────────────────

export function renderFullEmail(
  templateHtml: string | null,
  sectionsHtml: string,
  reportName?: string,
): string {
  if (templateHtml) {
    return templateHtml.replace("{{sections}}", sectionsHtml);
  }

  // Fallback wrapper — matches autobottom dark email aesthetic
  const now = formatEst(Date.now());
  const title = reportName ? esc(reportName) : "Autobottom Report";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:${C.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};min-height:100vh;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:860px;">

          <!-- Header -->
          <tr>
            <td style="padding:0 0 24px 0;">
              <p style="margin:0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:${C.textDim};">AutoBot</p>
              <h1 style="margin:6px 0 4px 0;font-size:22px;font-weight:800;color:${C.textBright};letter-spacing:-0.5px;">${title}</h1>
              <p style="margin:0;font-size:13px;color:${C.textMuted};">Generated ${now} EST</p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 0 28px 0;border-top:1px solid ${C.border};"></td>
          </tr>

          <!-- Sections -->
          <tr>
            <td>
              ${sectionsHtml}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:28px 0 0 0;border-top:1px solid ${C.border};">
              <p style="margin:0;font-size:11px;color:${C.textDim};text-align:center;">
                Autobottom &mdash; ${now} EST
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
