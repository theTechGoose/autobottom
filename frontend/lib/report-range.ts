/** Date-range presets + resolution for the Email Engagement report.
 *
 *  Shared by the modal fragment (routes/api/admin/modal/reports/engagement.tsx)
 *  and the full-page drill-down (routes/admin/email-engagement.tsx) so "Today"
 *  and the preset list are defined exactly once.
 *
 *  "Today" uses US-Eastern day boundaries (not UTC): a UTC "today" looks empty
 *  after ~8pm ET because it has already rolled into the next UTC calendar day.
 *  ET is the codebase's daily-window precedent — mirrors etDayWindow /
 *  etMidnightUtcMs in src/admin/entrypoints/canary-errors/mod.ts. */

const TZ = "America/New_York";

export const ENG_PRESETS: Array<{ key: string; label: string }> = [
  { key: "today", label: "Today" },
  { key: "this-month", label: "This Month" },
  { key: "last-month", label: "Last Month" },
  { key: "last-3", label: "Last 3 Months" },
  { key: "last-6", label: "Last 6 Months" },
  { key: "all-time", label: "All Time" },
];

/** Presets for the Reviewer Throughput report (default Today). */
export const RT_PRESETS: Array<{ key: string; label: string }> = [
  { key: "today", label: "Today" },
  { key: "this-week", label: "This Week" },
  { key: "7d", label: "Last 7 Days" },
  { key: "30d", label: "Last 30 Days" },
  { key: "all-time", label: "All Time" },
];

/** Offset (ms) of `tz` from UTC at `instant`: (tz wall-clock read as UTC) − instant.
 *  Negative for the Americas (−4h EDT, −5h EST). */
function tzOffsetMs(instant: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = dtf.formatToParts(new Date(instant));
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - instant;
}

/** UTC ms of ET midnight (00:00) for the given ET calendar date. Midnight avoids
 *  the 1–3 AM DST-transition ambiguity. */
function etMidnightUtcMs(y: number, mo: number, d: number): number {
  const naive = Date.UTC(y, mo - 1, d, 0, 0, 0);
  return naive - tzOffsetMs(naive, TZ);
}

/** ET calendar date (Y/M/D) of an instant. */
function etYmd(instant: number): { y: number; mo: number; d: number } {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(instant)).split("-").map(Number);
  return { y: p[0], mo: p[1], d: p[2] };
}

/** [since, until] window for the current ET day: ET midnight → now. */
export function etTodayWindow(now: number): { since: number; until: number } {
  const { y, mo, d } = etYmd(now);
  return { since: etMidnightUtcMs(y, mo, d), until: now };
}

/** Start of the current ET week (Sunday 00:00 ET), as UTC ms. */
function etWeekStart(now: number): number {
  const { y, mo, d } = etYmd(now);
  const todayStart = etMidnightUtcMs(y, mo, d);
  const dow = new Date(todayStart).getUTCDay(); // 0 = Sunday (ET midnight ≈ 4–5am UTC same date)
  const sunday = etYmd(todayStart - dow * 86_400_000);
  return etMidnightUtcMs(sunday.y, sunday.mo, sunday.d);
}

function startOfMonth(offset: number): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1);
}

function dateToMs(dateStr: string, endOfDay: boolean): number | null {
  if (!dateStr) return null;
  const ts = Date.parse(dateStr + "T00:00:00Z");
  if (!Number.isFinite(ts)) return null;
  return endOfDay ? ts + 86_400_000 - 1 : ts;
}

export interface Resolved { since: number; until: number; label: string }

/** Resolve a preset (or a custom from/to) to ms bounds + a human label.
 *  Default — including an unknown preset — is "Today" (ET). */
export function resolveRange(preset: string, customFrom: string, customTo: string): Resolved {
  const now = Date.now();
  switch (preset) {
    case "today": {
      const { since, until } = etTodayWindow(now);
      return { since, until, label: "Today" };
    }
    case "this-week": return { since: etWeekStart(now), until: now, label: "This Week" };
    case "7d": return { since: now - 7 * 86_400_000, until: now, label: "Last 7 Days" };
    case "30d": return { since: now - 30 * 86_400_000, until: now, label: "Last 30 Days" };
    case "this-month": return { since: startOfMonth(0), until: now, label: "This Month" };
    case "last-month": return { since: startOfMonth(-1), until: startOfMonth(0) - 1, label: "Last Month" };
    case "last-3": return { since: startOfMonth(-2), until: now, label: "Last 3 Months" };
    case "last-6": return { since: startOfMonth(-5), until: now, label: "Last 6 Months" };
    case "all-time": return { since: 0, until: now, label: "All Time" };
    case "custom": {
      const since = dateToMs(customFrom, false);
      const until = dateToMs(customTo, true);
      if (since != null && until != null) return { since, until, label: `${customFrom} → ${customTo}` };
      if (since != null) return { since, until: now, label: `${customFrom} → now` };
      if (until != null) return { since: 0, until, label: `epoch → ${customTo}` };
      const t = etTodayWindow(now);
      return { since: t.since, until: t.until, label: "Today (no custom range)" };
    }
    default: {
      const { since, until } = etTodayWindow(now);
      return { since, until, label: "Today" };
    }
  }
}
