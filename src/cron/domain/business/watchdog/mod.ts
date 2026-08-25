/** Watchdog — detects and re-publishes stuck pipeline steps. */

import { listStoredByIdPrefix } from "@core/data/firestore/mod.ts";
import { publishStep } from "@core/data/qstash/mod.ts";
import { isFindingRecovered, untrackForWatchdog, ACTIVE_REAP_MS } from "@audit/domain/data/stats-repository/mod.ts";
import { withSpan, metric } from "@core/data/datadog-otel/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

/** A finding whose tracking row hasn't been touched in this long is presumed
 *  dead and gets its step re-published.
 *
 *  Clamped to half of ACTIVE_REAP_MS so the invariant is structural rather than
 *  a comment someone can drift away from: the dashboard's stats read deletes
 *  rows past ACTIVE_REAP_MS, and a row deleted before the watchdog ever sees it
 *  means the finding is permanently unrecoverable. Half guarantees at least one
 *  hourly tick lands inside the window. */
export const STUCK_THRESHOLD_MS = Math.min(30 * 60 * 1000, Math.floor(ACTIVE_REAP_MS / 2));

/** active-tracking.step doubles as a dashboard display label, and a few labels
 *  are NOT dispatchable pipeline steps. Re-publishing them verbatim hits an
 *  unknown /audit/step/<label> route (404) and the finding never recovers.
 *  Both of these mean "the audit still needs init to (re)run", so map them to
 *  the real `init` step (which is idempotent and converges to finalize).
 *   • "queued"      — written by the audit controller at creation
 *   • "genie-retry" — written by step-init between genie download retries */
const STEP_ALIASES: Record<string, string> = { queued: "init", "genie-retry": "init" };

/** Resolve a tracked active-tracking label to a dispatchable pipeline step,
 *  mapping the non-step display labels (see STEP_ALIASES) to real steps.
 *  Exported for unit testing. */
export function resolveStep(label: string): string {
  return STEP_ALIASES[label] ?? label;
}

interface StuckFinding {
  orgId: string;
  findingId: string;
  step: string;
  ts: number;
  ageMs: number;
}

export async function getStuckFindings(thresholdMs = STUCK_THRESHOLD_MS): Promise<StuckFinding[]> {
  const now = Date.now();
  // Keyed `${orgId}::${findingId}` — the same finding appears in both stores,
  // and re-publishing it twice in one tick would double-run the step.
  const stuck = new Map<string, StuckFinding>();

  const consider = (orgId: string, value: { findingId?: string; step?: string; ts?: number } | null) => {
    if (!value?.ts || !value?.findingId) return;
    const age = now - value.ts;
    if (age <= thresholdMs) return;
    const key = `${orgId}::${value.findingId}`;
    const prev = stuck.get(key);
    // Keep the OLDEST sighting — the two stores are written together, but if
    // they ever drift, the older ts is the conservative "stuck since" answer.
    if (prev && prev.ts <= value.ts) return;
    stuck.set(key, { orgId, findingId: value.findingId, step: value.step ?? "", ts: value.ts, ageMs: age });
  };

  // Source 1 — `active-tracking`, the durable per-org row written by the step
  // dispatcher's pre-track. Doc IDs are `active-tracking__{org}__{findingId}`,
  // so the prefix matches every entry regardless of org and we parse the org
  // back out (sanitization is round-trip-safe for our lowercase-alnum orgs).
  const activeRows = await listStoredByIdPrefix<{ findingId: string; step: string; ts: number }>("active-tracking__");
  for (const { id, value } of activeRows) {
    consider(id.split("__")[1] ?? "", value);
  }

  // Source 2 — `watchdog-active`, the GLOBAL-org backup written alongside it by
  // trackActive. It carries orgId in the VALUE (no id parsing needed) and has a
  // TTL, so it survives an early delete of the primary row. This store was
  // written for years but never read by the watchdog — findings whose primary
  // row was reaped were simply lost. Union, don't replace: the primary has no
  // TTL and so outlives this one on a long hang.
  const backupRows = await listStoredByIdPrefix<{ orgId: string; findingId: string; step: string; ts: number }>("watchdog-active__");
  for (const { value } of backupRows) {
    consider(String(value?.orgId ?? ""), value);
  }

  return [...stuck.values()];
}

export async function runWatchdog(): Promise<{ recovered: number; skippedTerminal: number }> {
  return withSpan("watchdog.run", async (span) => {
    const stuck = await getStuckFindings();
    span.setAttribute("watchdog.stuck_count", stuck.length);
    metric("autobottom.watchdog.stuck_found", stuck.length);
    let recovered = 0;
    let skippedTerminal = 0;
    for (const s of stuck) {
      const orgId = s.orgId as OrgId;
      try {
        // Never re-dispatch a finding that already reached a terminal state.
        // Its active-tracking row is stale — left behind by a mid-step abort, or
        // re-created by a parallel/late step (e.g. diarize-async) after
        // step-finalize cleared it. Re-running an early step here would flip a
        // "finished" audit back to "asking-questions" (step-prepare), wipe the
        // reviewer's in-progress decisions, and trip the reviewer-finalize
        // refusal guard (review-queue HARD PRE-FLIGHT). Clear the stale row so it
        // stops resurfacing every hour, and skip it.
        if (await isFindingRecovered(orgId, s.findingId)) {
          await untrackForWatchdog(orgId, s.findingId);
          skippedTerminal++;
          console.log(`🧹 [WATCHDOG] Cleared stale active-tracking for ${s.findingId} (already terminal; was "${s.step}" for ${Math.round(s.ageMs / 60000)}min)`);
          continue;
        }
        const step = resolveStep(s.step);
        await publishStep(step, { findingId: s.findingId, orgId: s.orgId });
        recovered++;
        console.log(`🔧 [WATCHDOG] Re-published ${s.findingId} stuck at ${s.step}${step !== s.step ? ` (→ ${step})` : ""} for ${Math.round(s.ageMs / 60000)}min`);
      } catch (err) {
        console.error(`❌ [WATCHDOG] Failed to re-publish ${s.findingId}:`, err);
      }
    }
    span.setAttribute("watchdog.recovered", recovered);
    span.setAttribute("watchdog.skipped_terminal", skippedTerminal);
    metric("autobottom.watchdog.recovered", recovered);
    metric("autobottom.watchdog.skipped_terminal", skippedTerminal);
    return { recovered, skippedTerminal };
  }, {}, "internal");
}
