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
