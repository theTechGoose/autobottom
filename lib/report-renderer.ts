/** Report renderer — converts SectionResult[] into email-ready HTML.
 *  Pure functions only; no KV, no external calls.
 *  Styled to match autobottom's existing email aesthetic. */

import type { SectionResult, ReportRow, AppealStatus } from "./report-engine.ts";
import type { ReportColumnKey } from "./kv.ts";
import { env } from "../env.ts";

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

export const COLUMN_LABELS: Record<ReportColumnKey, string> = {
  recordId:              "Record ID",
  findingId:             "Audit Report",
  guestName:             "Guest Name",
  voName:                "VO Name",
  department:            "Department",
  score:                 "Score",
  appealStatus:          "Appeal",
  finalizedAt:           "Timestamp",
  markedForReview:       "Status",
  mostRecentActiveMccId: "Most Recent Active MCC ID",
};

const MCC_URL_BASE = "https://monsterrg.quickbase.com/nav/app/bmhvhc7sk/table/brx22z3qd/action/er?rid=";

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

export function formatEst(ts: number): string {
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
      const url = `${env.selfUrl}/audit/report?id=${encodeURIComponent(row.findingId)}`;
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
    case "mostRecentActiveMccId": {
      if (!row.mostRecentActiveMccId) return `<span style="color:${C.textDim};">&mdash;</span>`;
      const id = row.mostRecentActiveMccId;
      const url = MCC_URL_BASE + encodeURIComponent(id);
      return `<a href="${url}" style="color:${C.blue};text-decoration:none;font-family:monospace;font-size:12px;">${esc(id)}</a>`;
    }
    default: {
      const val = row[col as keyof ReportRow];
      return val != null
        ? `<span style="color:${C.text};">${esc(String(val))}</span>`
        : `<span style="color:${C.textDim};">&mdash;</span>`;
    }
  }
}

// ── Plain-text value extractor (for CSV export) ──────────────────────────────

export function cellPlainValue(col: ReportColumnKey, row: ReportRow): string {
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
