/** Tests for the "Force to 100%" tool — the snapshot helper, the progress
 *  fragment, and its card in the Bulk Flip tab. Run state lives in Firestore on
 *  the backend (covered by its tests); the frontend just renders the snapshot. */

import { assert, assertEquals } from "@std/assert";
import { renderToString } from "preact-render-to-string";
import { type ForceHundredSnapshot, processedCount } from "../../../lib/force-hundred.ts";
import { ForceHundredProgress } from "../../../components/ForceHundredProgress.tsx";
import { parseDateToMs } from "../../../routes/api/admin/modal/maintenance/force-hundred-start.tsx";

function snap(over: Partial<ForceHundredSnapshot> = {}): ForceHundredSnapshot {
  return {
    jobId: "fh12ab",
    since: 1_000,
    until: 2_000,
    total: 0,
    flipped: 0,
    failed: 0,
    pendingCount: 0,
    results: [],
    startedAt: 1_700_000_000_000,
    done: false,
    ...over,
  };
}

Deno.test("parseDateToMs — inclusive end-of-day", () => {
  const start = Date.parse("2026-07-23T00:00:00Z");
  assertEquals(parseDateToMs("2026-07-23"), start);
  assertEquals(parseDateToMs("2026-07-23", true), start + 86_400_000 - 1);
  assertEquals(parseDateToMs(""), null);
});

Deno.test("processedCount — flipped + failed", () => {
  assertEquals(processedCount(snap({ flipped: 7, failed: 2 })), 9);
});

Deno.test("ForceHundredProgress — running fragment shows counters and self-triggers", () => {
  const html = renderToString(
    <ForceHundredProgress snap={snap({ total: 40, flipped: 18, pendingCount: 22 })} elapsedMs={4_000} />,
  );
  assert(html.includes("Found"));
  assert(html.includes("Flipped to 100%"));
  assert(html.includes("force-hundred-tick?jobId=fh12ab"), "must poll for the next batch");
  assert(html.includes("18 / 40 (45%)"), "progress tracks flipped+failed vs total");
});

Deno.test("ForceHundredProgress — terminal fragment stops polling and shows the result", () => {
  const html = renderToString(
    <ForceHundredProgress
      snap={snap({
        total: 2,
        flipped: 2,
        done: true,
        results: [
          { findingId: "a", ok: true, recordId: "493900", recordingId: "27624059", voName: "Jordan Price" },
          { findingId: "b", ok: true, recordId: "493711", recordingId: "27618842", voName: "Alicia Moore" },
        ],
      })}
      elapsedMs={12_000}
    />,
  );
  assert(!html.includes("hx-post"), "a finished run must not keep polling");
  assert(html.includes("Flipped 2 audits to 100%"));
  assert(html.includes("→ 100%"), "result rows show the flip outcome");
  assert(html.includes("27624059"));
});

Deno.test("ForceHundredProgress — the 'couldn't flip' counter appears only when non-zero", () => {
  assert(!renderToString(<ForceHundredProgress snap={snap({ total: 1 })} elapsedMs={0} />).includes("Couldn't flip"));
  assert(renderToString(<ForceHundredProgress snap={snap({ total: 1, failed: 1 })} elapsedMs={0} />).includes("Couldn't flip"));
});

Deno.test("Bulk Flip tab — carries the Force-to-100 card that reaches the audits regular flip can't", async () => {
  const { handler } = await import("../../../routes/api/admin/modal/maintenance.tsx");
  const get = (handler as { GET: (ctx: { req: Request }) => Response }).GET;
  const html = await get({ req: new Request("https://x/api/admin/modal/maintenance?tab=flip") }).text();

  assert(html.includes("Force Invalid-Genie audits to 100%"), "the override card is present");
  assert(html.includes("/api/admin/modal/maintenance/force-hundred-start"), "posts to the kickoff route");
  assert(html.includes('id="force-hundred-msg"'), "progress swap target present");
  assert(html.includes("hx-confirm"), "a score/pay-changing action must confirm");
});
