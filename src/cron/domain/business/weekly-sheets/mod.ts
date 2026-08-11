/** Weekly sheets export — posts chargebacks/omissions/wire to Google Sheets.
 *
 *  Single source of truth shared by the dashboard "Post to Sheet" button
 *  (ChargebackController) and the weekly cron, so the two never drift. The
 *  weekly auto-export was silently lost in the monolith→modular cutover (the
 *  cron was never re-registered), which is why the sheet went stale; cron-core
 *  now registers `weekly-sheets` again and both paths run this code. */

import type { OrgId } from "@core/data/deno-kv/mod.ts";
import { defaultOrgId } from "@core/business/auth/mod.ts";
import { setStoredIfAbsent } from "@core/data/firestore/mod.ts";
import { queryAuditDoneIndex, queryChargebackReport, queryWireReport } from "@reporting/domain/business/chargeback-report/mod.ts";
import { getReviewedFindingIds } from "@review/domain/business/review-queue/mod.ts";
import { getOfficeBypassConfig } from "@admin/domain/data/admin-repository/mod.ts";
import { loadSheetsCredentials, appendSheetRows } from "@core/data/google-sheets/mod.ts";
import { getSelfUrl } from "@core/data/qstash/mod.ts";
import { tzParts, zonedToMs } from "@reporting/domain/business/email-report-engine/mod.ts";

/** The reporting week resets at Eastern midnight, same as the email reports —
 *  never on the server's UTC clock. */
const SHEET_TZ = "America/New_York";

/** The last COMPLETE Mon 00:00:00.000 → Sun 23:59:59.999 week in Eastern time.
 *
 *  Anchored to the calendar, not to "yesterday minus six days" — the old form
 *  silently rewrote the window whenever the job's fire day moved, and it did
 *  move: `0 13 * * 1` ran on SUNDAYS in prod (Jul 12 / 19 / 26, Aug 2 / 9), so
 *  every export covered Sun→Sat instead of the Mon→Sun the name promised.
 *  Computed here for any fire day, so the window can't drift again. */
export function prevWeekWindow(now: Date): { since: number; until: number } {
  const p = tzParts(SHEET_TZ, now.getTime());
  const daysSinceMonday = (p.dow + 6) % 7; // Mon=0 … Sun=6
  // Day arithmetic on a UTC scratch date (no DST hours to fall into), then
  // project each boundary back through the zone.
  const cal = new Date(Date.UTC(p.year, p.month - 1, p.day));
  cal.setUTCDate(cal.getUTCDate() - daysSinceMonday - 7); // Monday, one week back
  const since = zonedToMs(SHEET_TZ, cal.getUTCFullYear(), cal.getUTCMonth() + 1, cal.getUTCDate(), 0, 0, 0, 0);
  cal.setUTCDate(cal.getUTCDate() + 7); // the Monday after it
  const until = zonedToMs(SHEET_TZ, cal.getUTCFullYear(), cal.getUTCMonth() + 1, cal.getUTCDate(), 0, 0, 0, 0) - 1;
  return { since, until };
}

/** Is `now` the scheduled slot — Tuesday 7:00 AM Eastern?
 *
 *  The cron field can't carry this. `0 13 * * 1` fired on Sundays in prod for
 *  five weeks straight, so the day-of-week number isn't trustworthy, and a
 *  fixed UTC hour would slip an hour at every DST change. So the job ticks
 *  hourly and this decides against the Eastern wall clock.
 *
 *  `>= 7`, not `=== 7`: a 7am tick lost to a deploy or a cold start is picked
 *  up by the next hour instead of skipping the week. The per-week claim key in
 *  runWeeklySheetsExport is what makes those extra ticks harmless. */
export function isWeeklySheetsFireTime(now: Date = new Date()): boolean {
  const p = tzParts(SHEET_TZ, now.getTime());
  return p.dow === 2 && p.hour >= 7;
}

export interface SheetExportResult {
  ok?: boolean;
  appended?: number;
  error?: string;
  skipped?: boolean;
}

/** Append chargeback/omission/wire rows for [since, until] to the configured
 *  Google Sheet. Tabs: "cb" → Chargebacks, "om" → Omissions, "wire" → Wire
 *  Deductions. Column order is LOAD-BEARING — it must match the existing prod
 *  tabs exactly (prod populates them via both the button and this cron). */
export async function exportChargebacksToSheet(
  orgId: OrgId,
  since: number,
  until: number,
  tabs: string,
): Promise<SheetExportResult> {
  if (!since || !until || !tabs) return { error: "since, until, tabs required" };
  const creds = await loadSheetsCredentials();
  if (!creds) {
    return {
      error: "Sheets not configured — set SHEETS_SA_S3_KEY + CHARGEBACKS_SHEET_ID env vars (S3 bucket already wired via S3_BUCKET).",
    };
  }
  const [reviewedIds, bypassCfg] = await Promise.all([
    getReviewedFindingIds(orgId),
    getOfficeBypassConfig(orgId),
  ]);
  // Column schemas (must match prod's existing tabs exactly):
  //   Chargebacks / Omissions (8): Date, Team Member, Revenue, CRM Link,
  //     Destination, Failed Questions, Score, Activating Office
  //   Wire Deductions (10): Date, Score, Questions Audited, Total Success,
  //     CRM Link, Audit Link, Office, Excellence Auditor, (empty), Guest Name
  //
  // Activating Office is APPENDED as column H, never inserted mid-schema —
  // existing sheet rows have only A:G, so inserting would misalign all history.
  //
  // A ChargebackEntry stores no department, so the office is joined in from
  // audit-done-idx by findingId. Both are keyed on `completedAt`, so the same
  // window lines up; the ±7d pad only guards against a re-audit shifting the
  // timestamp, and can never pull in an audit the report doesn't already list
  // (the lookup is by id). Fetched once, lazily — the cb and om tabs share it,
  // and a wire-only export never pays for it.
  const DEPT_PAD_MS = 7 * 24 * 60 * 60 * 1000;
  let deptMapPromise: Promise<Map<string, string>> | null = null;
  const loadDeptMap = (): Promise<Map<string, string>> => {
    deptMapPromise ??= queryAuditDoneIndex(orgId, since - DEPT_PAD_MS, until + DEPT_PAD_MS)
      .then((rows) => {
        const m = new Map<string, string>();
        for (const r of rows) if (r.findingId && r.department) m.set(r.findingId, r.department);
        console.log(`📊 [POST-TO-SHEET] office lookup built from ${rows.length} index rows → ${m.size} findings`);
        return m;
      })
      .catch((err) => {
        // The office column is additive — never fail the whole export over it.
        console.error(`⚠️ [POST-TO-SHEET] office lookup failed, column will be blank:`, err);
        return new Map<string, string>();
      });
    return deptMapPromise;
  };
  const QB_REALM = Deno.env.get("QB_REALM") ?? "monsterrg";
  const cbCrm = (recordId: string) => recordId ? `https://${QB_REALM}.quickbase.com/db/bpb28qsnn?a=dr&rid=${recordId}` : "";
  const wireCrm = (recordId: string) => recordId ? `https://${QB_REALM}.quickbase.com/nav/app/bmhvhc7sk/table/bttffb64u/action/dr?rid=${recordId}` : "";
  const auditUrl = (findingId: string) => findingId ? `${getSelfUrl()}/audit/report?id=${findingId}` : "";
  const fmtDate = (ts: number): string => ts ? new Date(ts).toLocaleDateString("en-US") : "";
  let appended = 0;
  const tabList = tabs.split(",").map((s) => s.trim()).filter(Boolean);
  try {
    for (const tab of tabList) {
      if (tab === "cb" || tab === "om") {
        const report = await queryChargebackReport(orgId, since, until, reviewedIds);
        const source = tab === "cb" ? (report.chargebacks ?? []) : (report.omissions ?? []);
        if (!source.length) continue;
        const deptMap = await loadDeptMap();
        const rows = source.map((e) => [
          fmtDate(e.ts),
          e.voName ?? "",
          e.revenue ?? "",
          cbCrm(e.recordId ?? ""),
          e.destination ?? "",
          (e.failedQHeaders ?? []).join(", "),
          typeof e.score === "number" ? `${e.score}%` : "",
          deptMap.get(e.findingId) ?? "",
        ] as (string | number)[]);
        const res = await appendSheetRows(creds, tab === "cb" ? "Chargebacks" : "Omissions", rows);
        appended += res.appended;
      } else if (tab === "wire") {
        const items = await queryWireReport(orgId, since, until, reviewedIds, bypassCfg.patterns);
        if (!items.length) continue;
        const rows = items.map((e) => [
          fmtDate(e.ts),
          typeof e.score === "number" ? `${e.score}%` : "",
          String(e.questionsAudited ?? ""),
          String(e.totalSuccess ?? ""),
          wireCrm(e.recordId ?? ""),
          auditUrl(e.findingId ?? ""),
          e.office ?? "",
          e.excellenceAuditor ?? "",
          "", // intentional empty — matches prod schema (Date of Booking placeholder)
          e.guestName ?? "",
        ] as (string | number)[]);
        const res = await appendSheetRows(creds, "Wire Deductions", rows);
        appended += res.appended;
      }
    }
  } catch (err) {
    console.error(`❌ [POST-TO-SHEET] failed:`, err);
    return { error: (err as Error).message };
  }
  console.log(`📊 [POST-TO-SHEET] appended ${appended} rows across tabs [${tabList.join(",")}]`);
  return { ok: true, appended };
}

/** Weekly cron entry + manual "trigger weekly sheets": post the just-completed
 *  week's chargebacks/omissions/wire to the sheet. Idempotent per (org, week)
 *  via a claim key — appends are NOT idempotent, so a retry or a second fire
 *  must never double-post. The claim is taken before the export and never
 *  released (at-most-once per week); a failed week is re-runnable via the
 *  ad-hoc "Post to Sheet" button, which bypasses the claim. */
export async function runWeeklySheetsExport(now: Date = new Date()): Promise<SheetExportResult> {
  const orgId = defaultOrgId() as OrgId;
  const { since, until } = prevWeekWindow(now);
  const weekLabel = new Date(since).toISOString().slice(0, 10);
  const claimed = await setStoredIfAbsent(
    "weekly-sheets-claim", orgId, [since], { since, until },
    { expireInMs: 8 * 24 * 60 * 60 * 1000 }, // clears before the same week recurs
  );
  if (!claimed) {
    console.log(`⏰ [CRON:weekly-sheets] week of ${weekLabel} already posted — skipping`);
    return { ok: true, appended: 0, skipped: true };
  }
  const result = await exportChargebacksToSheet(orgId, since, until, "cb,om,wire");
  if (result.error) console.error(`❌ [CRON:weekly-sheets] week of ${weekLabel} failed: ${result.error}`);
  return result;
}
