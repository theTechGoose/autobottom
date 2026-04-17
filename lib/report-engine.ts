/** Report query engine — evaluates criteria rules against finalized findings
 *  and returns structured section results for email rendering. */

import type { OrgId } from "./org.ts";
import { queryAuditDoneIndex, getFinding, getEmailTemplate } from "./kv.ts";
import type {
  EmailReportConfig,
  DateRangeConfig,
  AuditDoneIndexEntry,
  CriteriaRule,
  ReportColumnKey,
} from "./kv.ts";
import { getAppeal } from "../judge/kv.ts";
import { renderSections, renderFullEmail, renderWeeklySummary, cellPlainValue, COLUMN_LABELS } from "./report-renderer.ts";
import type { WeeklySummaryData } from "./report-renderer.ts";
import { sendEmail } from "../providers/postmark.ts";
import {
  getReservationRidsForDateLegs,
  getReservationRidsForPackages,
  getMccIdsForReservations,
} from "../providers/quickbase.ts";

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

export function resolveDateRange(dateRange: DateRangeConfig | undefined): { from: number; to: number } {
  if (!dateRange) {
    // Default: rolling 24 hours (backward compat for old configs)
    const to = Date.now();
    return { from: to - 86_400_000, to };
  }
  if (dateRange.mode === "rolling") {
    const to = Date.now();
    return { from: to - dateRange.hours * 3_600_000, to };
  }
  if (dateRange.mode === "weekly") {
    const now = new Date();
    const day = now.getDay(); // 0=Sun, 1=Mon, ...
    const diff = (day - dateRange.startDay + 7) % 7;
    const start = new Date(now);
    start.setDate(now.getDate() - diff);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { from: start.getTime(), to: end.getTime() };
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

  const results: SectionResult[] = sections.map((s) => ({
    header: s.header,
    columns: s.columns,
    rows: [],
  }));

  const needsMcc = sections.some((s) => s.columns.includes("mostRecentActiveMccId"));
  const mccRowMeta: { sectionIdx: number; rowIdx: number; recordId: string; isPackage: boolean }[] = [];

  // Hydrate candidates in batches to avoid hammering KV concurrency limits
  const HYDRATE_BATCH = 20;
  const hydrated: { entry: AuditDoneIndexEntry; finding: Awaited<ReturnType<typeof getFinding>>; appealRecord: Awaited<ReturnType<typeof getAppeal>> }[] = [];
  for (let i = 0; i < candidates.length; i += HYDRATE_BATCH) {
    const batch = candidates.slice(i, i + HYDRATE_BATCH);
    const results = await Promise.all(batch.map(async (entry) => {
      const [finding, appealRecord] = await Promise.all([
        getFinding(orgId, entry.findingId),
        getAppeal(orgId, entry.findingId),
      ]);
      return { entry, finding, appealRecord };
    }));
    hydrated.push(...results);
  }

  const topFilters = config.topLevelFilters ?? [];

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
        results[i].rows.push(extractRow(finding, stat, appealStatus, sections[i].columns, markedForReview));
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

function buildCsv(sections: SectionResult[]): string {
  const allCols: ReportColumnKey[] = [];
  for (const s of sections) {
    for (const c of s.columns) {
      if (!allCols.includes(c)) allCols.push(c);
    }
  }
  const header = ["Section", ...allCols.map((c) => COLUMN_LABELS[c])].map(csvEscape).join(",");
  const lines = [header];
  for (const s of sections) {
    for (const row of s.rows) {
      const cells = [s.header, ...allCols.map((c) => cellPlainValue(c, row))];
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

// ── Run report ────────────────────────────────────────────────────────────────

export async function runReport(orgId: OrgId, config: EmailReportConfig): Promise<void> {
  const label = `[EMAIL-REPORT] org=${orgId} report="${config.name}" id=${config.id}`;

  if (!config.recipients?.length) {
    console.warn(`${label} — skipped: no recipients`);
    return;
  }

  console.log(`${label} — [1/4] querying data...`);
  const sections = await queryReportData(orgId, config);
  const totalRows = sections.reduce((sum, s) => sum + s.rows.length, 0);
  console.log(`${label} — [2/4] ${sections.length} section(s), ${totalRows} row(s)`);

  const template = config.templateId
    ? await getEmailTemplate(orgId, config.templateId)
    : null;

  // Build weekly summary block if applicable
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

  const allRecipients = config.recipients;

  console.log(`${label} — [3/4] rendering HTML...`);
  const sectionsHtml = renderSections(sections);
  const htmlBody = renderFullEmail(template?.html ?? null, sectionsHtml, config.name, summaryHtml);

  console.log(`${label} — [4/4] sending to ${allRecipients.length} recipient(s)...`);
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

  await sendEmail({
    to: allRecipients,
    ...(config.cc?.length ? { cc: config.cc } : {}),
    ...(config.bcc?.length ? { bcc: config.bcc } : {}),
    subject,
    htmlBody,
    ...(attachments ? { attachments } : {}),
  });

  console.log(`${label} — ✅ sent successfully`);
}
