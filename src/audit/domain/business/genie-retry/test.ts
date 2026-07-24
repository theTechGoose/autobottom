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
  checkGenieRetryOutcomes,
  listInvalidGenieFindings,
  requeueGenieRetryBatch,
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
