/** Weekly sheets cron — exports chargebacks/wire to Google Sheets on schedule. */

export function prevWeekWindow(now: Date): { since: number; until: number } {
  const sunday = new Date(now);
  sunday.setDate(sunday.getDate() - 1);
  sunday.setHours(23, 59, 59, 999);
  const monday = new Date(sunday);
  monday.setDate(monday.getDate() - 6);
  monday.setHours(0, 0, 0, 0);
  return { since: monday.getTime(), until: sunday.getTime() };
}
