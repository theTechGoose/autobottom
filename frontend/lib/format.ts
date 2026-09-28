/** Shared formatting utilities — timeAgo, ScorePill. */

export function timeAgo(ts: number): string {
  if (!ts) return "\u2014";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function scoreColor(score: number): "green" | "yellow" | "red" {
  if (score >= 90) return "green";
  if (score >= 70) return "yellow";
  return "red";
}

/** Everyone who reads these pages works Eastern hours, and the server runs UTC
 *  on prod — so a raw `toLocaleString()` silently renders the wrong clock. Pin
 *  the zone instead of inheriting it. */
const ET = "America/New_York";

const ET_DATE = new Intl.DateTimeFormat("en-US", { timeZone: ET, month: "numeric", day: "numeric" });
const ET_TIME = new Intl.DateTimeFormat("en-US", { timeZone: ET, hour: "numeric", minute: "2-digit" });
const ET_FULL = new Intl.DateTimeFormat("en-US", { timeZone: ET, dateStyle: "medium", timeStyle: "long" });
const ET_DAY = new Intl.DateTimeFormat("en-US", { timeZone: ET, month: "short", day: "numeric" });

/** `9/26 2:41 PM` — short enough for a table cell. Year and seconds live in
 *  `easternFull` on the hover instead. */
export function eastern(ts?: number | null): string {
  if (!ts) return "—";
  return `${ET_DATE.format(ts)} ${ET_TIME.format(ts)}`;
}

/** `Sep 26, 2026 at 2:41:07 PM EDT` — the hover text behind every `eastern()`. */
export function easternFull(ts?: number | null): string {
  if (!ts) return "";
  return ET_FULL.format(ts);
}

/** `Sep 26` — one calendar day in Eastern, for naming a filter window. */
export function easternDay(ts: number): string {
  return ET_DAY.format(ts);
}
