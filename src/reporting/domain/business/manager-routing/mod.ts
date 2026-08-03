/** Manager routing — decides which weekly report an audit belongs to when its
 *  ActivatingOffice matches no report.
 *
 *  The office code stays the primary rule: an audit whose department some
 *  weekly report claims lands in that report, exactly as before. Only the
 *  leftovers — a new office code, GS WFH, TASK — are routed by the VO manager
 *  on the audit (QB field 851, "VO - Supervisor Email"), following their people
 *  into the report that already covers them.
 *
 *  Pure functions only; the caller does the reading. */

import type { EmailReportConfig, AuditDoneIndexEntry } from "@core/dto/types.ts";

/** Department strings compare case-insensitively (prod carries both "ACT MB"
 *  and "Act MB"), so every comparison goes through this. */
export function normalizeDept(dept: string | undefined): string {
  return String(dept ?? "").trim().toLowerCase();
}

/** Emails likewise. */
export function normalizeEmail(email: string | undefined): string {
  return String(email ?? "").trim().toLowerCase();
}

/** Every department code any weekly report names in a section rule. An audit in
 *  one of these is routed by department and never by manager — which is what
 *  keeps a manager who spans reports (garrettc: GS WST + WST Outbound + IDS A3N)
 *  split exactly as they are today. */
export function claimedDepartments(configs: EmailReportConfig[]): Set<string> {
  const claimed = new Set<string>();
  for (const config of configs) {
    if (!config.weeklyType) continue;
    if (config.enabled === false) continue;
    for (const section of (config.reportSections ?? [])) {
      for (const rule of (section.criteria ?? [])) {
        if (rule.field === "department" && rule.operator === "equals") {
          claimed.add(normalizeDept(rule.value));
        }
      }
    }
  }
  return claimed;
}

/** Split a QB SupervisorEmail value ("a@x.com, b@x.com") into addresses. The
 *  field names a whole management group on 28% of audits, so every listed
 *  manager counts as an owner. */
export function parseManagers(raw: unknown): string[] {
  return [...new Set(
    String(raw ?? "")
      .split(",")
      .map((s) => normalizeEmail(s))
      .filter((s) => s.includes("@") && !s.includes(" ")),
  )];
}

/** Audits this report should absorb: department claimed by NO report, and at
 *  least one of the audit's managers on this report's list. */
export function absorbedEntries(
  entries: AuditDoneIndexEntry[],
  managersByFinding: Map<string, string[]>,
  reportManagers: string[],
  claimed: Set<string>,
): AuditDoneIndexEntry[] {
  const mine = new Set(reportManagers.map(normalizeEmail));
  if (mine.size === 0) return [];
  return entries.filter((e) => {
    if (claimed.has(normalizeDept(e.department))) return false;
    const managers = managersByFinding.get(e.findingId) ?? [];
    return managers.some((m) => mine.has(m));
  });
}

/** Which section an absorbed audit joins.
 *
 *  It goes to the section that already holds audits from the SAME manager, so
 *  a person's off-code work lands on their existing card rather than starting a
 *  second one — the whole point of the exercise. `managerSectionCounts` is built
 *  from the audits that routed normally: manager email → section index → count.
 *  Falls back to the report's busiest section when a manager has no claimed
 *  audits here at all. Returns -1 only when the report has no sections. */
export function sectionForAbsorbed(
  managers: string[],
  managerSectionCounts: Map<string, Map<number, number>>,
  sectionRowCounts: number[],
): number {
  if (sectionRowCounts.length === 0) return -1;

  const tally = new Map<number, number>();
  for (const manager of managers) {
    const counts = managerSectionCounts.get(normalizeEmail(manager));
    if (!counts) continue;
    for (const [idx, n] of counts) tally.set(idx, (tally.get(idx) ?? 0) + n);
  }
  if (tally.size > 0) {
    // Most of this manager's work sits here — join it.
    return [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  }
  // No claimed audits from this manager: fall in with the report's main body.
  let best = 0;
  for (let i = 1; i < sectionRowCounts.length; i++) {
    if (sectionRowCounts[i] > sectionRowCounts[best]) best = i;
  }
  return best;
}
