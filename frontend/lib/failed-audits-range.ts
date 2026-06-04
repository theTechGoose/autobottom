/** Date-range presets + ISO-week selector for the Failed Audits report.
 *
 *  Weeks are ISO-8601 (Monday start, Sunday end) computed in UTC — the audit
 *  completedAt timestamps are UTC ms, so a UTC week boundary keeps "week X"
 *  unambiguous and stable. The page pairs the preset bar with a native
 *  <select> of recent ISO weeks (value "YYYY-Www") so no client JS is needed. */

const MS_DAY = 86_400_000;
const MS_WEEK = 7 * MS_DAY;

export const FA_PRESETS: Array<{ key: string; label: string }> = [
  { key: "this-week", label: "This Week" },
  { key: "last-week", label: "Last Week" },
  { key: "this-month", label: "This Month" },
  { key: "last-month", label: "Last Month" },
  { key: "all-time", label: "All Time" },
];

export const FAILURE_SOURCES: Array<{ key: string; label: string }> = [
  { key: "", label: "All sources" },
  { key: "autobot", label: "Autobot" },
  { key: "vo_app", label: "VO app" },
  { key: "team_member", label: "Team member" },
  { key: "unknown", label: "Unknown" },
];

/** Day-of-week with Monday = 0 ... Sunday = 6. */
function isoDow(ms: number): number {
  return (new Date(ms).getUTCDay() + 6) % 7;
}

/** ISO week number + ISO year for an instant. */
export function isoWeekParts(ms: number): { year: number; week: number } {
  const d = new Date(ms);
  const thursday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((isoDow(ms) - 3) * MS_DAY);
  const isoYear = new Date(thursday).getUTCFullYear();
  const firstThursday = jan4Thursday(isoYear);
  const week = 1 + Math.round((thursday - firstThursday) / MS_WEEK);
  return { year: isoYear, week };
}

/** The Thursday of ISO week 1 for a given ISO year (the week containing Jan 4). */
function jan4Thursday(year: number): number {
  const jan4 = Date.UTC(year, 0, 4);
  return jan4 - ((isoDow(jan4) - 3) * MS_DAY);
}

/** [since, until] ms for a given ISO year + week (Monday 00:00 → Sunday 23:59:59.999). */
export function isoWeekRange(year: number, week: number): { since: number; until: number } {
  const week1Monday = jan4Thursday(year) - 3 * MS_DAY;
  const since = week1Monday + (week - 1) * MS_WEEK;
  return { since, until: since + MS_WEEK - 1 };
}

export interface Resolved { since: number; until: number; label: string }

function startOfMonth(offset: number): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1);
}

function weekLabel(year: number, week: number): string {
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function fmtDay(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
}

/** Parse a "YYYY-Www" token into a resolved range, or null if malformed. */
export function parseIsoWeek(token: string): Resolved | null {
  const m = /^(\d{4})-W(\d{1,2})$/.exec((token ?? "").trim());
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > 53) return null;
  const { since, until } = isoWeekRange(year, week);
  return { since, until, label: `${weekLabel(year, week)} (${fmtDay(since)} - ${fmtDay(until)})` };
}

/** Most recent `count` ISO weeks (current first) for the week <select>. */
export function weekOptions(now: number, count = 16): Array<{ value: string; label: string }> {
  const out: Array<{ value: string; label: string }> = [];
  let cursor = now;
  for (let i = 0; i < count; i++) {
    const { year, week } = isoWeekParts(cursor);
    const { since, until } = isoWeekRange(year, week);
    out.push({ value: weekLabel(year, week), label: `${weekLabel(year, week)} · ${fmtDay(since)} - ${fmtDay(until)}` });
    cursor -= MS_WEEK;
  }
  return out;
}

/** Current ISO week so far: Monday 00:00 → now. Shared by the "this-week"
 *  preset and the default fallback. */
function currentWeekResolved(now: number): Resolved {
  const { year, week } = isoWeekParts(now);
  const { since } = isoWeekRange(year, week);
  return { since, until: now, label: `This Week (${weekLabel(year, week)})` };
}

/** Resolve a preset to ms bounds + label. Default is the current ISO week. */
export function resolveFaRange(preset: string): Resolved {
  const now = Date.now();
  switch (preset) {
    case "this-week": return currentWeekResolved(now);
    case "last-week": {
      const { year, week } = isoWeekParts(now - MS_WEEK);
      const { since, until } = isoWeekRange(year, week);
      return { since, until, label: `Last Week (${weekLabel(year, week)})` };
    }
    case "this-month": return { since: startOfMonth(0), until: now, label: "This Month" };
    case "last-month": return { since: startOfMonth(-1), until: startOfMonth(0) - 1, label: "Last Month" };
    case "all-time": return { since: 0, until: now, label: "All Time" };
    default: return currentWeekResolved(now);
  }
}
