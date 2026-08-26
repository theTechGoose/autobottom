/** Email-reports tick — pins kill-switch semantics + claim dedup behavior.
 *  Doesn't actually fire reports (queryReportData would hit Firestore creds
 *  we don't have in CI); covers the gating logic with a config whose cron
 *  never matches so the tick exits cleanly. */

import { assert, assertEquals } from "#assert";
import { runEmailReportsTick, _resetKillSwitchCacheForTests } from "./mod.ts";
import { setStored, getStored, deleteStored } from "@core/data/firestore/mod.ts";
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

// ── Catch-up: a slot missed by a dead isolate is picked up by a later tick ────
//
// These use `recipients: []` so prepareReport returns null before it queries or
// mails anything — the tick still walks the full gating path and writes status,
// which is what we're pinning. Assertions are per-config (never on tick counts):
// the tick scans configs cross-org, so other tests' rows are always in the mix.

interface Status { lastRunAt: number; lastRunStatus: string; lastSlotKey?: string; lastTickKey?: string }

/** ms-epoch for today at HH:MM UTC. Configs below pin tz:"UTC" so slot math is
 *  plain arithmetic rather than an Intl round-trip. */
function utcToday(h: number, m: number): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m, 0, 0);
}

function keyOf(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => n.toString().padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

async function seedConfig(orgId: OrgId, configId: string, cron: string) {
  await setStored("email-report-config", orgId, [configId], {
    id: configId,
    name: "Catch-up probe",
    recipients: [],
    reportSections: [],
    enabled: true,
    schedule: { cron, tz: "UTC" },
  });
}

const freshOrg = () => (`test-catchup-${crypto.randomUUID().slice(0, 8)}`) as unknown as OrgId;

Deno.test({
  name: "catch-up — slot missed at 09:00 is run by the 09:30 tick, stamped with the SLOT",
  ...kvOpts,
  fn: async () => {
    resetFirestoreCredentials();
    _resetKillSwitchCacheForTests();
    const orgId = freshOrg();
    const configId = `cfg-${crypto.randomUUID().slice(0, 6)}`;
    await seedConfig(orgId, configId, "0 9 * * *");

    await runEmailReportsTick(utcToday(9, 30));

    const st = await getStored<Status>("email-report-status", orgId, configId);
    assert(st, "missed slot should have been caught up");
    assertEquals(st!.lastRunStatus, "ok");
    // Stamped with the 09:00 slot it was FOR, not the 09:30 tick it ran ON.
    assertEquals(st!.lastSlotKey, keyOf(utcToday(9, 0)));
    assertEquals(st!.lastTickKey, keyOf(utcToday(9, 30)));
  },
});

Deno.test({
  name: "catch-up — a slot already attempted is not run again",
  ...kvOpts,
  fn: async () => {
    resetFirestoreCredentials();
    _resetKillSwitchCacheForTests();
    const orgId = freshOrg();
    const configId = `cfg-${crypto.randomUUID().slice(0, 6)}`;
    await seedConfig(orgId, configId, "0 9 * * *");
    // Attempt already recorded one minute into the slot.
    const alreadyAt = utcToday(9, 1);
    await setStored("email-report-status", orgId, [configId], {
      configId, lastRunAt: alreadyAt, lastRunStatus: "ok", lastRunDurationMs: 5,
    });

    await runEmailReportsTick(utcToday(9, 30));

    const st = await getStored<Status>("email-report-status", orgId, configId);
    assertEquals(st!.lastRunAt, alreadyAt, "must not re-send a slot already attempted");
  },
});

Deno.test({
  name: "catch-up — an attempt that ERRORED is not retried (still one attempt per slot)",
  ...kvOpts,
  fn: async () => {
    resetFirestoreCredentials();
    _resetKillSwitchCacheForTests();
    const orgId = freshOrg();
    const configId = `cfg-${crypto.randomUUID().slice(0, 6)}`;
    await seedConfig(orgId, configId, "0 9 * * *");
    const erroredAt = utcToday(9, 1);
    await setStored("email-report-status", orgId, [configId], {
      configId, lastRunAt: erroredAt, lastRunStatus: "error: boom", lastRunDurationMs: 0,
    });

    await runEmailReportsTick(utcToday(9, 30));

    const st = await getStored<Status>("email-report-status", orgId, configId);
    assertEquals(st!.lastRunAt, erroredAt, "a caught failure stays one attempt, as before");
    assertEquals(st!.lastRunStatus, "error: boom");
  },
});

Deno.test({
  name: "catch-up — a slot older than the lookback window is left alone",
  ...kvOpts,
  fn: async () => {
    resetFirestoreCredentials();
    _resetKillSwitchCacheForTests();
    const orgId = freshOrg();
    const configId = `cfg-${crypto.randomUUID().slice(0, 6)}`;
    await seedConfig(orgId, configId, "0 9 * * *");

    // 13:00 is 4h past the 09:00 slot — beyond CATCHUP_LOOKBACK_MINUTES (180).
    await runEmailReportsTick(utcToday(13, 0));

    const st = await getStored<Status>("email-report-status", orgId, configId);
    assertEquals(st, null, "a stale slot must not fire hours late");
  },
});
