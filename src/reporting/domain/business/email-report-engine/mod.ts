/** Report engine — consolidated query + render + send. */
/** Report query engine — evaluates criteria rules against finalized findings
 *  and returns structured section results for email rendering. */

import type { OrgId } from "@core/data/deno-kv/mod.ts";
import { queryAuditDoneIndex } from "@audit/domain/data/stats-repository/mod.ts";
import { getFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { getEmailTemplate } from "@reporting/domain/data/email-repository/mod.ts";
import type {
  EmailReportConfig,
  DateRangeConfig,
  AuditDoneIndexEntry,
  CriteriaRule,
  ReportColumnKey,
} from "@core/dto/types.ts";
import { getAppeal } from "@judge/domain/data/judge-repository/mod.ts";
import { sendEmail } from "@reporting/domain/data/postmark/mod.ts";

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

  const results: any[] = sections.map((s) => ({
    header: s.header,
    columns: s.columns,
    rows: [],
  }));

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
        results[i].rows.push(extractRow(finding, stat, appealStatus, sections[i].columns as any, markedForReview));
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
  await sendEmail({
    to: allRecipients,
    ...(config.cc?.length ? { cc: config.cc } : {}),
    ...(config.bcc?.length ? { bcc: config.bcc } : {}),
    subject,
    htmlBody,
  });

  console.log(`${label} — ✅ sent successfully`);
}
/** Report renderer — converts SectionResult[] into email-ready HTML.
 *  Pure functions only; no KV, no external calls.
 *  Styled to match autobottom's existing email aesthetic. */



const QB_RECORD_URL = "https://monsterrg.quickbase.com/nav/app/bmhvhc7sk/table/bpb28qsnn/action/dr?rid=";

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
  recordId:        "Record ID",
  findingId:       "Audit Report",
  guestName:       "Guest Name",
  voName:          "VO Name",
  department:      "Department",
  score:           "Score",
  appealStatus:    "Appeal",
  finalizedAt:     "Timestamp",
  markedForReview: "Status",
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
      const url = QB_RECORD_URL + encodeURIComponent(row.recordId);
      return `<a href="${url}" style="color:${C.blue};text-decoration:none;font-family:monospace;font-size:12px;">${esc(row.recordId)}</a>`;
    }
    case "findingId": {
      if (!row.findingId) return `<span style="color:${C.textDim};">&mdash;</span>`;
      const url = `${Deno.env.get("SELF_URL") ?? "http://localhost:3000"}/audit/report?id=${encodeURIComponent(row.findingId)}`;
      return `<a href="${url}" style="color:${C.blue};text-decoration:none;font-family:monospace;font-size:11px;">${esc(row.findingId)}</a>`;
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
