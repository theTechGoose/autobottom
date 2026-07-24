/** Tests for the Data Maintenance "Genie Retry" bulk re-run — the job store's
 *  concurrency-gate bookkeeping, the progress fragment, and the modal tab.
 *
 *  The gate arithmetic is the part that can quietly go wrong: if any terminal
 *  state fails to count, the run never reaches done and the poll loop spins
 *  forever; if a slot is freed without a verdict, more than 5 audits go through
 *  the pipeline at once. */

import { assert, assertEquals } from "@std/assert";
import { renderToString } from "preact-render-to-string";
import {
  createGenieRetryJob,
  getGenieRetryJob,
  isDone,
  MAX_IN_FLIGHT,
  processedCount,
  type GenieRetryJob,
} from "../../../lib/genie-retry-job-store.ts";
import { GenieRetryProgress } from "../../../components/GenieRetryProgress.tsx";
import { parseDateToMs } from "../../../routes/api/admin/modal/maintenance/genie-retry-start.tsx";

function newJob(fids: string[]): { jobId: string; job: GenieRetryJob } {
  return createGenieRetryJob({ since: 1_000, until: 2_000, fids, meta: new Map() });
}

// ── date window ─────────────────────────────────────────────────────────────

Deno.test("parseDateToMs — To (endOfDay) is inclusive to the last ms of the picked day", () => {
  const start = Date.parse("2026-07-20T00:00:00Z");
  assertEquals(parseDateToMs("2026-07-20"), start);
  assertEquals(parseDateToMs("2026-07-20", true), start + 86_400_000 - 1);
  assertEquals(parseDateToMs(""), null);
  assertEquals(parseDateToMs("not-a-date"), null);
});

// ── job store bookkeeping ───────────────────────────────────────────────────

Deno.test("job store — a fresh job is all pending, nothing processed, not done", () => {
  const { jobId, job } = newJob(["a", "b", "c"]);
  assertEquals(job.total, 3);
  assertEquals(job.pending.length, 3);
  assertEquals(job.inFlight.size, 0);
  assertEquals(processedCount(job), 0);
  assertEquals(isDone(job), false, "pending work must not read as done");
  assertEquals(getGenieRetryJob(jobId)?.total, 3);
});

Deno.test("job store — every terminal state counts toward processed, or the poll loop never ends", () => {
  const { job } = newJob([]);
  job.valid = 2;
  job.invalid = 3;
  job.missing = 1;
  job.stalled = 1;
  job.failed = 1;
  assertEquals(processedCount(job), 8, "valid + invalid + missing + stalled + failed");
});

Deno.test("job store — done only once pending AND in-flight are both empty", () => {
  const { job } = newJob(["a", "b"]);
  // Requeued one: still work outstanding on both sides.
  job.pending.splice(0, 1);
  job.inFlight.set("a", Date.now());
  assertEquals(isDone(job), false);
  // Verdict in, but "b" is still queued.
  job.inFlight.delete("a");
  job.valid = 1;
  assertEquals(isDone(job), false, "an audit still waiting in the queue is not done");
  // Last one through.
  job.pending.splice(0, 1);
  job.invalid = 1;
  assertEquals(isDone(job), true);
});

Deno.test("job store — the gate never hands out more than MAX_IN_FLIGHT slots", () => {
  const { job } = newJob(["a", "b", "c", "d", "e", "f", "g"]);
  // First top-up: every slot is free.
  let slots = MAX_IN_FLIGHT - job.inFlight.size;
  assertEquals(slots, 5);
  for (const fid of job.pending.splice(0, slots)) job.inFlight.set(fid, Date.now());
  assertEquals(job.inFlight.size, 5);
  assertEquals(job.pending.length, 2);

  // Nothing finished yet → no new slots, so the pipeline load stays flat.
  assertEquals(MAX_IN_FLIGHT - job.inFlight.size, 0);

  // Two reach a verdict → exactly two more go out.
  job.inFlight.delete("a");
  job.inFlight.delete("b");
  slots = MAX_IN_FLIGHT - job.inFlight.size;
  assertEquals(slots, 2);
  for (const fid of job.pending.splice(0, slots)) job.inFlight.set(fid, Date.now());
  assertEquals(job.inFlight.size, 5);
  assertEquals(job.pending.length, 0);
});

// ── progress fragment ───────────────────────────────────────────────────────

Deno.test("GenieRetryProgress — running fragment shows the four counters and self-triggers", () => {
  const { jobId, job } = newJob(["a", "b", "c", "d"]);
  job.pending.splice(0, 2);
  job.inFlight.set("a", Date.now());
  job.queued = 2;
  job.valid = 1;
  job.invalid = 1;
  const html = renderToString(<GenieRetryProgress jobId={jobId} job={job} done={false} elapsedMs={5_000} />);

  for (const label of ["Queued", "Ran through", "Genie valid", "Still invalid"]) {
    assert(html.includes(label), `counter "${label}" must be visible`);
  }
  assert(html.includes(`genie-retry-tick?jobId=${jobId}`), "must poll for the next tick while running");
  assert(html.includes("in flight"), "operator needs to see how many are moving");
});

Deno.test("GenieRetryProgress — terminal fragment stops polling", () => {
  const { jobId, job } = newJob(["a"]);
  job.pending.length = 0;
  job.queued = 1;
  job.valid = 1;
  job.results.push({ findingId: "a", state: "valid", score: 88 });
  const html = renderToString(<GenieRetryProgress jobId={jobId} job={job} done={true} elapsedMs={90_000} />);

  assert(!html.includes("hx-post"), "a finished run must not keep polling");
  assert(html.includes("Recovered 1 audit"), "headline states the outcome");
  assert(html.includes("88%"), "result table shows the re-run's new score");
});

Deno.test("GenieRetryProgress — progress tracks verdicts, not audits merely queued", () => {
  const { jobId, job } = newJob(["a", "b", "c", "d"]);
  // All four handed to the pipeline, none finished.
  job.pending.length = 0;
  job.queued = 4;
  for (const fid of ["a", "b", "c", "d"]) job.inFlight.set(fid, Date.now());
  const html = renderToString(<GenieRetryProgress jobId={jobId} job={job} done={false} elapsedMs={1_000} />);
  assert(html.includes("0 / 4 (0%)"), "queued-but-unfinished work must not read as progress");
});

Deno.test("GenieRetryProgress — optional counters stay hidden until they matter", () => {
  const { jobId, job } = newJob(["a"]);
  const clean = renderToString(<GenieRetryProgress jobId={jobId} job={job} done={false} elapsedMs={0} />);
  assert(!clean.includes("Stalled"), "no stalled audits → no stalled counter");
  assert(!clean.includes("Failed"), "no failures → no failure counter");

  job.stalled = 1;
  job.failed = 2;
  const noisy = renderToString(<GenieRetryProgress jobId={jobId} job={job} done={false} elapsedMs={0} />);
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
