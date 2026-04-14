/** Appeal tracking — tracks appeal resolution lifecycle. */
export function isAppealExpired(appealedAt: number, maxDays = 7): boolean {
  return (Date.now() - appealedAt) > maxDays * 86400000;
}
