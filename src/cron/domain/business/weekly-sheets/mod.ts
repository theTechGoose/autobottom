/** Weekly sheets export — posts chargebacks/omissions/wire to Google Sheets.
 *
 *  Single source of truth shared by the dashboard "Post to Sheet" button
 *  (ChargebackController) and the weekly cron, so the two never drift. The
 *  weekly auto-export was silently lost in the monolith→modular cutover (the
 *  cron was never re-registered), which is why the sheet went stale; cron-core
 *  now registers `weekly-sheets` again and both paths run this code. */

import type { OrgId } from "@core/data/deno-kv/mod.ts";
import { defaultOrgId } from "@core/business/auth/mod.ts";
import { deleteStored, getStored, setStored, setStoredIfAbsent } from "@core/data/firestore/mod.ts";
import { queryAuditDoneIndex, queryChargebackReport, queryWireReport } from "@reporting/domain/business/chargeback-report/mod.ts";
import { getReviewedFindingIds } from "@review/domain/business/review-queue/mod.ts";
import { getOfficeBypassConfig } from "@admin/domain/data/admin-repository/mod.ts";
import { loadSheetsCredentials, appendSheetRows, readSheetColumns } from "@core/data/google-sheets/mod.ts";
import type { SheetsCredentials } from "@core/data/google-sheets/mod.ts";
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

/** The two scheduled posts, each on its own day.
 *
 *  Wire deductions had their own Monday cron until the Apr 14 legacy sweep
 *  deleted `main.ts`; the Jun 16 restore folded all three tabs into one job and
 *  wire has been riding along with chargebacks ever since. Split back here.
 *
 *  `dow` is the Eastern day (1 = Monday, 2 = Tuesday) and is deliberately NOT
 *  the cron day-of-week field — `0 13 * * 1` fired on SUNDAYS in prod for five
 *  weeks straight, so that field isn't trustworthy. */
export const SHEET_JOBS = {
  wire: { dow: 1, hour: 9, tabs: "wire", label: "Wire Deductions" },
  chargebacks: { dow: 2, hour: 9, tabs: "cb,om", label: "Chargebacks + Omissions" },
} as const;

export type SheetJobName = keyof typeof SHEET_JOBS;

export const SHEET_JOB_NAMES = Object.keys(SHEET_JOBS) as SheetJobName[];

/** Is `now` this job's scheduled slot, on the Eastern wall clock?
 *
 *  A fixed UTC hour would slip an hour at every DST change, so the jobs tick
 *  hourly and this decides.
 *
 *  `>= hour`, not `=== hour`: a 9am tick lost to a deploy or a cold start is
 *  picked up by the next hour instead of skipping the week. The per-week claim
 *  in runWeeklySheetsExport is what makes those extra ticks harmless. */
export function isWeeklySheetsFireTime(job: SheetJobName, now: Date = new Date()): boolean {
  const { dow, hour } = SHEET_JOBS[job];
  const p = tzParts(SHEET_TZ, now.getTime());
  return p.dow === dow && p.hour >= hour;
}

export interface SheetExportResult {
  ok?: boolean;
  appended?: number;
  error?: string;
  skipped?: boolean;
  /** Rows dropped because that tab already carried them. */
  duplicates?: number;
}

/** ── Duplicate guard ────────────────────────────────────────────────────────
 *
 *  The per-week claim key is not enough on its own. It is keyed on the window
 *  START, so any change to `prevWeekWindow` makes the same week look like a new
 *  one — that is exactly how the week of 2026-08-03 got posted twice (a Sunday
 *  misfire covering Aug 2–8, then the ET-anchored Tuesday run covering Aug 3–9,
 *  claim keys Aug 2 vs Aug 3). The ad-hoc "Post to Sheet" button takes no claim
 *  at all, so any operator re-running a range double-posts it outright.
 *
 *  Appends are the only write, so the sheet itself is the source of truth for
 *  what has already been posted: re-derive each candidate row's key from the
 *  same columns already on the tab, and drop the ones that are there. */

/** Canonical form of one key cell.
 *
 *  Dates need it: rows are appended `USER_ENTERED`, so Google parses "8/5/2026"
 *  into a real date and hands back whatever the sheet's locale renders — often
 *  "08/05/2026". Compared raw, no key would ever match and the guard would
 *  silently pass everything through. URLs fall through unchanged. */
export function normKeyCell(value: string | number): string {
  const s = String(value ?? "").trim();
  const mdy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  const ymd = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, "0")}-${ymd[3].padStart(2, "0")}`;
  return s.toLowerCase();
}

/** Joins the key parts. A character that cannot occur in a date or a URL, so
 *  two different cell splits can never collide into the same key. */
const KEY_SEP = "|";

/** Dedup key for one row, from the given column indexes.
 *
 *  Returns "" when any part is blank — an un-keyable row is always appended.
 *  Suppressing a row on a partial match would lose real data, which is strictly
 *  worse than the duplicate this guard exists to prevent. */
export function rowKey(row: (string | number)[], idx: number[]): string {
  const cells = idx.map((i) => normKeyCell(row[i] ?? ""));
  return cells.every(Boolean) ? cells.join(KEY_SEP) : "";
}

/** Keys already on the tab, from column-major values (`readSheetColumns`). */
export function postedKeys(columns: string[][]): Set<string> {
  const height = columns.reduce((max, c) => Math.max(max, c.length), 0);
  const keys = new Set<string>();
  for (let r = 0; r < height; r++) {
    const key = rowKey(columns.map((c) => c[r] ?? ""), columns.map((_, i) => i));
    if (key) keys.add(key);
  }
  return keys;
}

const colLetter = (idx: number): string => String.fromCharCode(65 + idx);

/** Candidate rows minus the ones the tab already carries.
 *
 *  Throws if the sheet cannot be read — appending blind is what produced the
 *  duplicates, so a failed read must fail the export (the week's claim is
 *  already taken; re-run it with the "Post to Sheet" button). */
async function dropAlreadyPosted(
  creds: SheetsCredentials,
  tabName: string,
  rows: (string | number)[][],
  keyIdx: number[],
): Promise<{ fresh: (string | number)[][]; duplicates: number }> {
  const posted = postedKeys(await readSheetColumns(creds, tabName, keyIdx.map(colLetter)));
  const fresh = rows.filter((row) => {
    const key = rowKey(row, keyIdx);
    return !key || !posted.has(key);
  });
  const duplicates = rows.length - fresh.length;
  if (duplicates) console.log(`📊 [POST-TO-SHEET] ${tabName}: skipped ${duplicates} row(s) already on the sheet`);
  return { fresh, duplicates };
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
  let duplicates = 0;
  // Columns that identify a row for the duplicate guard. Chargebacks/Omissions:
  // Date + CRM Link (the record). Wire: Date + CRM Link + Audit Link (finding).
  const CB_KEY_IDX = [0, 3];
  const WIRE_KEY_IDX = [0, 4, 5];
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
        const tabName = tab === "cb" ? "Chargebacks" : "Omissions";
        const guarded = await dropAlreadyPosted(creds, tabName, rows, CB_KEY_IDX);
        duplicates += guarded.duplicates;
        const res = await appendSheetRows(creds, tabName, guarded.fresh);
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
        const guarded = await dropAlreadyPosted(creds, "Wire Deductions", rows, WIRE_KEY_IDX);
        duplicates += guarded.duplicates;
        const res = await appendSheetRows(creds, "Wire Deductions", guarded.fresh);
        appended += res.appended;
      }
    }
  } catch (err) {
    console.error(`❌ [POST-TO-SHEET] failed:`, err);
    return { error: (err as Error).message };
  }
  console.log(`📊 [POST-TO-SHEET] appended ${appended} rows across tabs [${tabList.join(",")}]${duplicates ? `, skipped ${duplicates} already posted` : ""}`);
  return { ok: true, appended, duplicates };
}

/** Weekly cron entry + manual "trigger weekly sheets": post one job's tabs for
 *  the just-completed week. Idempotent per (org, job, week) via a claim key —
 *  appends are NOT idempotent, so a retry or a second fire must never
 *  double-post. The claim is taken before the export and never released
 *  (at-most-once per week); a failed week is re-runnable via the ad-hoc
 *  "Post to Sheet" button, which bypasses the claim.
 *
 *  The job name is IN the key. Wire (Monday) and chargebacks (Tuesday) run over
 *  the SAME Mon–Sun window, so a key of `[since]` alone would let whichever ran
 *  first claim the week and silently skip the other. */
/** How long one run may hold a week before another tick can take it over. The
 *  export is normally seconds; this only has to outlast a slow run. */
const CLAIM_LEASE_MS = 30 * 60 * 1000;

/** How long a FINISHED week stays claimed — long enough that no later tick
 *  re-posts it, short enough to clear before the same week key recurs. */
const CLAIM_DONE_MS = 8 * 24 * 60 * 60 * 1000;

interface SheetClaim {
  job: SheetJobName;
  since: number;
  until: number;
  /** `running` is a lease taken before the work; `done` means the rows landed. */
  status?: "running" | "done";
  at?: number;
}

export async function runWeeklySheetsExport(
  job: SheetJobName,
  now: Date = new Date(),
): Promise<SheetExportResult> {
  const orgId = defaultOrgId() as OrgId;
  const { tabs, label } = SHEET_JOBS[job];
  const { since, until } = prevWeekWindow(now);
  const weekLabel = new Date(since).toISOString().slice(0, 10);

  // A claim taken BEFORE the work used to be permanent, so a run that died
  // mid-export burned the week: on 2026-08-18 the chargebacks job claimed at
  // 9:00:55, was killed 29s into a 15k-doc scan, and every later tick logged
  // "already posted" over an empty sheet. Now the pre-work claim is a LEASE
  // that expires, and only success writes the permanent `done` marker.
  //
  // Duplicate rows are not what this guards — `dropAlreadyPosted` re-reads the
  // tab and drops anything already there, which is what makes a retry (and the
  // "Post to Sheet" button) safe. The claim only stops pointless duplicate work.
  const existing = await getStored<SheetClaim>("weekly-sheets-claim", orgId, job, since);
  if (existing?.status === "done") {
    console.log(`⏰ [CRON:weekly-sheets] ${label} for week of ${weekLabel} already posted — skipping`);
    return { ok: true, appended: 0, skipped: true };
  }
  if (existing) {
    console.log(`⏰ [CRON:weekly-sheets] ${label} for week of ${weekLabel} is already running elsewhere — skipping`);
    return { ok: true, appended: 0, skipped: true };
  }

  // `getStored` honours `_expiresAt`, but `setStoredIfAbsent` keys on PHYSICAL
  // existence — an expired lease doc still blocks the claim. Without this
  // delete a dead lease would wedge the week permanently, which is the very
  // failure being fixed.
  await deleteStored("weekly-sheets-claim", orgId, job, since).catch(() => {});
  const claimed = await setStoredIfAbsent(
    "weekly-sheets-claim", orgId, [job, since],
    { job, since, until, status: "running", at: Date.now() } satisfies SheetClaim,
    { expireInMs: CLAIM_LEASE_MS },
  );
  if (!claimed) {
    console.log(`⏰ [CRON:weekly-sheets] ${label} for week of ${weekLabel} claimed by another tick — skipping`);
    return { ok: true, appended: 0, skipped: true };
  }

  const result = await exportChargebacksToSheet(orgId, since, until, tabs);
  if (result.error) {
    // Release immediately so the next hourly tick retries instead of waiting
    // out the lease.
    console.error(`❌ [CRON:weekly-sheets] ${label} for week of ${weekLabel} failed: ${result.error}`);
    await deleteStored("weekly-sheets-claim", orgId, job, since).catch(() => {});
    return result;
  }
  await setStored(
    "weekly-sheets-claim", orgId, [job, since],
    { job, since, until, status: "done", at: Date.now() } satisfies SheetClaim,
    { expireInMs: CLAIM_DONE_MS },
  );
  return result;
}

/** Manual "run the weekly jobs now" — every job, each with its own claim, so
 *  this stays safe to click twice. Sequential on purpose: prod wedges under
 *  concurrent heavy report queries. */
export async function runAllWeeklySheetsExports(now: Date = new Date()): Promise<SheetExportResult> {
  let appended = 0, duplicates = 0, skipped = 0;
  const errors: string[] = [];
  for (const job of SHEET_JOB_NAMES) {
    const r = await runWeeklySheetsExport(job, now);
    appended += r.appended ?? 0;
    duplicates += r.duplicates ?? 0;
    if (r.skipped) skipped++;
    if (r.error) errors.push(`${SHEET_JOBS[job].label}: ${r.error}`);
  }
  if (errors.length) return { error: errors.join("; "), appended, duplicates };
  return { ok: true, appended, duplicates, skipped: skipped === SHEET_JOB_NAMES.length };
}
