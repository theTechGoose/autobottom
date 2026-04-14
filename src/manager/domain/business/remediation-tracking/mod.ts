/** Remediation tracking — tracks failure resolution metrics. */
export function isOverdue(remediatedAt: number | undefined, slaHours = 24): boolean {
  if (!remediatedAt) return true;
  return (Date.now() - remediatedAt) > slaHours * 3600000;
}
