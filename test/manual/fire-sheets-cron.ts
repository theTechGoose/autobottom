/** Manual integration test — fires the weekly sheets cron for the current week.
 *
 *  Usage: deno task test:sheets
 *
 *  This hits the live /admin/post-to-sheet endpoint with the previous week's window.
 *  NOT run by `deno task test` (lives in test/manual/, not test/).
 */

const BASE_URL = Deno.env.get("SELF_URL") || "https://autobottom.thetechgoose.deno.net";
const COOKIE = Deno.env.get("AUTH_COOKIE") || "";

if (!COOKIE) {
  console.error("❌ Set AUTH_COOKIE env var (copy your ab_session cookie value)");
  console.error("   Example: AUTH_COOKIE='ab_session=abc123' deno task test:sheets");
  Deno.exit(1);
}

// Calculate previous week window (Mon 00:00 EST → Sun 23:59 EST)
function prevWeekWindow(): { since: number; until: number } {
  const now = new Date();
  // Convert to EST
  const estOffset = -5 * 60; // EST = UTC-5
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const estNow = new Date(utcMs + estOffset * 60000);

  const day = estNow.getDay(); // 0=Sun
  const diffToMonday = (day === 0 ? 6 : day - 1);

  // This Monday at midnight EST
  const thisMonday = new Date(estNow);
  thisMonday.setDate(estNow.getDate() - diffToMonday);
  thisMonday.setHours(0, 0, 0, 0);

  // Previous Monday at midnight EST
  const prevMonday = new Date(thisMonday);
  prevMonday.setDate(thisMonday.getDate() - 7);

  // Previous Sunday at 23:59:59 EST
  const prevSunday = new Date(thisMonday);
  prevSunday.setDate(thisMonday.getDate() - 1);
  prevSunday.setHours(23, 59, 59, 999);

  // Convert back to UTC timestamps
  const sinceUtc = prevMonday.getTime() - estOffset * 60000 - now.getTimezoneOffset() * 60000;
  const untilUtc = prevSunday.getTime() - estOffset * 60000 - now.getTimezoneOffset() * 60000;

  return { since: sinceUtc, until: untilUtc };
}

const { since, until } = prevWeekWindow();
console.log(`📅 Window: ${new Date(since).toISOString()} → ${new Date(until).toISOString()}`);

const tabs = Deno.args[0] || "wire,chargebacks,omissions";
console.log(`📊 Tabs: ${tabs}`);
console.log(`🌐 Target: ${BASE_URL}`);
console.log("");

const res = await fetch(`${BASE_URL}/admin/post-to-sheet`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Cookie": COOKIE,
  },
  body: JSON.stringify({ since, until, tabs }),
});

const text = await res.text();
console.log(`Status: ${res.status}`);
try {
  console.log(JSON.stringify(JSON.parse(text), null, 2));
} catch {
  console.log(text);
}

if (res.ok) {
  console.log("\n✅ Sheets cron fired successfully");
} else {
  console.log("\n❌ Failed — check server logs");
  Deno.exit(1);
}
