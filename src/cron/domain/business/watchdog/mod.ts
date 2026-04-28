/** Watchdog — detects and re-publishes stuck pipeline steps. */

import { listStoredByIdPrefix } from "@core/data/firestore/mod.ts";
import { publishStep } from "@core/data/qstash/mod.ts";
import { withSpan, metric } from "@core/data/datadog-otel/mod.ts";

const STUCK_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

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

export async function runWatchdog(): Promise<{ recovered: number }> {
  return withSpan("watchdog.run", async (span) => {
    const stuck = await getStuckFindings();
    span.setAttribute("watchdog.stuck_count", stuck.length);
    metric("autobottom.watchdog.stuck_found", stuck.length);
    let recovered = 0;
    for (const s of stuck) {
      try {
        await publishStep(s.step, { findingId: s.findingId, orgId: s.orgId });
        recovered++;
        console.log(`🔧 [WATCHDOG] Re-published ${s.findingId} stuck at ${s.step} for ${Math.round(s.ageMs / 60000)}min`);
      } catch (err) {
        console.error(`❌ [WATCHDOG] Failed to re-publish ${s.findingId}:`, err);
      }
    }
    span.setAttribute("watchdog.recovered", recovered);
    metric("autobottom.watchdog.recovered", recovered);
    return { recovered };
  }, {}, "internal");
}
