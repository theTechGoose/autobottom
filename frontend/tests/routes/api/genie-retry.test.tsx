/** Tests for the Data Maintenance "Genie Retry" bulk re-run — the snapshot
 *  helper, the progress fragment, and the modal tab.
 *
 *  The run state itself lives in Firestore on the backend (its tests cover the
 *  concurrency gate); the frontend is a thin renderer, so these pin that it
 *  renders the backend snapshot correctly and stops polling when done. */

import { assert, assertEquals } from "@std/assert";
import { renderToString } from "preact-render-to-string";
import {
  type GenieRetrySnapshot,
  processedCount,
} from "../../../lib/genie-retry-job-store.ts";
import { GenieRetryProgress } from "../../../components/GenieRetryProgress.tsx";
import { parseDateToMs } from "../../../routes/api/admin/modal/maintenance/genie-retry-start.tsx";

function snap(over: Partial<GenieRetrySnapshot> = {}): GenieRetrySnapshot {
  return {
    jobId: "abc123",
    since: 1_000,
    until: 2_000,
    total: 0,
    queued: 0,
    valid: 0,
    invalid: 0,
    missing: 0,
    stalled: 0,
    failed: 0,
    pendingCount: 0,
    inFlightCount: 0,
    results: [],
    startedAt: 1_700_000_000_000,
    done: false,
    ...over,
  };
}

// ── date window ─────────────────────────────────────────────────────────────

Deno.test("parseDateToMs — To (endOfDay) is inclusive to the last ms of the picked day", () => {
  const start = Date.parse("2026-07-20T00:00:00Z");
  assertEquals(parseDateToMs("2026-07-20"), start);
  assertEquals(parseDateToMs("2026-07-20", true), start + 86_400_000 - 1);
  assertEquals(parseDateToMs(""), null);
  assertEquals(parseDateToMs("not-a-date"), null);
});

// ── processedCount ──────────────────────────────────────────────────────────

Deno.test("processedCount — sums every terminal state, so the bar reaches 100%", () => {
  assertEquals(processedCount(snap({ valid: 2, invalid: 3, missing: 1, stalled: 1, failed: 1 })), 8);
  assertEquals(processedCount(snap()), 0);
});

// ── progress fragment ───────────────────────────────────────────────────────

Deno.test("GenieRetryProgress — running fragment shows the four counters and self-triggers", () => {
  const html = renderToString(
    <GenieRetryProgress snap={snap({ total: 4, queued: 2, valid: 1, invalid: 1, inFlightCount: 1, pendingCount: 2 })} elapsedMs={5_000} />,
  );
  for (const label of ["Queued", "Ran through", "Genie valid", "Still invalid"]) {
    assert(html.includes(label), `counter "${label}" must be visible`);
  }
  assert(html.includes("genie-retry-tick?jobId=abc123"), "must poll for the next tick while running");
  assert(html.includes("in flight"), "operator needs to see how many are moving");
});

Deno.test("GenieRetryProgress — terminal fragment stops polling and shows the outcome", () => {
  const html = renderToString(
    <GenieRetryProgress
      snap={snap({
        total: 1,
        queued: 1,
        valid: 1,
        done: true,
        results: [{ findingId: "a", state: "valid", score: 88, recordId: "493900", recordingId: "27624059", voName: "Jordan Price" }],
      })}
      elapsedMs={90_000}
    />,
  );
  assert(!html.includes("hx-post"), "a finished run must not keep polling");
  assert(html.includes("Recovered 1 audit"), "headline states the outcome");
  assert(html.includes("88%"), "result table shows the re-run's new score");
  assert(html.includes("27624059"), "result table shows the genie id from the snapshot");
});

Deno.test("GenieRetryProgress — progress tracks verdicts, not audits merely queued", () => {
  const html = renderToString(
    <GenieRetryProgress snap={snap({ total: 4, queued: 4, inFlightCount: 4, pendingCount: 0 })} elapsedMs={1_000} />,
  );
  assert(html.includes("0 / 4 (0%)"), "queued-but-unfinished work must not read as progress");
});

Deno.test("GenieRetryProgress — optional counters stay hidden until they matter", () => {
  const clean = renderToString(<GenieRetryProgress snap={snap({ total: 1 })} elapsedMs={0} />);
  assert(!clean.includes("Stalled"), "no stalled audits → no stalled counter");
  assert(!clean.includes("Failed"), "no failures → no failure counter");

  const noisy = renderToString(<GenieRetryProgress snap={snap({ total: 1, stalled: 1, failed: 2 })} elapsedMs={0} />);
  assert(noisy.includes("Stalled"));
  assert(noisy.includes("Failed"));
});

// ── Data Maintenance tab wiring ─────────────────────────────────────────────

Deno.test("maintenance modal — the Genie Retry tab renders its own panel, not the default", async () => {
  const { handler } = await import("../../../routes/api/admin/modal/maintenance.tsx");
  const get = (handler as { GET: (ctx: { req: Request }) => Response }).GET;
  const html = await get({ req: new Request("https://x/api/admin/modal/maintenance?tab=genie-retry") }).text();

  assert(html.includes("Genie Retry"), "tab label must be present");
  assert(html.includes("/api/admin/modal/maintenance/genie-retry-start"), "form posts to the kickoff route");
  assert(html.includes('id="genie-retry-msg"'), "progress fragment needs its swap target");
  assert(html.includes("hx-confirm"), "a write-from-first-click tool must confirm");
  assert(!html.includes("Backfill scores"), "must not fall back to the default tab");
});
