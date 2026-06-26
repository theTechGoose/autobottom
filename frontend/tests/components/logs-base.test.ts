import { assertEquals } from "@std/assert";
import { computeLogsBase } from "../../components/DashboardTables.tsx";

// computeLogsBase backs both the dashboard error/active tables' `logs` links AND
// the new "View Logs" button on the Find Audit card. The button opens
//   `${logsBase}${encodeURIComponent(findingId)}&start=now%2Fy&end=now`
// so this locks the base-URL shape and the localhost gating (button hidden when
// logsBase is undefined).

Deno.test("computeLogsBase — deno.net host → console.deno.com observability URL", () => {
  assertEquals(
    computeLogsBase("https://autobottom.thetechgoose.deno.net/admin/dashboard"),
    "https://console.deno.com/thetechgoose/autobottom/observability/logs?query=",
  );
});

Deno.test("computeLogsBase — localhost → undefined (button is hidden)", () => {
  assertEquals(computeLogsBase("http://localhost:3000/admin/dashboard"), undefined);
  assertEquals(computeLogsBase("http://127.0.0.1:8000/admin/dashboard"), undefined);
});

Deno.test("computeLogsBase — non-deno.net custom domain → undefined", () => {
  assertEquals(computeLogsBase("https://audits.monsterrg.com/admin/dashboard"), undefined);
});

// Locks the security intent of the [a-z0-9-] label restriction: a host label
// containing a character that could break out of the inline JS string the
// "View Logs" button builds must yield undefined (button hidden), not a base
// carrying that character. An underscore survives WHATWG hostname parsing yet is
// outside [a-z0-9-], so it reaches and is rejected by the tightened regex.
Deno.test("computeLogsBase — host label with a disallowed char → undefined", () => {
  assertEquals(computeLogsBase("https://a_b.thetechgoose.deno.net/admin/dashboard"), undefined);
});

Deno.test("View Logs URL — full link built for a finding ID matches the tables' logs link shape", () => {
  const base = computeLogsBase("https://autobottom.thetechgoose.deno.net/admin/dashboard");
  const fid = "NR_qZT4diRoERr1MnGBuA";
  const url = `${base}${encodeURIComponent(fid)}&start=now%2Fy&end=now`;
  assertEquals(
    url,
    "https://console.deno.com/thetechgoose/autobottom/observability/logs?query=NR_qZT4diRoERr1MnGBuA&start=now%2Fy&end=now",
  );
});
