/** Read-only dedup verification. Posts the date range to the backend's
 *  /admin/deduplicate-diagnose, which scans (never deletes) and reports what
 *  the cleanup WOULD do under both grouping strategies — current (group by
 *  recording #) vs the operator's model (group by record id) — with the
 *  keep/delete decision per finding. Renders an inline table so an operator
 *  can confirm correctness before ever running Execute. */
import { define } from "../../../lib/define.ts";
import { apiPost, parseHtmxBody } from "../../../lib/api.ts";

interface DiagMember {
  findingId: string;
  recordId: string;
  recordingId: string;
  score: number;
  reason: string;
  reviewed: boolean;
  reviewedBy: string;
  completedAt: number;
  decisionCurrent: "KEEP" | "DELETE" | "—";
  decisionByRecordId: "KEEP" | "DELETE" | "—";
}
interface DiagGroup {
  recordId: string;
  memberCount: number;
  distinctRecordingIds: number;
  missedByCurrent: number;
  members: DiagMember[];
}
interface Diagnosis {
  since: number;
  until: number;
  scanned: number;
  current: { groups: number; toDelete: number };
  byRecordId: { groups: number; toDelete: number };
  missedByCurrent: number;
  riskyGroups: number;
  reviewedByOnly: number;
  sampleGroups: DiagGroup[];
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
function fmtTs(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}
function decisionCell(d: string): string {
  const color = d === "KEEP" ? "var(--green)" : d === "DELETE" ? "var(--red)" : "var(--text-dim)";
  const weight = d === "—" ? "400" : "700";
  return `<td style="padding:3px 8px;color:${color};font-weight:${weight};text-align:center;">${d}</td>`;
}
function touchedCell(m: DiagMember): string {
  if (m.reviewed) return `<td style="padding:3px 8px;color:var(--green);">reviewed</td>`;
  if (m.reviewedBy) return `<td style="padding:3px 8px;color:var(--amber,#f59e0b);" title="has reviewedBy but reason≠reviewed — current keep-logic may not count this as touched">reviewedBy: ${esc(m.reviewedBy)}</td>`;
  return `<td style="padding:3px 8px;color:var(--text-dim);">${esc(m.reason || "—")}</td>`;
}

function renderGroup(g: DiagGroup): string {
  const flag = g.missedByCurrent > 0
    ? `<span style="color:var(--red);">⚠️ ${g.missedByCurrent} missed by current tool</span>`
    : g.distinctRecordingIds > 1
    ? `<span style="color:var(--amber,#f59e0b);">⚠️ ${g.distinctRecordingIds} distinct recordings (risky to merge)</span>`
    : `<span style="color:var(--text-dim);">${g.distinctRecordingIds} recording(s)</span>`;
  const rows = g.members.map((m) => {
    // Highlight findings this record-id group would delete but today's tool keeps.
    const missed = m.decisionByRecordId === "DELETE" && m.decisionCurrent !== "DELETE";
    const bg = missed ? "background:rgba(239,68,68,0.10);" : "";
    return `<tr style="${bg}">
      <td style="padding:3px 8px;font-family:var(--mono);font-size:10px;">${esc(m.findingId)}</td>
      <td style="padding:3px 8px;font-family:var(--mono);">${esc(m.recordingId || "—")}</td>
      <td style="padding:3px 8px;text-align:right;">${m.score}</td>
      ${touchedCell(m)}
      <td style="padding:3px 8px;white-space:nowrap;">${fmtTs(m.completedAt)}</td>
      ${decisionCell(m.decisionCurrent)}
      ${decisionCell(m.decisionByRecordId)}
    </tr>`;
  }).join("");
  return `<div style="border:1px solid var(--border);border-radius:6px;margin-bottom:8px;overflow:hidden;">
    <div style="background:var(--bg-2);padding:6px 10px;font-size:11px;display:flex;justify-content:space-between;gap:10px;">
      <span>Record <strong style="font-family:var(--mono);">${esc(g.recordId)}</strong> — ${g.memberCount} findings</span>
      ${flag}
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:11px;">
      <thead><tr style="color:var(--text-dim);text-align:left;">
        <th style="padding:3px 8px;font-weight:600;">Finding</th>
        <th style="padding:3px 8px;font-weight:600;">Rec #</th>
        <th style="padding:3px 8px;font-weight:600;text-align:right;">Score</th>
        <th style="padding:3px 8px;font-weight:600;">Touched</th>
        <th style="padding:3px 8px;font-weight:600;">Completed</th>
        <th style="padding:3px 8px;font-weight:600;text-align:center;" title="What today's tool (group by recording #) does">Current</th>
        <th style="padding:3px 8px;font-weight:600;text-align:center;" title="What grouping by record id would do">By record id</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function renderDiagnosis(d: Diagnosis): string {
  const summary = `<div style="display:grid;gap:4px;margin-bottom:12px;font-size:12px;">
    <div style="color:var(--green);"><strong>Read-only diagnosis</strong> — nothing was deleted.</div>
    <div><strong>Scanned:</strong> ${d.scanned} findings (excludes already-hidden + open-appeal)</div>
    <div><strong>Current tool</strong> (group by recording #): ${d.current.groups} groups, <strong>${d.current.toDelete}</strong> would delete</div>
    <div><strong>By record id</strong> (your model): ${d.byRecordId.groups} groups, <strong>${d.byRecordId.toDelete}</strong> would delete</div>
    ${d.missedByCurrent > 0
      ? `<div style="color:var(--red);">⚠️ <strong>${d.missedByCurrent}</strong> findings are duplicates by record id but the current tool keeps them — likely the "not deleting them all" you saw.</div>`
      : `<div style="color:var(--text-dim);">No record-id duplicates are missed by the current tool.</div>`}
    ${d.riskyGroups > 0
      ? `<div style="color:var(--amber,#f59e0b);">⚠️ <strong>${d.riskyGroups}</strong> record-id groups span more than one distinct recording — grouping by record id would merge DISTINCT recordings. Review these before changing the grouping.</div>`
      : ``}
    ${d.reviewedByOnly > 0
      ? `<div style="color:var(--amber,#f59e0b);">⚠️ <strong>${d.reviewedByOnly}</strong> findings have a reviewer (reviewedBy) but reason≠"reviewed" — today's keep-logic may not treat them as reviewed.</div>`
      : ``}
  </div>`;
  const groups = d.sampleGroups.length
    ? `<div style="font-size:11px;color:var(--text-dim);margin-bottom:6px;">Sample groups by record id (most informative first, max 40). Pink rows = a duplicate the current tool keeps. "Rec #" = recording (genie) number.</div>${d.sampleGroups.map(renderGroup).join("")}`
    : `<div style="font-size:12px;color:var(--text-dim);">No duplicate groups by record id in this range.</div>`;
  return `<div style="max-height:60vh;overflow:auto;padding-right:4px;">${summary}${groups}</div>`;
}

export const handler = define.handlers({
  async POST(ctx) {
    try {
      const body = await parseHtmxBody(ctx.req);
      const result = await apiPost<{ ok?: boolean; error?: string; diagnosis?: Diagnosis }>(
        "/admin/deduplicate-diagnose", ctx.req, body,
      );
      if (!result.ok || !result.diagnosis) {
        return new Response(`<span class="error-text">${esc(result.error ?? "Diagnose failed")}</span>`, {
          headers: { "content-type": "text/html" },
        });
      }
      return new Response(renderDiagnosis(result.diagnosis), { headers: { "content-type": "text/html" } });
    } catch (e) {
      return new Response(`<span class="error-text">${esc(String(e))}</span>`, { headers: { "content-type": "text/html" } });
    }
  },
});
