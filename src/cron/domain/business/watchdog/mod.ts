/** Watchdog — detects and re-publishes stuck pipeline steps.
 *  Ported from the hourly cron in main.ts. */

import { getKv } from "@core/data/deno-kv/mod.ts";
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
  const db = await getKv();
  const now = Date.now();
  const stuck: StuckFinding[] = [];

  for await (const entry of db.list<{ findingId: string; step: string; ts: number }>({ prefix: ["__active-tracking__"] })) {
    const v = entry.value;
    if (!v?.ts || !v?.findingId) continue;
    const age = now - v.ts;
    if (age > thresholdMs) {
      const orgId = String(entry.key[1] ?? "");
      stuck.push({ orgId, findingId: v.findingId, step: v.step, ts: v.ts, ageMs: age });
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
