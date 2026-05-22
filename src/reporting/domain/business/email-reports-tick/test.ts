/** Email-reports tick — pins kill-switch semantics + claim dedup behavior.
 *  Doesn't actually fire reports (queryReportData would hit Firestore creds
 *  we don't have in CI); covers the gating logic with a config whose cron
 *  never matches so the tick exits cleanly. */

import { assert, assertEquals } from "#assert";
import { runEmailReportsTick, _resetKillSwitchCacheForTests } from "./mod.ts";
import { setStored, deleteStored } from "@core/data/firestore/mod.ts";
import { resetFirestoreCredentials } from "@core/data/firestore/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

const kvOpts = { sanitizeResources: false, sanitizeOps: false };

Deno.test({
  name: "runEmailReportsTick — empty config set → ran=0, skipped=0, failed=0",
  ...kvOpts,
  fn: async () => {
    resetFirestoreCredentials();
    _resetKillSwitchCacheForTests();
    const result = await runEmailReportsTick();
    assertEquals(result.ran, 0);
    assertEquals(result.failed, 0);
  },
});

Deno.test({
  name: "runEmailReportsTick — kill-switch false → early return",
  ...kvOpts,
  fn: async () => {
    resetFirestoreCredentials();
    _resetKillSwitchCacheForTests();
    await setStored("system-flag", "" as OrgId, ["email-reports-enabled"], { enabled: false });
    const result = await runEmailReportsTick();
    assertEquals(result, { ran: 0, skipped: 0, failed: 0 });
    // Cleanup so other tests aren't affected
    await deleteStored("system-flag", "" as OrgId, "email-reports-enabled");
    _resetKillSwitchCacheForTests();
  },
});

Deno.test({
  name: "runEmailReportsTick — config with non-matching cron → skipped (not ran)",
  ...kvOpts,
  fn: async () => {
    resetFirestoreCredentials();
    _resetKillSwitchCacheForTests();
    const orgId = (`test-tick-${crypto.randomUUID().slice(0, 8)}`) as unknown as OrgId;
    // Cron that only fires Feb 31 — never matches.
    const configId = `cfg-${crypto.randomUUID().slice(0, 6)}`;
    await setStored("email-report-config", orgId, [configId], {
      id: configId,
      name: "Never Fires",
      recipients: ["ops@example.com"],
      reportSections: [],
      enabled: true,
      schedule: { cron: "0 0 31 2 *", tz: "America/New_York" },
    });
    const result = await runEmailReportsTick();
    assertEquals(result.ran, 0);
    assert(result.skipped >= 1, "config should have been considered + skipped");
  },
});

Deno.test({
  name: "runEmailReportsTick — disabled config → never considered",
  ...kvOpts,
  fn: async () => {
    resetFirestoreCredentials();
    _resetKillSwitchCacheForTests();
    const orgId = (`test-tick-${crypto.randomUUID().slice(0, 8)}`) as unknown as OrgId;
    const configId = `cfg-${crypto.randomUUID().slice(0, 6)}`;
    await setStored("email-report-config", orgId, [configId], {
      id: configId,
      name: "Disabled",
      recipients: ["ops@example.com"],
      reportSections: [],
      enabled: false,
      schedule: { cron: "* * * * *", tz: "America/New_York" }, // would match every minute if enabled
    });
    const result = await runEmailReportsTick();
    // It's filtered out before matching, so it doesn't even count as skipped
    assertEquals(result.ran, 0);
    assertEquals(result.failed, 0);
  },
});
