/** Email Reports cron tick — runs every minute.
 *
 *  Walks every org's `email-report-config` docs, evaluates each enabled
 *  schedule's cron expression against the current wall-clock instant in
 *  the config's tz, and fires `prepareReport` + `sendPreparedReport` for
 *  each match. Multi-isolate safe via `setStoredIfAbsent` claim keys.
 *
 *  CATCH-UP: a tick does NOT ask "is it exactly 9:00 right now?". It asks
 *  "when was this config's most recent due slot, and has that slot been
 *  attempted yet?" — so a slot missed because the isolate died mid-batch is
 *  picked up by a later tick instead of being lost for the day. The isolate
 *  IS killed outright on a memory-limit breach (no catchable error, no status
 *  writeback), and on 2026-08-24/25 that silently dropped 8-11 of the 9am
 *  reports; `0 9 * * *` matched minute-exactly, so 9:01 was already too late.
 *
 *  Safety rails in order of importance:
 *    1. Kill-switch — `system-flag:email-reports-enabled` (60s isolate
 *       cache). Flip via Dev Tools without redeploying.
 *    2. Background lane — every Firestore call is inside `runInBackgroundLane`,
 *       so the per-minute scan + per-report queries use the 25-slot
 *       background pool and never compete with user-facing requests.
 *    3. Atomic claim, keyed on the SLOT (not the tick minute) —
 *       `setStoredIfAbsent("email-report-claim", orgId, [configId, slotKey])`.
 *       Keying on the minute was safe only because a config could match
 *       exactly one minute per day; under catch-up a run still in
 *       `prepareReport` at 9:01 would let a second isolate claim a fresh
 *       minute and send the same report twice. The TTL therefore has to
 *       outlast a full attempt (90s prepare + send) while still freeing the
 *       slot after a crash — hence 3 minutes.
 *    4. Attempt marker — the status doc is stamped `sending` BEFORE
 *       `sendEmail`, so a crash between "mail accepted by Postmark" and
 *       "status written" does not read as un-attempted and re-send. A missed
 *       report is recoverable by hand; a duplicate blast to 18 recipients
 *       is not.
 *    5. Bounded concurrency — configs processed sequentially (concurrency=1).
 *       Tunable upward later if needed; conservative start.
 *    6. Split timeout — 90s race wraps QUERY+RENDER only, never sendEmail.
 *       Once `sendEmail` is invoked we let it run to completion to avoid
 *       the mid-send double-send race (timeout + retry-on-next-tick).
 *    7. Per-config error isolation — one bad config never blocks the rest. */

import type { OrgId } from "@core/data/deno-kv/mod.ts";
import type { EmailReportConfig, EmailReportStatus } from "@core/dto/types.ts";
import { listStoredByIdPrefix, getStored, setStored, setStoredIfAbsent, runInBackgroundLane } from "@core/data/firestore/mod.ts";
import { lastFireAtOrBefore, DEFAULT_TZ } from "@reporting/domain/business/cron-presets/mod.ts";
import { prepareReport, sendPreparedReport } from "@reporting/domain/business/email-report-engine/mod.ts";

const KILL_SWITCH_TYPE = "system-flag";
const KILL_SWITCH_ORG = "" as OrgId;
const KILL_SWITCH_KEY = "email-reports-enabled";
const KILL_SWITCH_CACHE_MS = 60_000;
const MAX_CONFIGS_PER_TICK = 200;
/** Must outlast one full attempt (PREPARE_TIMEOUT_MS + send) so a slow run
 *  keeps its slot, yet expire soon enough that a crashed run is retried
 *  promptly. See rail 3. */
const CLAIM_TTL_MS = 180_000;
const PREPARE_TIMEOUT_MS = 90_000;
/** How far back a tick will look for an unattempted due slot. Past this, a
 *  missed report is stale enough that sending it does more harm than good —
 *  nobody wants the 9am report landing at 1pm. */
const CATCHUP_LOOKBACK_MINUTES = 180;

interface KillSwitchValue { enabled?: boolean }

interface ConfigEntry { orgId: string; config: EmailReportConfig }

let _killSwitchCache: { enabled: boolean; expiresAt: number } | null = null;

/** Cached kill-switch read. Missing flag → enabled (safe default). */
async function isEnabled(): Promise<boolean> {
  const now = Date.now();
  if (_killSwitchCache && _killSwitchCache.expiresAt > now) return _killSwitchCache.enabled;
  let enabled = true;
  try {
    const flag = await getStored<KillSwitchValue>(KILL_SWITCH_TYPE, KILL_SWITCH_ORG, KILL_SWITCH_KEY);
    if (flag && flag.enabled === false) enabled = false;
  } catch (err) {
    console.warn("[CRON:email-reports] kill-switch read failed, defaulting to enabled:", err);
  }
  _killSwitchCache = { enabled, expiresAt: now + KILL_SWITCH_CACHE_MS };
  return enabled;
}

/** Test-only: clear the in-isolate kill-switch cache. */
export function _resetKillSwitchCacheForTests(): void {
  _killSwitchCache = null;
}

function tickKey(nowMs: number): string {
  const d = new Date(nowMs);
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}`;
}

function pad2(n: number): string { return n.toString().padStart(2, "0"); }

/** Cross-org scan of email-report-config docs. Returns at most
 *  MAX_CONFIGS_PER_TICK entries; logs a warning if the cap was hit so we
 *  can investigate runaway config counts. */
async function listAllConfigs(): Promise<ConfigEntry[]> {
  const rows = await listStoredByIdPrefix<EmailReportConfig>("email-report-config__", { limit: MAX_CONFIGS_PER_TICK + 1 });
  if (rows.length > MAX_CONFIGS_PER_TICK) {
    console.warn(`[CRON:email-reports] config cap hit (${rows.length} > ${MAX_CONFIGS_PER_TICK}) — extras skipped`);
  }
  const out: ConfigEntry[] = [];
  for (const { id, value } of rows.slice(0, MAX_CONFIGS_PER_TICK)) {
    if (!value) continue;
    const orgId = id.split("__")[1] ?? "";
    if (!orgId) continue;
    out.push({ orgId, config: value });
  }
  return out;
}

interface RunResult { ran: number; skipped: number; failed: number }

export async function runEmailReportsTick(nowMs: number = Date.now()): Promise<RunResult> {
  const t0 = nowMs;
  if (!(await isEnabled())) {
    console.log("⏰ [CRON:email-reports] kill-switch=disabled, skipping tick");
    return { ran: 0, skipped: 0, failed: 0 };
  }

  return await runInBackgroundLane(async () => {
    let configs: ConfigEntry[];
    try {
      configs = await listAllConfigs();
    } catch (err) {
      console.error("[CRON:email-reports] config scan failed:", err);
      return { ran: 0, skipped: 0, failed: 0 };
    }
    const enabledConfigs = configs.filter(({ config }) => config.enabled && config.schedule?.cron);
    console.log(`⏰ [CRON:email-reports] tick start configs=${configs.length} enabled=${enabledConfigs.length}`);

    const minuteKey = tickKey(nowMs);
    let ran = 0;
    let skipped = 0;
    let failed = 0;

    for (const { orgId, config } of enabledConfigs) {
      const cron = config.schedule!.cron;
      const tz = config.schedule!.tz || DEFAULT_TZ;
      let slotKey = minuteKey;
      try {
        // The most recent due slot at or before now — not "is it exactly the
        // scheduled minute". null → this config isn't due in the window.
        const slotMs = lastFireAtOrBefore(cron, tz, nowMs, CATCHUP_LOOKBACK_MINUTES);
        if (slotMs === null) { skipped++; continue; }
        slotKey = tickKey(slotMs);

        // Has this slot already been attempted? `lastRunAt` is the marker:
        // a completed run (ok OR caught error) stamps it, so we don't retry
        // a config that genuinely failed — that stays one attempt per slot,
        // as before. An isolate killed mid-work writes nothing at all, which
        // is exactly the case we DO want to pick up here.
        //
        // This read comes BEFORE the claim on purpose. A slot stays "due" for
        // the whole catch-up window, so the common path through here is an
        // already-sent config on each of the next ~180 ticks; gating on a read
        // keeps that path read-only instead of burning a claim write every
        // time the 3-minute claim TTL lapses. It doesn't weaken the claim —
        // that still serialises the two isolates that get past this point.
        const status = await getStored<EmailReportStatus>("email-report-status", orgId as OrgId, config.id);
        if (status && status.lastRunAt >= slotMs) {
          skipped++;
          continue;
        }

        // Atomic claim, keyed on the slot — blocks a second isolate from
        // starting the same slot while the first is still working it.
        const claimed = await setStoredIfAbsent(
          "email-report-claim",
          orgId,
          [config.id, slotKey],
          { claimedAt: nowMs },
          { expireInMs: CLAIM_TTL_MS },
        );
        if (!claimed) {
          console.log(`🔄 [EMAIL-REPORT] claim lost configId=${config.id} slot=${slotKey}`);
          skipped++;
          continue;
        }

        const lateBy = Math.round((nowMs - slotMs) / 60_000);
        console.log(
          `📧 [EMAIL-REPORT] running config=${config.id} for ${orgId} slot=${slotKey}` +
            (lateBy > 0 ? ` (catch-up, ${lateBy}m late)` : ""),
        );
        const startMs = Date.now();
        // Wrap QUERY+RENDER in a timeout; sendEmail runs free.
        const prepared = await Promise.race([
          prepareReport(orgId as OrgId, config),
          new Promise<null>((_, reject) =>
            setTimeout(() => reject(new Error(`prepareReport timeout after ${PREPARE_TIMEOUT_MS}ms`)), PREPARE_TIMEOUT_MS),
          ),
        ]);
        if (!prepared) {
          // No recipients — successful no-op.
          await setStored("email-report-status", orgId as OrgId, [config.id], {
            configId: config.id,
            lastRunAt: Date.now(),
            lastRunStatus: "ok",
            lastRunDurationMs: Date.now() - startMs,
            lastTickKey: minuteKey,
            lastSlotKey: slotKey,
          } satisfies EmailReportStatus);
          ran++;
          continue;
        }
        // Mark the slot attempted BEFORE handing off to Postmark (rail 4).
        // If the isolate dies mid-send, this is what stops a later tick from
        // reading the slot as un-attempted and mailing everyone twice.
        await setStored("email-report-status", orgId as OrgId, [config.id], {
          configId: config.id,
          lastRunAt: Date.now(),
          lastRunStatus: "sending",
          lastRunDurationMs: Date.now() - startMs,
          lastTickKey: minuteKey,
          lastSlotKey: slotKey,
        } satisfies EmailReportStatus);
        const sendResult = await sendPreparedReport(prepared);
        await setStored("email-report-status", orgId as OrgId, [config.id], {
          configId: config.id,
          lastRunAt: Date.now(),
          lastRunStatus: "ok",
          lastRunDurationMs: Date.now() - startMs,
          lastSentMessageId: sendResult.messageId,
          lastTickKey: minuteKey,
          lastSlotKey: slotKey,
        } satisfies EmailReportStatus);
        ran++;
      } catch (err) {
        failed++;
        const msg = String((err as Error)?.message ?? err).slice(0, 300);
        console.error(`❌ [EMAIL-REPORT] config=${config.id} org=${orgId} failed:`, err);
        try {
          await setStored("email-report-status", orgId as OrgId, [config.id], {
            configId: config.id,
            lastRunAt: Date.now(),
            lastRunStatus: `error: ${msg}`,
            lastRunDurationMs: 0,
            lastTickKey: minuteKey,
            lastSlotKey: slotKey,
          } satisfies EmailReportStatus);
        } catch (statusErr) {
          console.warn(`[EMAIL-REPORT] status writeback failed for ${config.id}:`, statusErr);
        }
      }
    }

    console.log(`⏰ [CRON:email-reports] tick done ran=${ran} skipped=${skipped} failed=${failed} durationMs=${Date.now() - t0}`);
    return { ran, skipped, failed };
  });
}
