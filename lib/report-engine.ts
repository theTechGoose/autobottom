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
import { renderSections, renderFullEmail } from "./report-renderer.ts";
import { sendEmail } from "../providers/postmark.ts";

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
  const candidates: AuditDoneIndexEntry[] = onlyCompleted
    ? indexEntries.filter(
        (e) => e.completed && e.doneAt !== undefined && e.doneAt >= from && e.doneAt <= to,
      )
    : indexEntries;

  const results: SectionResult[] = sections.map((s) => ({
    header: s.header,
    columns: s.columns,
    rows: [],
  }));

  // Hydrate all candidates in parallel — finding + appeal fetched simultaneously
  const hydrated = await Promise.all(candidates.map(async (entry) => {
    const [finding, appealRecord] = await Promise.all([
      getFinding(orgId, entry.findingId),
      getAppeal(orgId, entry.findingId),
    ]);
    return { entry, finding, appealRecord };
  }));

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
        results[i].rows.push(extractRow(finding, stat, appealStatus, sections[i].columns, markedForReview));
      }
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

// ── Run report ────────────────────────────────────────────────────────────────

export async function runReport(orgId: OrgId, config: EmailReportConfig): Promise<void> {
  const label = `[EMAIL-REPORT] org=${orgId} report="${config.name}" id=${config.id}`;

  if (!config.recipients?.length) {
    console.warn(`${label} — skipped: no recipients`);
    return;
  }

  const sections = await queryReportData(orgId, config);
  const totalRows = sections.reduce((sum, s) => sum + s.rows.length, 0);
  console.log(`${label} — queried: ${sections.length} section(s), ${totalRows} total row(s)`);

  const template = config.templateId
    ? await getEmailTemplate(orgId, config.templateId)
    : null;

  const sectionsHtml = renderSections(sections);
  const htmlBody = renderFullEmail(template?.html ?? null, sectionsHtml, config.name);

  await sendEmail({
    to: config.recipients,
    ...(config.cc?.length ? { cc: config.cc } : {}),
    ...(config.bcc?.length ? { bcc: config.bcc } : {}),
    subject: config.name,
    htmlBody,
  });

  console.log(`${label} — sent to ${config.recipients.length} recipient(s)`);
}
