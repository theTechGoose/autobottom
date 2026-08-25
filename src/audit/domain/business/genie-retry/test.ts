/** Tests for the bulk invalid-genie re-run.
 *
 *  The two behaviours worth pinning are the ones that silently produce a wrong
 *  answer rather than an error:
 *    - listing must key off the NEWEST index row per finding, or an audit that
 *      was already recovered gets re-run forever;
 *    - a requeued finding must come back with its run state cleared, or the
 *      re-run is a no-op (step-transcribe short-circuits on the stale
 *      "Invalid Genie" sentinel — the bug this whole tool exists to fix). */

import { assert, assertEquals } from "#assert";
import {
  advanceForceHundredJob,
  advanceGenieRetryJob,
  checkGenieRetryOutcomes,
  listInvalidGenieFindings,
  MAX_IN_FLIGHT,
  requeueGenieRetryBatch,
  startForceHundredJob,
  startGenieRetryJob,
} from "./mod.ts";
import { getFinding, saveFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { setStored } from "@core/data/firestore/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

const kvOpts = { sanitizeResources: false, sanitizeOps: false };

function uniqueOrg(tag: string): OrgId {
  return (`test-gr-${tag}-` + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
}

function setupEnv(): void {
  Deno.env.set("QSTASH_TOKEN", "test-stub-token");
  Deno.env.set("LOCAL_QUEUE", "");
}

/** Swallow the QStash publish so requeue tests don't fire real HTTP. */
function installFetchStub(): { restore: () => void; publishedTo: string[] } {
  const original = globalThis.fetch;
  const publishedTo: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input instanceof URL ? input.toString() : input.url);
    // Storage is real HTTP now — Firestore emulator (:8099), the S3 stand-in
    // (:9001) and the token stub (:9003). Let those through; answering them
    // from this stub hands Firestore an empty 200 and S3 a 500. The queue
    // (:9002) is deliberately NOT passed through: these tests assert on what
    // was enqueued, so the stub still has to capture it.
    if ([":8099", ":9001", ":9003"].some((port) => url.includes(port))) return original(input, init);
    publishedTo.push(url);
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(String(init?.body ?? "{}")); } catch { /* leave empty */ }
    if (typeof body.findingId === "string") publishedTo.push(`step:${body.findingId}`);
    return new Response(JSON.stringify({ messageId: "stub" }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return { restore: () => { globalThis.fetch = original; }, publishedTo };
}

/** Write one audit-done-idx row the way step-finalize does. */
async function idxRow(orgId: OrgId, row: {
  findingId: string;
  completedAt: number;
  reason?: string;
  recordId?: string;
  recordingId?: string;
  voName?: string;
}): Promise<void> {
  await setStored("audit-done-idx", orgId, [`${row.findingId}-${row.completedAt}`], {
    completed: true,
    score: 0,
    ...row,
  });
}

// ── listInvalidGenieFindings ────────────────────────────────────────────────

Deno.test({ name: "listInvalidGenieFindings — returns only invalid-genie audits in the window", ...kvOpts, fn: async () => {
  const orgId = uniqueOrg("list");
  await idxRow(orgId, { findingId: "f-bad", completedAt: 2_000, reason: "invalid_genie", recordId: "493900", recordingId: "27624059", voName: "Jordan Price" });
  await idxRow(orgId, { findingId: "f-perfect", completedAt: 2_100, reason: "perfect_score" });
  await idxRow(orgId, { findingId: "f-reviewed", completedAt: 2_200, reason: "reviewed" });

  const out = await listInvalidGenieFindings(orgId, 1_000, 3_000);
  assertEquals(out.length, 1);
  assertEquals(out[0].findingId, "f-bad");
  // Metadata rides along so the result table can name the audit.
  assertEquals(out[0].recordId, "493900");
  assertEquals(out[0].recordingId, "27624059");
  assertEquals(out[0].voName, "Jordan Price");
}});

Deno.test({ name: "listInvalidGenieFindings — an audit recovered by a later row is NOT a candidate", ...kvOpts, fn: async () => {
  const orgId = uniqueOrg("newest");
  // Same finding, two rows: failed invalid-genie, then recovered and reviewed.
  await idxRow(orgId, { findingId: "f-recovered", completedAt: 1_500, reason: "invalid_genie" });
  await idxRow(orgId, { findingId: "f-recovered", completedAt: 9_000, reason: "reviewed" });

  const out = await listInvalidGenieFindings(orgId, 1_000, 10_000);
  assertEquals(out.map((c) => c.findingId), [], "newest row wins — re-running a recovered audit would loop forever");
}});

Deno.test({ name: "listInvalidGenieFindings — still-invalid audit with several rows is listed once", ...kvOpts, fn: async () => {
  const orgId = uniqueOrg("dupe");
  await idxRow(orgId, { findingId: "f-dupe", completedAt: 1_500, reason: "invalid_genie" });
  await idxRow(orgId, { findingId: "f-dupe", completedAt: 4_000, reason: "invalid_genie" });

  const out = await listInvalidGenieFindings(orgId, 1_000, 10_000);
  assertEquals(out.map((c) => c.findingId), ["f-dupe"]);
}});

Deno.test({ name: "listInvalidGenieFindings — oldest first", ...kvOpts, fn: async () => {
  const orgId = uniqueOrg("order");
  await idxRow(orgId, { findingId: "f-new", completedAt: 8_000, reason: "invalid_genie" });
  await idxRow(orgId, { findingId: "f-old", completedAt: 2_000, reason: "invalid_genie" });
  await idxRow(orgId, { findingId: "f-mid", completedAt: 5_000, reason: "invalid_genie" });

  const out = await listInvalidGenieFindings(orgId, 1_000, 10_000);
  assertEquals(out.map((c) => c.findingId), ["f-old", "f-mid", "f-new"]);
}});

// ── requeueGenieRetryBatch ──────────────────────────────────────────────────

Deno.test({ name: "requeueGenieRetryBatch — clears the stale sentinel so the re-run isn't a no-op", ...kvOpts, fn: async () => {
  setupEnv();
  const orgId = uniqueOrg("requeue");
  const stub = installFetchStub();
  try {
    await saveFinding(orgId, {
      id: "f-rq",
      findingStatus: "finished",
      rawTranscript: "Invalid Genie",
      answeredQuestions: [{ header: "Q1", answer: "No" }],
      genieAttempts: 4,
      record: { RecordId: "493900" },
      recordingId: "27624059",
    });

    const r = await requeueGenieRetryBatch(orgId, ["f-rq"]);
    assertEquals(r.requeued, ["f-rq"]);
    assertEquals(r.failed, []);

    const after = (await getFinding(orgId, "f-rq"))!;
    // The exact condition step-transcribe/mod.ts:51 short-circuits on.
    assertEquals(after.rawTranscript, undefined);
    assertEquals(after.answeredQuestions, undefined);
    assertEquals(after.genieAttempts, undefined, "a re-run with attempts spent gets zero download retries");
    assertEquals(after.findingStatus, "pending");
    // Inputs the re-run needs must survive.
    assertEquals(after.recordingId, "27624059");
  } finally {
    stub.restore();
  }
}});

Deno.test({ name: "requeueGenieRetryBatch — stamps skipGenieRetry so a still-missing genie finalizes fast, not on a 40-min ladder", ...kvOpts, fn: async () => {
  setupEnv();
  const orgId = uniqueOrg("skip");
  const stub = installFetchStub();
  try {
    await saveFinding(orgId, {
      id: "f-skip",
      findingStatus: "finished",
      rawTranscript: "Invalid Genie",
      recordingId: "27624059",
    });
    await requeueGenieRetryBatch(orgId, ["f-skip"]);
    assertEquals((await getFinding(orgId, "f-skip"))!.skipGenieRetry, true);
  } finally {
    stub.restore();
  }
}});

Deno.test({ name: "requeueGenieRetryBatch — a missing finding is reported failed, not requeued", ...kvOpts, fn: async () => {
  setupEnv();
  const orgId = uniqueOrg("missing");
  const stub = installFetchStub();
  try {
    const r = await requeueGenieRetryBatch(orgId, ["f-nope"]);
    assertEquals(r.requeued, []);
    assertEquals(r.failed, ["f-nope"], "the tick loop counts these terminally or the run never ends");
  } finally {
    stub.restore();
  }
}});

Deno.test({ name: "requeueGenieRetryBatch — empty input is a no-op", ...kvOpts, fn: async () => {
  const orgId = uniqueOrg("empty");
  const r = await requeueGenieRetryBatch(orgId, []);
  assertEquals(r.requeued, []);
  assertEquals(r.failed, []);
}});

// ── checkGenieRetryOutcomes ─────────────────────────────────────────────────

Deno.test({ name: "checkGenieRetryOutcomes — classifies running / valid / invalid / missing", ...kvOpts, fn: async () => {
  const orgId = uniqueOrg("status");
  await saveFinding(orgId, { id: "f-running", findingStatus: "transcribing", rawTranscript: "" });
  await saveFinding(orgId, {
    id: "f-valid",
    findingStatus: "finished",
    rawTranscript: "Agent: thanks for calling. Guest: hello there.",
    answeredQuestions: [{ answer: "Yes" }, { answer: "Yes" }, { answer: "No" }],
  });
  await saveFinding(orgId, {
    id: "f-invalid",
    findingStatus: "finished",
    rawTranscript: "Invalid Genie",
    answeredQuestions: [{ answer: "No" }],
  });

  const out = await checkGenieRetryOutcomes(orgId, ["f-running", "f-valid", "f-invalid", "f-gone"]);
  const byId = new Map(out.map((o) => [o.findingId, o]));

  assertEquals(byId.get("f-running")!.state, "running");
  assertEquals(byId.get("f-valid")!.state, "valid");
  assertEquals(byId.get("f-valid")!.score, 67, "2 of 3 Yes");
  assert((byId.get("f-valid")!.transcriptChars ?? 0) > 0);
  assertEquals(byId.get("f-invalid")!.state, "invalid");
  assertEquals(byId.get("f-gone")!.state, "missing");
}});

Deno.test({ name: "checkGenieRetryOutcomes — 'Genie Invalid' spelling also counts as invalid", ...kvOpts, fn: async () => {
  const orgId = uniqueOrg("spelling");
  await saveFinding(orgId, { id: "f-alt", findingStatus: "finished", rawTranscript: "Genie Invalid" });
  const [o] = await checkGenieRetryOutcomes(orgId, ["f-alt"]);
  assertEquals(o.state, "invalid");
}});

Deno.test({ name: "checkGenieRetryOutcomes — finished with an empty transcript is invalid, not valid", ...kvOpts, fn: async () => {
  const orgId = uniqueOrg("blank");
  await saveFinding(orgId, { id: "f-blank", findingStatus: "finished", rawTranscript: "   " });
  const [o] = await checkGenieRetryOutcomes(orgId, ["f-blank"]);
  assertEquals(o.state, "invalid", "no transcript is a failed re-run, however it got there");
}});

Deno.test({ name: "checkGenieRetryOutcomes — preserves input order and handles an empty list", ...kvOpts, fn: async () => {
  const orgId = uniqueOrg("order2");
  await saveFinding(orgId, { id: "f-a", findingStatus: "finished", rawTranscript: "real text a" });
  await saveFinding(orgId, { id: "f-b", findingStatus: "pending" });
  await saveFinding(orgId, { id: "f-c", findingStatus: "finished", rawTranscript: "Invalid Genie" });

  assertEquals(await checkGenieRetryOutcomes(orgId, []), []);
  const out = await checkGenieRetryOutcomes(orgId, ["f-a", "f-b", "f-c"]);
  assertEquals(out.map((o) => o.findingId), ["f-a", "f-b", "f-c"]);
  assertEquals(out.map((o) => o.state), ["valid", "running", "invalid"]);
}});

// ── Persisted job (start / advance) ─────────────────────────────────────────
// The whole point of persisting is that a run survives an isolate swap. In
// these tests each advance() is a fresh call that only touches Firestore — no
// in-memory job is threaded between them, exactly as separate isolates would
// behave. A run that advances to done through independent calls proves the
// old "job not found on the next tick" failure is gone.

Deno.test({ name: "startGenieRetryJob — persists a job with every candidate pending, nothing in flight", ...kvOpts, fn: async () => {
  setupEnv();
  const orgId = uniqueOrg("start");
  for (let i = 0; i < 3; i++) {
    await idxRow(orgId, { findingId: `f-s${i}`, completedAt: 1_000 + i, reason: "invalid_genie", recordingId: "27624059" });
    await saveFinding(orgId, { id: `f-s${i}`, findingStatus: "finished", rawTranscript: "Invalid Genie", recordingId: "27624059" });
  }
  const snap = await startGenieRetryJob(orgId, 500, 5_000);
  assertEquals(snap.total, 3);
  assertEquals(snap.pendingCount, 3);
  assertEquals(snap.inFlightCount, 0);
  assertEquals(snap.queued, 0, "start persists the job but requeues nothing — the first advance does");
  assertEquals(snap.done, false);
  assert(snap.jobId.length > 0);
}});

Deno.test({ name: "startGenieRetryJob — an empty window yields a done, zero-total snapshot", ...kvOpts, fn: async () => {
  const orgId = uniqueOrg("start-empty");
  const snap = await startGenieRetryJob(orgId, 500, 5_000);
  assertEquals(snap.total, 0);
  assertEquals(snap.done, true, "nothing to do reads as done so the UI shows the empty state");
}});

Deno.test({ name: "advanceGenieRetryJob — returns null for an unknown job (expired / never existed)", ...kvOpts, fn: async () => {
  const orgId = uniqueOrg("advance-missing");
  assertEquals(await advanceGenieRetryJob(orgId, "nope1234"), null);
}});

Deno.test({ name: "advanceGenieRetryJob — first tick requeues up to MAX_IN_FLIGHT and no more", ...kvOpts, fn: async () => {
  setupEnv();
  const orgId = uniqueOrg("advance-gate");
  const stub = installFetchStub();
  try {
    const n = MAX_IN_FLIGHT + 3;
    for (let i = 0; i < n; i++) {
      await idxRow(orgId, { findingId: `f-g${i}`, completedAt: 1_000 + i, reason: "invalid_genie", recordingId: "27624059" });
      await saveFinding(orgId, { id: `f-g${i}`, findingStatus: "finished", rawTranscript: "Invalid Genie", recordingId: "27624059" });
    }
    const start = await startGenieRetryJob(orgId, 500, 5_000);

    // Fresh call, as a different isolate would make it — the job is loaded from
    // Firestore, not memory.
    const t1 = await advanceGenieRetryJob(orgId, start.jobId);
    assert(t1 !== null, "the job must be found on the next tick — the bug we fixed");
    assertEquals(t1!.inFlightCount, MAX_IN_FLIGHT, "never more than 5 audits in the pipeline at once");
    assertEquals(t1!.queued, MAX_IN_FLIGHT);
    assertEquals(t1!.pendingCount, 3, "the rest wait their turn");
    assertEquals(t1!.done, false);
  } finally {
    stub.restore();
  }
}});

Deno.test({ name: "advanceGenieRetryJob — a run drives to done across independent ticks and classifies each audit", ...kvOpts, fn: async () => {
  setupEnv();
  const orgId = uniqueOrg("advance-done");
  const stub = installFetchStub();
  try {
    // Two audits: one will 'recover' (real transcript), one stays invalid.
    await idxRow(orgId, { findingId: "f-ok", completedAt: 1_000, reason: "invalid_genie", recordingId: "27624059", voName: "Recovers" });
    await idxRow(orgId, { findingId: "f-bad", completedAt: 1_001, reason: "invalid_genie", recordingId: "27624060", voName: "StaysBad" });
    await saveFinding(orgId, { id: "f-ok", findingStatus: "finished", rawTranscript: "Invalid Genie" });
    await saveFinding(orgId, { id: "f-bad", findingStatus: "finished", rawTranscript: "Invalid Genie" });

    const start = await startGenieRetryJob(orgId, 500, 5_000);

    // Tick 1: requeues both (clearFindingRunState resets them to pending).
    const t1 = await advanceGenieRetryJob(orgId, start.jobId);
    assertEquals(t1!.inFlightCount, 2);
    assertEquals(t1!.queued, 2);

    // The pipeline "runs": simulate each finding's finished state.
    await saveFinding(orgId, {
      id: "f-ok",
      findingStatus: "finished",
      rawTranscript: "Agent: hi there, thanks for calling today.",
      answeredQuestions: [{ answer: "Yes" }, { answer: "Yes" }],
    });
    await saveFinding(orgId, { id: "f-bad", findingStatus: "finished", rawTranscript: "Invalid Genie" });

    // Tick 2: polls, retires both, nothing left → done.
    const t2 = await advanceGenieRetryJob(orgId, start.jobId);
    assert(t2 !== null);
    assertEquals(t2!.done, true);
    assertEquals(t2!.valid, 1);
    assertEquals(t2!.invalid, 1);
    assertEquals(t2!.inFlightCount, 0);

    const byId = new Map(t2!.results.map((r) => [r.findingId, r]));
    assertEquals(byId.get("f-ok")!.state, "valid");
    assertEquals(byId.get("f-ok")!.score, 100);
    assertEquals(byId.get("f-ok")!.voName, "Recovers", "display metadata rides along into the result row");
    assertEquals(byId.get("f-bad")!.state, "invalid");

    // Done deletes the doc — a late tick can't resurrect it, and the terminal
    // fragment has stopped polling anyway.
    assertEquals(await advanceGenieRetryJob(orgId, start.jobId), null);
  } finally {
    stub.restore();
  }
}});

// ── Force-to-100 job (start / advance) ──────────────────────────────────────
// Forces invalid-genie audits to a 100% reviewed pass via adminFlipFinding.
// Same persisted-job discipline as the recovery job: independent advance()
// calls, all state in Firestore.

Deno.test({ name: "startForceHundredJob — lists the same invalid-genie audits, nothing flipped yet", ...kvOpts, fn: async () => {
  const orgId = uniqueOrg("fh-start");
  for (let i = 0; i < 3; i++) {
    await idxRow(orgId, { findingId: `f-fh${i}`, completedAt: 1_000 + i, reason: "invalid_genie", recordingId: "27624059", voName: `VO${i}` });
    await saveFinding(orgId, { id: `f-fh${i}`, findingStatus: "finished", rawTranscript: "Invalid Genie", answeredQuestions: [{ header: "Q1", answer: "No" }] });
  }
  await idxRow(orgId, { findingId: "f-ok", completedAt: 1_100, reason: "reviewed" }); // not a candidate
  const snap = await startForceHundredJob(orgId, 500, 5_000, "admin@x.com");
  assertEquals(snap.total, 3);
  assertEquals(snap.pendingCount, 3);
  assertEquals(snap.flipped, 0);
  assertEquals(snap.done, false);
}});

Deno.test({ name: "advanceForceHundredJob — flips a batch to 100% and reaches done, with the audit graded 100", ...kvOpts, fn: async () => {
  const orgId = uniqueOrg("fh-advance");
  await idxRow(orgId, { findingId: "f-flip", completedAt: 1_000, reason: "invalid_genie", recordingId: "27624059", voName: "Jordan Price" });
  await saveFinding(orgId, {
    id: "f-flip",
    findingStatus: "finished",
    rawTranscript: "Invalid Genie",
    answeredQuestions: [{ header: "Q1", answer: "No" }, { header: "Q2", answer: "No" }],
    record: { RecordId: "493900" },
  });

  const start = await startForceHundredJob(orgId, 500, 5_000, "admin@x.com");
  const t1 = await advanceForceHundredJob(orgId, start.jobId);
  assert(t1 !== null);
  assertEquals(t1!.done, true);
  assertEquals(t1!.flipped, 1);
  assertEquals(t1!.failed, 0);
  assertEquals(t1!.results[0].findingId, "f-flip");
  assertEquals(t1!.results[0].ok, true);
  assertEquals(t1!.results[0].voName, "Jordan Price", "metadata rides into the result row");

  // The finding is now a 100% reviewed pass: answers flipped, reviewScore set,
  // and the admin stamped as the reviewer on each flipped question.
  const after = (await getFinding(orgId, "f-flip"))!;
  assertEquals(after.reviewScore, 100);
  const qs = after.answeredQuestions as Array<{ answer: string; reviewedBy?: string }>;
  assertEquals(qs.every((q) => q.answer === "Yes"), true);
  assertEquals(qs[0].reviewedBy, "admin@x.com");

  // Done deletes the doc.
  assertEquals(await advanceForceHundredJob(orgId, start.jobId), null);
}});

Deno.test({ name: "advanceForceHundredJob — returns null for an unknown job", ...kvOpts, fn: async () => {
  const orgId = uniqueOrg("fh-missing");
  assertEquals(await advanceForceHundredJob(orgId, "nope1234"), null);
}});
