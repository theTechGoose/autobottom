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

Deno.test("View Logs URL — full link built for a finding ID matches the tables' logs link shape", () => {
  const base = computeLogsBase("https://autobottom.thetechgoose.deno.net/admin/dashboard");
  const fid = "NR_qZT4diRoERr1MnGBuA";
  const url = `${base}${encodeURIComponent(fid)}&start=now%2Fy&end=now`;
  assertEquals(
    url,
    "https://console.deno.com/thetechgoose/autobottom/observability/logs?query=NR_qZT4diRoERr1MnGBuA&start=now%2Fy&end=now",
  );
});
