/** Weekly digest — the per-shift / per-team-member view the weekly audit
 *  reports render, replacing the flat row table.
 *
 *  Two renderings off ONE aggregation:
 *    - `renderDigestEmail`  light, flat (no <details>) — the email body.
 *    - `renderDigestPage`   dark, expandable, itemised — the /r/<slug> page.
 *
 *  Pure functions only: no KV, no Firestore, no network. The caller supplies
 *  the report's rows and a findingId -> failed-question map (both already
 *  read from the two indexes) so this module stays unit-testable. */

// Type-only (erased at runtime) — the engine imports this module for real, so a
// value import here would be a cycle.
import type { ReportRow, SectionResult } from "@reporting/domain/business/email-report-engine/mod.ts";

// ── Labels ────────────────────────────────────────────────────────────────────

/** Verbatim question headers shortened for the report. Every key is a header
 *  audits actually carry (verified against the failed-question index); an
 *  unknown header passes through unchanged rather than being dropped. */
export const QUESTION_LABELS: Record<string, string> = {
  "Correct Days & Nights": "Travel Dates",
  "9% Service Fee": "11% Service Fee",
  "# in Room": "Occupancy",
  "Credit Card Number is Not Read on VO?": "CC# Read",
  "US or Canadian Citizen?": "Citizenship",
  "MCC Recurring Charges Disclosed?": "MCC Disclosed",
  "MCC Not Egregious?": "MCC Egregious",
  "Understand Reschedule Process": "WGS Disclosure",
  "Confirmation Expectations": "Conf Email",
  "Attending Presentation Together?": "Presentation",
  "No Pets": "Pet Policy",
  "No Group Travel": "Group Travel",
};

/** Short label for a question header (identity for anything unmapped). */
export function shortQuestionLabel(header: string): string {
  const h = String(header ?? "").trim();
  return QUESTION_LABELS[h] ?? h;
}

/** Shift values relabelled for the report — the audits carry "Weekend", the
 *  floor calls it WW. */
const SHIFT_LABELS: Record<string, string> = { Weekend: "WW" };

/** Reading order for shift groups; anything unlisted sorts after, by name. */
const SHIFT_ORDER = ["AM", "PM", "WW", "WFH"];

/** Rows with no shift on them still have to land somewhere. */
const NO_SHIFT = "Unassigned";

/** The bucket for an audit whose VO name is blank. */
const NO_NAME = "Other";

/** Genie-invalid audits are counted as a failure but have no failed question,
 *  so they ride along as their own line at the BOTTOM of a category list. */
const GENIE_LABEL = "Genie Invalid";

/** Categories shown per card in the EMAIL (the page shows all of them). */
const EMAIL_CATEGORY_CAP = 5;

/** At or above this pass rate a card reads as healthy (blue), below it as
 *  failing (red). */
const HEALTHY_PASS_PCT = 70;

// ── Shapes ────────────────────────────────────────────────────────────────────

export interface LabelCount {
  label: string;
  count: number;
  /** The Genie Invalid line, which renders in amber and always sorts last. */
  genie?: boolean;
}

export interface DigestAudit {
  recordId?: string;
  findingId?: string;
  score?: number;
  /** Short labels for every question this audit failed. */
  categories: string[];
}

export interface DigestMember {
  name: string;
  total: number;
  passed: number;
  failed: number;
  genieInvalid: number;
  /** 100 − round(failed ÷ total), so the three numbers always reconcile. */
  passPct: number;
  categories: LabelCount[];
  /** Failed audits we can itemise (they have question-level rows), worst-first. */
  failedAudits: DigestAudit[];
  /** Every non-genie failed audit, itemisable or not — the "9 of 10" denominator. */
  failedAuditTotal: number;
}

export interface DigestGroup {
  label: string;
  total: number;
  passed: number;
  failed: number;
  passPct: number;
  failPct: number;
  genieInvalid: number;
  categories: LabelCount[];
  members: DigestMember[];
}

export interface DigestOptions {
  /** Report title (the config name). */
  title: string;
  /** "Week of Jul 13 – Jul 19, 2026". */
  weekLabel: string;
  /** "Jul 20, 2026, 9:00 AM" — footer stamp. */
  generatedAt: string;
  /** Rendered after the last group in the email (the full-report button). */
  footerHtml?: string;
}

// ── Aggregation ───────────────────────────────────────────────────────────────

/** A fail counts when the audit scored under 100 OR its genie was invalid —
 *  an invalid genie has no score to speak of but is never a pass. */
function isFailedRow(row: ReportRow): boolean {
  return row.invalidGenie === true || (row.score ?? 100) < 100;
}

/** count desc, then label asc — deterministic, with Genie Invalid pinned last. */
function rankCategories(counts: Map<string, number>, genieInvalid: number): LabelCount[] {
  const ranked: LabelCount[] = [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  if (genieInvalid > 0) ranked.push({ label: GENIE_LABEL, count: genieInvalid, genie: true });
  return ranked;
}

/** Cap a ranked list for the email: the top `cap` questions, plus the Genie
 *  Invalid line if there is one — it is kept even when it ranks below the cap. */
export function capCategories(categories: LabelCount[], cap = EMAIL_CATEGORY_CAP): LabelCount[] {
  const genie = categories.filter((c) => c.genie);
  const rest = categories.filter((c) => !c.genie).slice(0, cap);
  return [...rest, ...genie];
}

/** Pass rate as the report states it: derived from the FAIL count so that
 *  "77%", "7 Failed" and "24 Passed" can never disagree. */
export function passPercent(failed: number, total: number): number {
  if (total <= 0) return 0;
  return 100 - Math.round((failed / total) * 100);
}

function shiftLabel(shift: string): string {
  const s = shift.trim();
  return SHIFT_LABELS[s] ?? s;
}

function shiftRank(label: string): number {
  const i = SHIFT_ORDER.indexOf(label);
  if (i >= 0) return i;
  return label === NO_SHIFT ? SHIFT_ORDER.length + 1 : SHIFT_ORDER.length;
}

function buildMember(name: string, rows: ReportRow[], failsByFinding: Map<string, string[]>): DigestMember {
  const counts = new Map<string, number>();
  const failedAudits: DigestAudit[] = [];
  let failed = 0;
  let genieInvalid = 0;
  let failedAuditTotal = 0;

  for (const row of rows) {
    if (row.invalidGenie) genieInvalid++;
    if (!isFailedRow(row)) continue;
    failed++;
    if (row.invalidGenie) continue; // no questions to itemise — it never graded

    failedAuditTotal++;
    const categories = row.findingId ? (failsByFinding.get(row.findingId) ?? []) : [];
    for (const c of categories) counts.set(c, (counts.get(c) ?? 0) + 1);
    if (categories.length > 0) {
      failedAudits.push({ recordId: row.recordId, findingId: row.findingId, score: row.score, categories });
    }
  }

  // Least-bad first, matching how the audits read down the page.
  failedAudits.sort((a, b) =>
    (b.score ?? 0) - (a.score ?? 0) || Number(b.recordId ?? 0) - Number(a.recordId ?? 0)
  );

  return {
    name,
    total: rows.length,
    passed: rows.length - failed,
    failed,
    genieInvalid,
    passPct: passPercent(failed, rows.length),
    categories: rankCategories(counts, genieInvalid),
    failedAudits,
    failedAuditTotal,
  };
}

function buildGroup(label: string, rows: ReportRow[], failsByFinding: Map<string, string[]>): DigestGroup {
  const byName = new Map<string, ReportRow[]>();
  for (const row of rows) {
    const name = (row.voName ?? "").trim() || NO_NAME;
    (byName.get(name) ?? byName.set(name, []).get(name)!).push(row);
  }

  const members = [...byName.entries()]
    .map(([name, memberRows]) => buildMember(name, memberRows, failsByFinding))
    // Most VOs completed first; everyone is shown.
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  const counts = new Map<string, number>();
  let failed = 0;
  let genieInvalid = 0;
  for (const m of members) {
    failed += m.failed;
    genieInvalid += m.genieInvalid;
    for (const c of m.categories) {
      if (c.genie) continue;
      counts.set(c.label, (counts.get(c.label) ?? 0) + c.count);
    }
  }

  const total = rows.length;
  const passPct = passPercent(failed, total);
  return {
    label,
    total,
    passed: total - failed,
    failed,
    passPct,
    failPct: total > 0 ? 100 - passPct : 0,
    genieInvalid,
    categories: rankCategories(counts, genieInvalid),
    members,
  };
}

/** Split the report's sections into the digest's groups: one group per shift
 *  when a section spans more than one, otherwise one group for the section.
 *  A multi-section report prefixes each group with its section so "AM" can't
 *  be mistaken for another department's AM.
 *
 *  `splitByShift: false` keeps one group per section — for reports where the
 *  departments, not the shifts, are how the floor thinks about the work. */
export function buildDigest(
  sections: SectionResult[],
  failsByFinding: Map<string, string[]>,
  splitByShift = true,
): DigestGroup[] {
  const prefix = sections.filter((s) => s.rows.length > 0).length > 1;
  const groups: DigestGroup[] = [];

  for (const section of sections) {
    if (section.rows.length === 0) continue;

    const byShift = new Map<string, ReportRow[]>();
    for (const row of section.rows) {
      const label = shiftLabel(row.shift ?? "") || NO_SHIFT;
      (byShift.get(label) ?? byShift.set(label, []).get(label)!).push(row);
    }

    if (!splitByShift || byShift.size < 2) {
      groups.push(buildGroup(section.header, section.rows, failsByFinding));
      continue;
    }

    const ordered = [...byShift.entries()].sort(
      (a, b) => shiftRank(a[0]) - shiftRank(b[0]) || a[0].localeCompare(b[0]),
    );
    for (const [label, rows] of ordered) {
      groups.push(buildGroup(prefix ? `${section.header} — ${label}` : label, rows, failsByFinding));
    }
  }

  return groups;
}

// ── Palettes ──────────────────────────────────────────────────────────────────

/** Light theme — the email body. Every value is inlined per element because
 *  Gmail strips <style> blocks in the body. */
const L = {
  bg: "#ffffff",
  card: "#f6f8fa",
  border: "#d0d7de",
  text: "#1f2328",
  body: "#3d444d",
  muted: "#59636e",
  dim: "#818b98",
  green: "#1a7f37",
  red: "#cf222e",
  blue: "#0969da",
  amber: "#9a6700",
  passBg: "#f2f7fd",
  failBg: "#fff5f5",
};

/** Dark theme — the browser page at /r/<slug>. */
const D = {
  bg: "#0b0f15",
  card: "#161c28",
  border: "#1c2333",
  text: "#c9d1d9",
  bright: "#e6edf3",
  muted: "#6e7681",
  dim: "#484f58",
  blue: "#58a6ff",
  red: "#f85149",
  amber: "#d29922",
  passBg: "rgba(88,166,255,0.07)",
  failBg: "rgba(248,81,73,0.08)",
};

/** The "Highest Number of Fails" block, or the right sentence when there is
 *  nothing to list. A heading with an empty list underneath reads as data gone
 *  missing, so a clean group says so outright, and a group whose failures have
 *  no question detail admits that rather than implying zero. */
function failListHtml(
  group: DigestGroup,
  render: { heading: (t: string) => string; note: (t: string) => string; rows: (c: LabelCount[]) => string },
): string {
  if (group.failed === 0) return render.note("No failed audits this week.");
  const capped = capCategories(group.categories);
  if (capped.length === 0) return render.note("Failures recorded, but no question detail is available for them.");
  return render.heading("Highest Number of Fails") + render.rows(capped);
}

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "tm";
}

// ── Email rendering (light, flat) ─────────────────────────────────────────────

function emailCountRows(categories: LabelCount[]): string {
  return categories.map((c) => `<tr><td style="padding:2px 8px 2px 0;font-size:13px;color:${c.genie ? L.amber : L.body};">&bull; ${esc(c.label)}</td><td align="right" style="padding:2px 0;font-size:13px;font-weight:600;color:${L.text};">${c.count}</td></tr>`).join("");
}

function emailGroupSummary(group: DigestGroup): string {
  return `
    <div style="padding:20px 24px;background:${L.card};border:1px solid ${L.border};border-radius:8px;margin-bottom:16px;">
      <p style="margin:0 0 14px 0;font-size:16px;font-weight:700;color:${L.text};">Results: <span style="color:${L.green};">${group.passPct}% Pass</span> <span style="color:${L.muted};">/</span> <span style="color:${L.red};">${group.failPct}% Fail</span></p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;table-layout:fixed;max-width:360px;">
        <tr><td style="padding:3px 0;font-size:13px;color:${L.muted};">Total Audits</td><td width="56" align="right" style="padding:3px 0;font-size:13px;font-weight:600;color:${L.text};">${group.total}</td></tr>
      </table>
      ${failListHtml(group, {
        heading: (t) => `<p style="margin:14px 0 4px 0;font-size:13px;font-weight:600;color:${L.text};">${t}</p>`,
        note: (t) => `<p style="margin:14px 0 0 0;font-size:13px;color:${L.muted};font-style:italic;">${t}</p>`,
        rows: (c) => `<div style="max-width:360px;"><table width="100%" style="border-collapse:collapse;line-height:1.45;">${emailCountRows(c)}</table></div>`,
      })}
    </div>`;
}

function emailMemberCard(member: DigestMember): string {
  const healthy = member.passPct >= HEALTHY_PASS_PCT;
  const accent = healthy ? L.blue : L.red;
  const bg = healthy ? L.passBg : L.failBg;
  const categories = capCategories(member.categories);
  const categoryHtml = categories.length > 0
    ? `<table width="100%" style="border-collapse:collapse;line-height:1.45;">${emailCountRows(categories)}</table>`
    // "None" next to a fail count reads as a contradiction — only a clean week
    // has none; otherwise the detail is missing, and the card should say that.
    : `<p style="margin:0;font-size:13px;color:${L.muted};font-style:italic;">${member.failed > 0 ? "Not recorded" : "None"}</p>`;

  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;background:${bg};border:1px solid ${L.border};border-left:3px solid ${accent};border-radius:8px;font-family:inherit;"><tr><td class="cl" valign="top" width="40%" style="padding:16px 20px;border-right:1px solid ${L.border};"><p style="margin:0;font-size:15px;font-weight:700;color:${L.text};">${esc(member.name)} <span style="color:${healthy ? L.green : L.red};">${member.passPct}%</span></p><p style="margin:6px 0 0 0;font-size:13px;white-space:nowrap;"><span style="color:${L.red};font-weight:700;">${member.failed}</span> <span style="color:${L.muted};">Failed</span> <span style="color:${L.muted};">/</span> <span style="color:${L.green};font-weight:700;">${member.passed}</span> <span style="color:${L.muted};">Passed</span></p><p style="margin:10px 0 0 0;font-size:13px;color:${L.muted};white-space:nowrap;">VOs Completed: <span style="color:${L.text};font-weight:600;">${member.total}</span></p></td><td class="cr" valign="top" style="padding:16px 20px;"><p style="margin:0 0 5px 0;font-size:13px;font-weight:700;color:${L.text};">Categories Failed</p>${categoryHtml}</td></tr></table>`;
}

/** The full light-theme email document. `maxMembersPerGroup` trims the longest
 *  reports down under Gmail's clip limit while keeping every group's summary. */
export function renderDigestEmail(
  groups: DigestGroup[],
  opts: DigestOptions,
  maxMembersPerGroup = Number.POSITIVE_INFINITY,
): string {
  const body = groups.map((group) => {
    const shown = group.members.slice(0, maxMembersPerGroup);
    const hidden = group.members.length - shown.length;
    const more = hidden > 0
      ? `<p style="margin:0 0 10px 0;font-size:13px;color:${L.muted};font-style:italic;">+ ${hidden} more team ${hidden === 1 ? "member" : "members"} in the full report.</p>`
      : "";
    return `
  <tr><td style="padding:0 0 8px 0;">
    <p style="margin:0 0 10px 0;font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:1.5px;color:${L.text};">${esc(group.label)}</p>
${emailGroupSummary(group)}
    ${shown.map(emailMemberCard).join("")}${more}
  </td></tr>
  <tr><td style="padding:0 0 22px 0;"></td></tr>`;
  }).join("\n");

  const empty = `
  <tr><td style="padding:0 0 22px 0;">
    <p style="margin:0;font-size:14px;color:${L.muted};font-style:italic;">No audits completed in this window.</p>
  </td></tr>`;

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opts.title)} &mdash; Weekly Report</title>
<style>
@media only screen and (max-width:480px) {
  .cl, .cr { display:block !important; width:100% !important; box-sizing:border-box !important; }
  .cl { border-right:none !important; border-bottom:1px solid ${L.border} !important; padding:14px 16px 12px 16px !important; }
  .cr { padding:12px 16px 14px 16px !important; }
  .wrap { padding:20px 10px !important; }
}
</style></head>
<body style="margin:0;padding:0;background:${L.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:${L.bg};"><tr><td class="wrap" align="center" style="padding:40px 16px;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:820px;">

  <tr><td style="padding:0 0 24px 0;">
    <p style="margin:0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:${L.dim};">AutoBot</p>
    <h1 style="margin:6px 0 4px 0;font-size:22px;font-weight:800;color:${L.text};letter-spacing:-0.5px;">${esc(opts.title)}</h1>
    <p style="margin:0;font-size:13px;color:${L.muted};">${esc(opts.weekLabel)}</p>
  </td></tr>
  <tr><td style="padding:0 0 24px 0;border-top:1px solid ${L.border};"></td></tr>
${groups.length > 0 ? body : empty}
${opts.footerHtml ? `  <tr><td>${opts.footerHtml}</td></tr>` : ""}
  <tr><td style="padding:20px 0 0 0;border-top:1px solid ${L.border};">
    <p style="margin:0;font-size:11px;color:${L.dim};text-align:center;">Autobottom &mdash; generated ${esc(opts.generatedAt)} EST</p>
  </td></tr>

</table></td></tr></table></body></html>`;
}

// ── Page rendering (dark, expandable) ─────────────────────────────────────────

function pageCountRows(categories: LabelCount[], pad: string): string {
  return categories.map((c) => `<tr><td style="padding:${pad} 0;font-size:13px;color:${c.genie ? D.amber : D.text};">&ndash; ${esc(c.label)}</td><td style="padding:${pad} 0 ${pad} 16px;font-size:13px;font-weight:600;color:${D.bright};text-align:right;width:56px;">${c.count}</td></tr>`).join("");
}

function pageGroupSummary(group: DigestGroup): string {
  return `
    <div style="padding:20px 24px;background:${D.card};border:1px solid ${D.border};border-radius:8px;margin-bottom:16px;">
      <p style="margin:0 0 14px 0;font-size:16px;font-weight:700;color:${D.bright};">Results: <span style="color:${D.blue};">${group.passPct}% Pass</span> <span style="color:${D.muted};">/</span> <span style="color:${D.red};">${group.failPct}% Fail</span></p>
      <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr><td style="padding:3px 0;font-size:13px;color:${D.muted};">Total Audits</td><td style="padding:3px 0 3px 16px;font-size:13px;font-weight:600;color:${D.bright};text-align:right;width:56px;">${group.total}</td></tr>
      </table>
      ${failListHtml(group, {
        heading: (t) => `<p style="margin:14px 0 4px 0;font-size:13px;font-weight:600;color:${D.bright};">${t}</p>`,
        note: (t) => `<p style="margin:14px 0 0 0;font-size:13px;color:${D.muted};font-style:italic;">${t}</p>`,
        rows: (c) => `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${pageCountRows(c, "3px")}</table>`,
      })}
    </div>`;
}

export interface PageLinks {
  /** QuickBase deep-link for a record id. */
  recordUrl: (recordId: string) => string;
  /** Autobottom audit-report page for a finding id. */
  findingUrl: (findingId: string) => string;
}

function pageFailedAudits(member: DigestMember, links: PageLinks): string {
  if (member.failedAuditTotal === 0) return "";
  const shown = member.failedAudits.length;
  // Say so out loud when the question-level index doesn't cover every failure,
  // rather than implying the itemised list is the whole story.
  const heading = shown === member.failedAuditTotal
    ? `Failed Audits (${shown})`
    : `Failed Audits &mdash; itemised (${shown} of ${member.failedAuditTotal})`;
  if (shown === 0) {
    return `<p style="margin:0 0 6px 0;font-size:13px;font-weight:600;color:${D.bright};">${heading}</p>`;
  }
  const rows = member.failedAudits.map((a) => {
    const rid = a.recordId
      ? `<a href="${links.recordUrl(a.recordId)}" style="color:${D.blue};text-decoration:none;">${esc(a.recordId)}</a>`
      : `<span style="color:${D.dim};">&mdash;</span>`;
    const score = a.score != null ? `${a.score}%` : "&mdash;";
    const scoreCell = a.findingId
      ? `<a href="${links.findingUrl(a.findingId)}" style="color:${D.red};text-decoration:none;">${score}</a>`
      : score;
    return `<tr><td style="padding:6px 10px 6px 0;font-size:12px;color:${D.blue};font-family:monospace;white-space:nowrap;">${rid}</td><td style="padding:6px 10px 6px 0;font-size:12px;font-weight:700;color:${D.red};white-space:nowrap;">${scoreCell}</td><td style="padding:6px 0;font-size:12px;color:${D.text};line-height:1.5;">${esc(a.categories.join(", "))}</td></tr>`;
  }).join("");
  return `<p style="margin:0 0 6px 0;font-size:13px;font-weight:600;color:${D.bright};">${heading}</p><table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;">${rows}</table>`;
}

function pageMemberCard(member: DigestMember, links: PageLinks): string {
  const healthy = member.passPct >= HEALTHY_PASS_PCT;
  const accent = healthy ? D.blue : D.red;
  const bg = healthy ? D.passBg : D.failBg;
  const genie = member.genieInvalid > 0
    ? `<span style="color:${D.amber};font-weight:400;">&nbsp;&nbsp;&middot;&nbsp;&nbsp;${member.genieInvalid} genie invalid</span>`
    : "";
  const detail = member.failed === 0
    ? `<p style="margin:0 0 14px 0;font-size:13px;color:${D.muted};font-style:italic;">No failed categories &mdash; a clean week.</p>`
    : member.categories.length === 0
    ? `<p style="margin:0 0 14px 0;font-size:13px;color:${D.muted};font-style:italic;">${member.failed} failed, but no question detail is available for ${member.failed === 1 ? "it" : "them"}.</p>`
    : `<p style="margin:0 0 4px 0;font-size:13px;font-weight:600;color:${D.bright};">All Categories Failed</p><table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:14px;">${pageCountRows(member.categories, "4px")}</table>${pageFailedAudits(member, links)}`;

  return `<details id="tm-${slugify(member.name)}" style="margin:0 0 8px 0;background:${bg};border:1px solid ${D.border};border-left:3px solid ${accent};border-radius:8px;">
  <summary style="padding:12px 16px;cursor:pointer;font-size:14px;color:${D.bright};">
    <span style="font-weight:700;">${esc(member.name)}</span>
    <span style="color:${accent};font-weight:700;">&nbsp;&nbsp;${member.passed}/${member.total} (${member.passPct}%)</span>
    <span style="color:${D.muted};font-weight:400;">&nbsp;&nbsp;&middot;&nbsp;&nbsp;${member.failed} failed</span>${genie}
  </summary>
  <div style="padding:4px 16px 16px 16px;">
    ${detail}
  </div>
</details>`;
}

/** The full dark-theme browser page — every team member, every itemised
 *  failure, collapsed behind a click. */
export function renderDigestPage(groups: DigestGroup[], opts: DigestOptions, links: PageLinks): string {
  const body = groups.map((group) => `
  <tr><td style="padding:0 0 10px 0;">
    <p style="margin:0 0 10px 0;font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:1.5px;color:${D.bright};">${esc(group.label)}</p>
${pageGroupSummary(group)}
    ${group.members.map((m) => pageMemberCard(m, links)).join("")}
  </td></tr>
  <tr><td style="padding:0 0 22px 0;"></td></tr>`).join("\n");

  const empty = `
  <tr><td style="padding:0 0 22px 0;">
    <p style="margin:0;font-size:14px;color:${D.muted};font-style:italic;">No audits completed in this window.</p>
  </td></tr>`;

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opts.title)} &mdash; Full Report</title></head>
<body style="margin:0;padding:0;background:${D.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:${D.bg};"><tr><td align="center" style="padding:40px 16px;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:820px;">
  <tr><td style="padding:0 0 24px 0;">
    <p style="margin:0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:${D.dim};">AutoBot</p>
    <h1 style="margin:6px 0 4px 0;font-size:22px;font-weight:800;color:${D.bright};letter-spacing:-0.5px;">${esc(opts.title)}</h1>
    <p style="margin:0;font-size:13px;color:${D.muted};">${esc(opts.weekLabel)} &nbsp;&middot;&nbsp; full report &mdash; click a name to expand</p>
  </td></tr>
  <tr><td style="padding:0 0 24px 0;border-top:1px solid ${D.border};"></td></tr>
${groups.length > 0 ? body : empty}
  <tr><td style="padding:20px 0 0 0;border-top:1px solid ${D.border};">
    <p style="margin:0;font-size:11px;color:${D.dim};text-align:center;">Autobottom &mdash; generated ${esc(opts.generatedAt)} EST</p>
  </td></tr>
</table></td></tr></table></body></html>`;
}
