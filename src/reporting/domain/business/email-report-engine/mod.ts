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
import { getAppeal } from "@judge/domain/data/judge-repository/mod.ts";
import { sendEmail } from "@reporting/domain/data/postmark/mod.ts";
import {
  getReservationRidsForDateLegs,
  getReservationRidsForPackages,
  getMccIdsForReservations,
} from "@audit/domain/data/quickbase/mod.ts";

export type AppealStatus = "none" | "pending" | "complete";

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

/** Wall-clock fields for `atMs` projected into `tz` (DST-safe via Intl). */
function tzParts(tz: string, atMs: number): {
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
function zonedToMs(tz: string, y: number, mo: number, d: number, h: number, mi: number, s: number, ms: number): number {
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
    // Monday 00:00:00.000 EST → Sunday 23:59:59.999 EST. Compute the calendar
    // date of the week's start in Eastern, then convert both ends back to epoch.
    const ny = tzParts(WEEK_TZ, nowMs);
    const diff = (ny.dow - dateRange.startDay + 7) % 7; // days since the week's start day
    const startCal = new Date(Date.UTC(ny.year, ny.month - 1, ny.day));
    startCal.setUTCDate(startCal.getUTCDate() - diff);
    const endCal = new Date(startCal);
    endCal.setUTCDate(endCal.getUTCDate() + 6);
    const from = zonedToMs(WEEK_TZ, startCal.getUTCFullYear(), startCal.getUTCMonth() + 1, startCal.getUTCDate(), 0, 0, 0, 0);
    const to = zonedToMs(WEEK_TZ, endCal.getUTCFullYear(), endCal.getUTCMonth() + 1, endCal.getUTCDate(), 23, 59, 59, 999);
    return { from, to };
  }
  // fixed
  return { from: dateRange.from, to: dateRange.to };
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

  // Weekly: only failed audits
  if (config.failedOnly) {
    candidates = candidates.filter((e) => e.score < 100);
  }

  const results: any[] = sections.map((s) => ({
    header: s.header,
    columns: s.columns,
    rows: [],
  }));

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

    for (let i = 0; i < sections.length; i++) {
      if (evaluateRules(finding, stat, appealStatus, reviewed, sections[i].criteria)) {
        const rowIdx = results[i].rows.length;
        results[i].rows.push(extractRow(finding, stat, appealStatus, sections[i].columns as ReportColumnKey[], markedForReview));
        if (needsMcc && sections[i].columns.includes("mostRecentActiveMccId") && stat.recordId) {
          mccRowMeta.push({ sectionIdx: i, rowIdx, recordId: stat.recordId, isPackage });
        }
      }
    }
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

  return results;
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
 *  bigger report shows a trimmed table inline + a link to the full page. */
const EMAIL_INLINE_LIMIT = 90 * 1024;
/** Rows kept inline when a report is trimmed (the rest live on the linked page). */
const MAX_INLINE_ROWS = 30;

/** Deterministic, unguessable slug for a report's weekly page — same report +
 *  same week → same slug, so every daily send links to (and overwrites) one
 *  page instead of piling up a copy per send. */
export async function weeklyReportSlug(orgId: string, configId: string, weekFromMs: number): Promise<string> {
  const bytes = new TextEncoder().encode(`${orgId}|${configId}|${weekFromMs}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Keep the first `maxRows` rows across all sections (in order), reporting how
 *  many were shown vs the total so the email can say "showing X of Y". */
export function trimSectionsForEmail(
  sections: SectionResult[],
  maxRows: number,
): { sections: SectionResult[]; shown: number; total: number } {
  let budget = maxRows, shown = 0, total = 0;
  const trimmed = sections.map((s) => {
    total += s.rows.length;
    const take = Math.max(0, Math.min(s.rows.length, budget));
    budget -= take;
    shown += take;
    return { ...s, rows: s.rows.slice(0, take) };
  });
  return { sections: trimmed, shown, total };
}

/** "View full report" button block — inline-styled so it survives Gmail. */
function renderViewLinkBlock(url: string, note?: string): string {
  return `
<div style="margin:24px 0 8px 0;text-align:center;">
  ${note ? `<p style="margin:0 0 12px 0;font-size:13px;color:${C.textMuted};">${esc(note)}</p>` : ""}
  <a href="${url}" style="display:inline-block;padding:12px 28px;background:${C.blue};color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">View full report</a>
</div>`.trim();
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

  let summaryHtml: string | undefined;
  if (config.weeklyType) {
    const { from, to } = resolveDateRange(config.dateRange);
    const allRows = sections.flatMap(s => s.rows);
    const scores = allRows.map(r => r.score ?? 0);
    const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    const failedCount = scores.filter(s => s < 100).length;
    const summaryData: WeeklySummaryData = { from, to, totalAudits: allRows.length, avgScore, failedCount };
    summaryHtml = renderWeeklySummary(summaryData);
  }

  console.log(`${label} — [3/3] rendering HTML...`);
  const sectionsHtml = renderSections(sections);
  // The complete report — every row — is what we store at the public page and
  // what the email shows when it's small enough.
  const fullHtml = renderFullEmail(template?.html ?? null, sectionsHtml, config.name, summaryHtml);

  let htmlBody = fullHtml;
  // Weekly reports get a public "View full report" page: store the full HTML
  // once per (report, week) — keyed by a deterministic slug so the daily sends
  // overwrite one record (latest wins) — link to it, and fall back to a trimmed
  // inline table when the email would otherwise clip in Gmail.
  if (config.weeklyType) {
    const { from } = resolveDateRange(config.dateRange);
    const slug = await weeklyReportSlug(orgId, config.id, from);
    try {
      await saveWeeklyReportView(slug, fullHtml);
    } catch (err) {
      console.error(`${label} — failed to store view page:`, err);
    }
    const viewUrl = `${selfUrl()}/r/${slug}`;
    if (fullHtml.length <= EMAIL_INLINE_LIMIT) {
      htmlBody = renderFullEmail(template?.html ?? null, sectionsHtml + renderViewLinkBlock(viewUrl), config.name, summaryHtml);
    } else {
      const { sections: trimmed, shown, total } = trimSectionsForEmail(sections, MAX_INLINE_ROWS);
      const note = `Showing the first ${shown} of ${total} audits — open the full report for all of them.`;
      htmlBody = renderFullEmail(template?.html ?? null, renderSections(trimmed) + renderViewLinkBlock(viewUrl, note), config.name, summaryHtml);
    }
  }

  let subject = config.name;
  if (config.weeklyType) {
    const { from, to } = resolveDateRange(config.dateRange);
    const fmt = (ts: number) => {
      const d = new Date(ts);
      return (d.getUTCMonth() + 1) + "/" + d.getUTCDate();
    };
    subject = config.name + " \u2014 Week of " + fmt(from) + "\u2013" + fmt(to);
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
  <h2 style="margin:0 0 14px 0;font-size:18px;font-weight:700;color:${C.textBright};">${esc(section.header)}</h2>
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
  return sections.map(renderSection).join("\n");
}

// ── Weekly summary block ───────────────────────────────────────────────────────

export interface WeeklySummaryData {
  from: number;
  to: number;
  totalAudits: number;
  avgScore: number;
  failedCount: number;
}

export function renderWeeklySummary(data: WeeklySummaryData): string {
  const dayFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const fromLabel = dayFmt.format(new Date(data.from));
  const toLabel = dayFmt.format(new Date(data.to));
  const failedPct = data.totalAudits > 0 ? Math.round((data.failedCount / data.totalAudits) * 100) : 0;
  const avgColor = data.avgScore === 100 ? C.green : data.avgScore >= 80 ? C.blue : data.avgScore >= 60 ? C.yellow : C.red;

  return `
<div style="margin-bottom:28px;padding:20px 24px;background:${C.cardAlt};border:1px solid ${C.border};border-radius:8px;">
  <p style="margin:0 0 12px 0;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:${C.textMuted};">Weekly Summary</p>
  <p style="margin:0 0 16px 0;font-size:15px;font-weight:600;color:${C.textBright};">Week of ${esc(fromLabel)} &ndash; ${esc(toLabel)}</p>
  <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
    <tr>
      <td style="padding:6px 24px 6px 0;font-size:13px;color:${C.textMuted};white-space:nowrap;">Total Audits</td>
      <td style="padding:6px 0;font-size:13px;font-weight:600;color:${C.textBright};">${data.totalAudits}</td>
    </tr>
    <tr>
      <td style="padding:6px 24px 6px 0;font-size:13px;color:${C.textMuted};white-space:nowrap;">Average Score</td>
      <td style="padding:6px 0;font-size:13px;font-weight:600;color:${avgColor};">${data.avgScore}%</td>
    </tr>
    <tr>
      <td style="padding:6px 24px 6px 0;font-size:13px;color:${C.textMuted};white-space:nowrap;">Failed Audits</td>
      <td style="padding:6px 0;font-size:13px;font-weight:600;color:${data.failedCount > 0 ? C.red : C.green};">${data.failedCount} (${failedPct}%)</td>
    </tr>
  </table>
</div>`.trim();
}

// ── Public: render full email ─────────────────────────────────────────────────

export function renderFullEmail(
  templateHtml: string | null,
  sectionsHtml: string,
  reportName?: string,
  summaryHtml?: string,
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

          <!-- Weekly summary (optional) -->
          ${summaryHtml ? `<tr><td style="padding:0 0 0 0;">${summaryHtml}</td></tr>` : ""}

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
