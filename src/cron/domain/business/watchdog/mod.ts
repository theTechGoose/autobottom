/** Watchdog — detects and re-publishes stuck pipeline steps. */

import { listStoredByIdPrefix } from "@core/data/firestore/mod.ts";
import { publishStep } from "@core/data/qstash/mod.ts";
import { isFindingRecovered, untrackHandler } from "@audit/domain/data/stats-repository/mod.ts";
import { withSpan, metric } from "@core/data/datadog-otel/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

const STUCK_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

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
  const stuck: StuckFinding[] = [];

  // Scan active-tracking docs across all orgs via doc-ID prefix.
  // Doc IDs are encoded as `active-tracking__{org}__{findingId}` so the
  // prefix "active-tracking__" matches every entry regardless of org.
  // We parse the org out of the ID (sanitization keeps it round-trip-safe
  // for our org IDs which are lowercase alphanumeric).
  const rows = await listStoredByIdPrefix<{ findingId: string; step: string; ts: number }>("active-tracking__");
  for (const { id, value } of rows) {
    if (!value?.ts || !value?.findingId) continue;
    const age = now - value.ts;
    if (age > thresholdMs) {
      const idParts = id.split("__");
      const orgId = idParts[1] ?? "";
      stuck.push({ orgId, findingId: value.findingId, step: value.step, ts: value.ts, ageMs: age });
    }
  }
  return stuck;
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
          await untrackHandler(orgId, s.findingId);
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
