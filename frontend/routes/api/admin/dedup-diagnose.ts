/** Read-only dedup verification. Posts the date range to the backend's
 *  /admin/deduplicate-diagnose, which scans (never deletes) and reports, per
 *  finding, how many audit-done-idx rows it has and which row the cleanup would
 *  KEEP (reviewed/judged, else newest) vs DELETE. Renders an inline table so an
 *  operator can confirm correctness before running Execute. */
import { define } from "../../../lib/define.ts";
import { apiPost, parseHtmxBody } from "../../../lib/api.ts";

interface DiagMember {
  completedAt: number;
  score: number;
  reason: string;
  reviewedBy: string;
  recordingId: string;
  decision: "KEEP" | "DELETE";
}
interface DiagGroup {
  findingId: string;
  recordId: string;
  rowCount: number;
  members: DiagMember[];
}
interface Diagnosis {
  since: number;
  until: number;
  scannedRows: number;
  distinctFindings: number;
  findingsWithDupes: number;
  staleRows: number;
  sampleShown: number;
  sampleTotal: number;
  sampleGroups: DiagGroup[];
}

// Record-ID pass (pass === "records"): each group is ONE booking audited more
// than once — a keeper plus loser audits to retire.
interface RecordMember {
  findingId: string;
  score: number;
  startedAt?: number;
  completedAt: number;
  reviewedBy?: string;
  reason?: string;
  keep: boolean;
}
interface RecordGroup {
  recordId: string;
  keeperId: string;
  keeperReason: "entry_100" | "reviewed" | "latest";
  members: RecordMember[];
  appealSkipped: boolean;
}
interface RecordDiagnosis {
  since: number;
  until: number;
  scannedRows: number;
  recordsWithDupes: number;
  losersToEvict: number;
  appealSkips: number;
  sampleTotal: number;
  sampleGroups: RecordGroup[];
}
const KEEPER_REASON: Record<string, string> = {
  entry_100: "100% on entry",
  reviewed: "reviewed",
  latest: "latest audited",
};

// Shared cell styling — one place to tweak padding/colours (keeps the per-cell
// string literals from drifting apart).
const CELL = "padding:3px 8px;";
function decisionColor(d: string): string {
  return d === "KEEP" ? "var(--green)" : d === "DELETE" ? "var(--red)" : "var(--text-dim)";
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
function fmtTs(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}
function touchedCell(m: DiagMember): string {
  if (m.reason === "reviewed") return `<td style="${CELL}color:var(--green);">reviewed</td>`;
  if (m.reviewedBy) return `<td style="${CELL}color:var(--green);">reviewedBy: ${esc(m.reviewedBy)}</td>`;
  return `<td style="${CELL}color:var(--text-dim);">${esc(m.reason || "—")}</td>`;
}

function renderGroup(g: DiagGroup): string {
  const rows = g.members.map((m) => {
    const bg = m.decision === "DELETE" ? "background:rgba(239,68,68,0.10);" : "";
    return `<tr style="${bg}">
      <td style="${CELL}white-space:nowrap;">${fmtTs(m.completedAt)}</td>
      <td style="${CELL}text-align:right;">${m.score}</td>
      ${touchedCell(m)}
      <td style="${CELL}font-family:var(--mono);">${esc(m.recordingId || "—")}</td>
      <td style="${CELL}text-align:center;color:${decisionColor(m.decision)};font-weight:700;">${m.decision}</td>
    </tr>`;
  }).join("");
  return `<div style="border:1px solid var(--border);border-radius:6px;margin-bottom:8px;overflow:hidden;">
    <div style="background:var(--bg-2);padding:6px 10px;font-size:11px;display:flex;justify-content:space-between;gap:10px;">
      <span>Finding <strong style="font-family:var(--mono);">${esc(g.findingId)}</strong> — record <strong style="font-family:var(--mono);">${esc(g.recordId || "—")}</strong></span>
      <span style="color:var(--text-dim);">${g.rowCount} index rows → keep 1</span>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:11px;">
      <thead><tr style="color:var(--text-dim);text-align:left;">
        <th style="${CELL}font-weight:600;">Completed</th>
        <th style="${CELL}font-weight:600;text-align:right;">Score</th>
        <th style="${CELL}font-weight:600;">Touched</th>
        <th style="${CELL}font-weight:600;">Rec #</th>
        <th style="${CELL}font-weight:600;text-align:center;">Cleanup</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function renderDiagnosis(d: Diagnosis): string {
  const summary = `<div style="display:grid;gap:4px;margin-bottom:12px;font-size:12px;">
    <div style="color:var(--green);"><strong>Read-only diagnosis</strong> — nothing was deleted.</div>
    <div><strong>Scanned:</strong> ${d.scannedRows} index rows across ${d.distinctFindings} distinct findings</div>
    <div><strong>Findings with duplicate rows:</strong> ${d.findingsWithDupes}</div>
    <div><strong>Stale rows the cleanup would remove:</strong> ${d.staleRows} (each finding keeps exactly one row — never hidden)</div>
    <div style="color:var(--text-dim);font-size:11px;">Note: this counts only dupes whose rows both fall in the selected window. A finding whose audit and review rows straddle the range is missed — widen the range for a full sweep.</div>
  </div>`;
  const groups = d.sampleGroups.length
    ? `<div style="font-size:11px;color:var(--text-dim);margin-bottom:6px;">Showing ${d.sampleShown} of ${d.sampleTotal} findings with duplicate rows (most rows first). Pink = a stale row that would be removed. "Rec #" = recording (genie) number.</div>${d.sampleGroups.map(renderGroup).join("")}`
    : `<div style="font-size:12px;color:var(--text-dim);">No findings have duplicate index rows in this range.</div>`;
  return `<div style="max-height:60vh;overflow:auto;padding-right:4px;">${summary}${groups}</div>`;
}

function recordTouchedCell(m: RecordMember): string {
  if (m.reason === "perfect_score") return `<td style="${CELL}color:var(--green);">100% on entry</td>`;
  if (m.reason === "reviewed" || m.reviewedBy) return `<td style="${CELL}color:var(--green);">reviewed${m.reviewedBy ? `: ${esc(m.reviewedBy)}` : ""}</td>`;
  if (m.reason === "invalid_genie") return `<td style="${CELL}color:var(--text-dim);">invalid genie</td>`;
  return `<td style="${CELL}color:var(--text-dim);">—</td>`;
}

function renderRecordGroup(g: RecordGroup): string {
  if (g.appealSkipped) {
    return `<div style="border:1px solid var(--amber,#f59e0b);border-radius:6px;margin-bottom:8px;padding:8px 10px;font-size:11px;color:var(--amber,#f59e0b);">
      Record <strong style="font-family:var(--mono);">${esc(g.recordId)}</strong> — <strong>SKIPPED</strong>: a finding has a pending appeal. Resolve the appeal first, then re-run.
    </div>`;
  }
  const rows = g.members.map((m) => {
    const decision = m.keep ? "KEEP" : "EVICT";
    const bg = m.keep ? "" : "background:rgba(239,68,68,0.10);";
    const color = m.keep ? "var(--green)" : "var(--red)";
    return `<tr style="${bg}">
      <td style="${CELL}white-space:nowrap;">${fmtTs(m.startedAt || m.completedAt)}</td>
      <td style="${CELL}text-align:right;">${m.score}</td>
      ${recordTouchedCell(m)}
      <td style="${CELL}font-family:var(--mono);">${esc(m.findingId)}</td>
      <td style="${CELL}text-align:center;color:${color};font-weight:700;">${decision}</td>
    </tr>`;
  }).join("");
  return `<div style="border:1px solid var(--border);border-radius:6px;margin-bottom:8px;overflow:hidden;">
    <div style="background:var(--bg-2);padding:6px 10px;font-size:11px;display:flex;justify-content:space-between;gap:10px;">
      <span>Record <strong style="font-family:var(--mono);">${esc(g.recordId)}</strong> — ${g.members.length} audits → keep 1</span>
      <span style="color:var(--text-dim);">keeper won by <strong style="color:var(--green);">${esc(KEEPER_REASON[g.keeperReason] ?? g.keeperReason)}</strong></span>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:11px;">
      <thead><tr style="color:var(--text-dim);text-align:left;">
        <th style="${CELL}font-weight:600;">Audited</th>
        <th style="${CELL}font-weight:600;text-align:right;">Score</th>
        <th style="${CELL}font-weight:600;">Outcome</th>
        <th style="${CELL}font-weight:600;">Finding ID</th>
        <th style="${CELL}font-weight:600;text-align:center;">Action</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function renderRecordDiagnosis(d: RecordDiagnosis): string {
  const summary = `<div style="display:grid;gap:4px;margin-bottom:12px;font-size:12px;">
    <div style="color:var(--green);"><strong>Read-only diagnosis</strong> — nothing was changed.</div>
    <div><strong>Scanned:</strong> ${d.scannedRows} index rows</div>
    <div><strong>Records audited more than once:</strong> ${d.recordsWithDupes}</div>
    <div><strong>Duplicate audits that would be retired:</strong> ${d.losersToEvict} — each record keeps exactly one; losers stripped from payroll + all queues, raw audit kept.</div>
    ${d.appealSkips ? `<div style="color:var(--amber,#f59e0b);"><strong>Skipped (pending appeal):</strong> ${d.appealSkips} record(s) — resolve the appeal first.</div>` : ""}
    <div style="color:var(--text-dim);font-size:11px;">Note: only records with 2+ audits inside the selected window are detected — widen the range for a full sweep.</div>
  </div>`;
  const groups = d.sampleGroups.length
    ? `<div style="font-size:11px;color:var(--text-dim);margin-bottom:6px;">Showing ${Math.min(d.sampleGroups.length, d.sampleTotal)} of ${d.sampleTotal} records with duplicate audits (most audits first). Green KEEP = the finding kept; pink EVICT = retired.</div>${d.sampleGroups.map(renderRecordGroup).join("")}`
    : `<div style="font-size:12px;color:var(--text-dim);">No record was audited more than once in this range.</div>`;
  return `<div style="max-height:60vh;overflow:auto;padding-right:4px;">${summary}${groups}</div>`;
}

export const handler = define.handlers({
  async POST(ctx) {
    try {
      const body = await parseHtmxBody(ctx.req);
      const result = await apiPost<{ ok?: boolean; error?: string; pass?: string; diagnosis?: Diagnosis | RecordDiagnosis }>(
        "/admin/deduplicate-diagnose", ctx.req, body,
      );
      if (!result.ok || !result.diagnosis) {
        return new Response(`<span class="error-text">${esc(result.error ?? "Diagnose failed")}</span>`, {
          headers: { "content-type": "text/html" },
        });
      }
      const html = result.pass === "records"
        ? renderRecordDiagnosis(result.diagnosis as RecordDiagnosis)
        : renderDiagnosis(result.diagnosis as Diagnosis);
      return new Response(html, { headers: { "content-type": "text/html" } });
    } catch (e) {
      return new Response(`<span class="error-text">${esc(String(e))}</span>`, { headers: { "content-type": "text/html" } });
    }
  },
});
