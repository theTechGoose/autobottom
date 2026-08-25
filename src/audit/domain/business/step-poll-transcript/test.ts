/** Regression tests for the mqlfcCsh3sP1zH_6vpeT6 incident: step-transcribe
 *  successfully submitted an AssemblyAI transcript and saved the ID, but
 *  step-poll-transcript on a fresh isolate 15s later read the finding back
 *  without `assemblyAiTranscriptId` and routed the audit straight to
 *  "Genie Invalid" — booking a chargeback against a perfectly good
 *  recording. Fix: carry transcriptId in the QStash payload so polling
 *  doesn't depend on the saveFinding write being visible across isolates.
 *
 *  These tests stub globalThis.fetch to intercept:
 *    - AssemblyAI GET /v2/transcript/<id> (pollTranscriptOnce)
 *    - QStash POSTs (enqueueStep / publishStep / metric beacons)
 *  so the handler can run end-to-end against the in-mem Firestore
 *  fallback without network. The fetch stub is also where we record
 *  exactly which transcriptId pollTranscriptOnce was called with and
 *  which body the next-step enqueue carried — that's how we pin the
 *  failure mode to a concrete assertion. */

import { assert, assertEquals } from "#assert";
import { stepPollTranscript } from "./mod.ts";
import { resetFirestoreCredentials } from "@core/data/firestore/mod.ts";
import { saveFinding, getFinding } from "@audit/domain/data/audit-repository/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

interface CapturedFetch {
  url: string;
  init?: RequestInit;
}

interface Stub {
  // Canned poll response when AssemblyAI is hit.
  pollResponse: Record<string, unknown>;
  // URL → JSON body the QStash enqueue carried. Filled as calls land.
  enqueueBodies: Map<string, Record<string, unknown>>;
  // Every transcriptId pollTranscriptOnce called with (URL has it).
  polledTranscriptIds: string[];
  // Raw record of every fetch the test triggered, for debugging if a
  // future regression flips the call shape.
  calls: CapturedFetch[];
}

function installFetchStub(stub: Stub): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input instanceof URL ? input.toString() : input.url);
    // Storage is real HTTP now — Firestore emulator (:8099), the S3 stand-in
    // (:9001) and the token stub (:9003). Let those through; answering them
    // from this stub hands Firestore an empty 200 and S3 a 500. The queue
    // (:9002) is deliberately NOT passed through: these tests assert on what
    // was enqueued, so the stub still has to capture it.
    if ([":8099", ":9001", ":9003"].some((port) => url.includes(port))) return original(input, init);
    stub.calls.push({ url, init });
    // AssemblyAI poll: extract the transcriptId from the URL tail.
    if (url.includes("api.assemblyai.com")) {
      const idMatch = url.match(/\/transcript\/([^/?]+)$/);
      if (idMatch) stub.polledTranscriptIds.push(idMatch[1]);
      return new Response(JSON.stringify(stub.pollResponse), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    // QStash enqueue/publish — captures the body keyed by URL. The
    // `/audit/step/` arm also covers LOCAL_QUEUE=true mode (which some
    // other test in the suite sets globally): localEnqueue fetches the
    // target step URL directly instead of the QStash gateway, so we
    // need to match both.
    if (url.includes("qstash") || url.includes("upstash.io") || url.includes("/audit/step/") || url.includes(":9002")) {
      let bodyJson: Record<string, unknown> = {};
      try { bodyJson = JSON.parse(String(init?.body ?? "{}")); } catch { /* leave empty */ }
      stub.enqueueBodies.set(url, bodyJson);
      return new Response(JSON.stringify({ messageId: "stub-" + Math.random().toString(36).slice(2, 8) }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    // Anything else (Datadog OTel beacons etc.) — return success without
    // routing to the real network. The handler doesn't read these responses.
    return new Response("", { status: 200 });
  }) as typeof globalThis.fetch;
  return () => { globalThis.fetch = original; };
}

function freshStub(pollResponse: Record<string, unknown>): Stub {
  return {
    pollResponse,
    enqueueBodies: new Map(),
    polledTranscriptIds: [],
    calls: [],
  };
}

function reqWith(body: Record<string, unknown>): Request {
  return new Request("https://test.local/audit/step/poll-transcript", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const kvOpts = { sanitizeResources: false, sanitizeOps: false };

function uniqueIds(): { orgId: OrgId; findingId: string } {
  const tag = crypto.randomUUID().slice(0, 8);
  return {
    orgId: ("test-poll-" + tag) as unknown as OrgId,
    findingId: "fid-poll-" + tag,
  };
}

/** Per-test setup. Must run inside the test fn (NOT at module load) because:
 *  - Another test in the suite sets `LOCAL_QUEUE=true` during its body,
 *    which makes enqueueStep use setTimeout-deferred fetch (localEnqueue);
 *    the body wouldn't land inside our test window. Re-clear it on every
 *    test entry so we always get a synchronous fetch to the QStash URL
 *    (which our stub intercepts immediately).
 *  - QSTASH_TOKEN must be non-empty or the bearer header trips a path that
 *    short-circuits before our stub fires. Any value works. */
function setupEnv(): void {
  Deno.env.set("QSTASH_TOKEN", "test-stub-token");
  Deno.env.set("LOCAL_QUEUE", "");
}

// ── Test A — payload transcriptId is used even when the finding lacks it ──

Deno.test({
  name: "stepPollTranscript — uses payload transcriptId when finding has none (mqlfcCsh3sP1zH_6vpeT6 regression)",
  ...kvOpts,
  fn: async () => {
    setupEnv();
    resetFirestoreCredentials();
    const { orgId, findingId } = uniqueIds();
    // Finding looks healthy EXCEPT it's missing assemblyAiTranscriptId —
    // exactly the Firestore-race state that broke mqlfc… in prod.
    await saveFinding(orgId, {
      id: findingId,
      findingStatus: "transcribing",
      s3RecordingKey: "recordings/foo.mp3",
      record: { RecordId: 1234 },
    });
    const stub = freshStub({
      status: "completed",
      text: "Hello from the test transcript",
      utterances: [],
    });
    const undo = installFetchStub(stub);
    try {
      const res = await stepPollTranscript(reqWith({
        findingId, orgId,
        transcriptId: "tid-from-payload-only",
      }));
      assertEquals(res.status, 200);
      const json = await res.json();
      assertEquals(json.completed, true);
      // Critical: poll was made against the PAYLOAD id, not the finding's
      // (the finding never had one).
      assertEquals(stub.polledTranscriptIds, ["tid-from-payload-only"]);
      // The next step enqueued is transcribe-complete, with the real
      // transcript body now on the finding (NOT Genie Invalid).
      const enqueued = [...stub.enqueueBodies.values()];
      const completeEnqueue = enqueued.find((b) => (b as { findingId?: string }).findingId === findingId);
      assert(completeEnqueue, "expected an enqueue for transcribe-complete");
      // And nothing wrote Genie Invalid into the finding. Re-read it.
      const fresh = await getFinding(orgId, findingId);
      assertEquals(fresh?.rawTranscript, "Hello from the test transcript");
      assert(!String(fresh?.rawTranscript ?? "").includes("Genie Invalid"), "Genie-Invalid path should NOT have fired");
    } finally {
      undo();
    }
  },
});

// ── Test B — both missing still falls through to Genie-Invalid ────────────

Deno.test({
  name: "stepPollTranscript — both payload AND finding missing transcriptId → Genie Invalid (no false positives)",
  ...kvOpts,
  fn: async () => {
    setupEnv();
    resetFirestoreCredentials();
    const { orgId, findingId } = uniqueIds();
    await saveFinding(orgId, {
      id: findingId,
      findingStatus: "transcribing",
      s3RecordingKey: "recordings/foo.mp3",
      record: { RecordId: 1234 },
    });
    const stub = freshStub({}); // pollResponse won't be consulted
    const undo = installFetchStub(stub);
    try {
      const res = await stepPollTranscript(reqWith({ findingId, orgId }));
      assertEquals(res.status, 200);
      const json = await res.json();
      assertEquals(json.error, "no transcript id");
      // No poll attempt should have been made — we bailed before
      // pollTranscriptOnce.
      assertEquals(stub.polledTranscriptIds.length, 0);
      // Finding marked Genie Invalid + finished, queued for transcribe-cb.
      const fresh = await getFinding(orgId, findingId);
      assertEquals(fresh?.rawTranscript, "Genie Invalid");
      assertEquals(fresh?.findingStatus, "finished");
    } finally {
      undo();
    }
  },
});

// ── Test C — polling retry carries transcriptId forward ───────────────────

Deno.test({
  name: "stepPollTranscript — re-enqueue on 'processing' status propagates transcriptId in payload",
  ...kvOpts,
  fn: async () => {
    setupEnv();
    resetFirestoreCredentials();
    const { orgId, findingId } = uniqueIds();
    await saveFinding(orgId, {
      id: findingId,
      findingStatus: "transcribing",
      s3RecordingKey: "recordings/foo.mp3",
      record: { RecordId: 1234 },
    });
    const stub = freshStub({ status: "processing" });
    const undo = installFetchStub(stub);
    try {
      const res = await stepPollTranscript(reqWith({
        findingId, orgId,
        transcriptId: "tid-survives-retry",
      }));
      assertEquals(res.status, 200);
      const json = await res.json();
      assertEquals(json.polling, true);
      // The re-enqueue body MUST carry transcriptId so the next poll
      // also doesn't depend on a Firestore read.
      const enqueued = [...stub.enqueueBodies.values()];
      const reEnqueue = enqueued.find((b) =>
        (b as { findingId?: string }).findingId === findingId &&
        (b as { transcriptId?: string }).transcriptId === "tid-survives-retry"
      );
      assert(
        reEnqueue,
        `expected re-enqueue body to include transcriptId; got: ${JSON.stringify(enqueued)}`,
      );
    } finally {
      undo();
    }
  },
});

// ── Multi-genie polling ──────────────────────────────────────────────────────
// step-transcribe now submits every recording and hands the wait to this step
// instead of blocking inside its own request (the failure that stranded
// QqzfObJYP5aibL_YT6AHX at "transcribing" for 4 days). These pin the contract.

/** Stub that answers each transcript id differently, so ordering, partial
 *  completion and per-leg failure can all be asserted. */
function installPerIdStub(
  stub: Stub,
  byId: Record<string, Record<string, unknown>>,
): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input instanceof URL ? input.toString() : input.url);
    if ([":8099", ":9001", ":9003"].some((port) => url.includes(port))) return original(input, init);
    stub.calls.push({ url, init });
    if (url.includes("api.assemblyai.com")) {
      const idMatch = url.match(/\/transcript\/([^/?]+)$/);
      const id = idMatch?.[1] ?? "";
      if (id) stub.polledTranscriptIds.push(id);
      return new Response(JSON.stringify(byId[id] ?? { status: "error", error: "unknown id" }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("qstash") || url.includes("upstash.io") || url.includes("/audit/step/") || url.includes(":9002")) {
      let bodyJson: Record<string, unknown> = {};
      try { bodyJson = JSON.parse(String(init?.body ?? "{}")); } catch { /* leave empty */ }
      stub.enqueueBodies.set(url, bodyJson);
      return new Response(JSON.stringify({ messageId: "stub" }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    return new Response("", { status: 200 });
  }) as typeof globalThis.fetch;
  return () => { globalThis.fetch = original; };
}

const utt = (speaker: string, text: string, start: number) => ({ speaker, text, start, end: start + 1000 });

Deno.test({
  name: "stepPollTranscript — multi-genie concatenates completed legs in submit order",
  ...kvOpts,
  fn: async () => {
    setupEnv();
    resetFirestoreCredentials();
    const { orgId, findingId } = uniqueIds();
    await saveFinding(orgId, {
      id: findingId, auditJobId: "job-mg", findingStatus: "transcribing",
      record: { RecordId: 502442 }, assemblyAiTranscriptIds: ["tid-A", "tid-B"],
      assemblyAiSubmittedAt: Date.now() - 30_000,
    });
    const stub = freshStub({});
    const undo = installPerIdStub(stub, {
      "tid-A": { status: "completed", text: "leg one", utterances: [utt("A", "leg one", 0)] },
      "tid-B": { status: "completed", text: "leg two", utterances: [utt("A", "leg two", 0)] },
    });
    try {
      const res = await stepPollTranscript(reqWith({ findingId, orgId, transcriptIds: ["tid-A", "tid-B"] }));
      assertEquals(res.status, 200);
      const json = await res.json();
      assertEquals(json.completed, true);
      assertEquals(json.legs, 2);
      assertEquals(stub.polledTranscriptIds, ["tid-A", "tid-B"], "every leg polled, in order");

      const fresh = await getFinding(orgId, findingId);
      // Submit order is call chronology — leg two must never precede leg one.
      assert(
        fresh!.rawTranscript.indexOf("leg one") < fresh!.rawTranscript.indexOf("leg two"),
        `legs out of order: ${fresh!.rawTranscript}`,
      );
      assert(!fresh!.utteranceTimes, "no utteranceTimes: per-leg offsets would mis-seek the player on leg 2+");
      assert([...stub.enqueueBodies.keys()].some((u) => u.includes("transcribe-complete")), "pipeline continues");
    } finally {
      undo();
    }
  },
});

Deno.test({
  name: "stepPollTranscript — multi-genie re-polls while any leg is still running",
  ...kvOpts,
  fn: async () => {
    setupEnv();
    resetFirestoreCredentials();
    const { orgId, findingId } = uniqueIds();
    await saveFinding(orgId, {
      id: findingId, auditJobId: "job-mg2", findingStatus: "transcribing",
      record: { RecordId: 1 }, assemblyAiTranscriptIds: ["tid-A", "tid-B"],
    });
    const stub = freshStub({});
    const undo = installPerIdStub(stub, {
      "tid-A": { status: "completed", text: "done", utterances: [utt("A", "done", 0)] },
      "tid-B": { status: "processing" },
    });
    try {
      const res = await stepPollTranscript(reqWith({ findingId, orgId, transcriptIds: ["tid-A", "tid-B"] }));
      const json = await res.json();
      assertEquals(json.polling, true, "must come back later, not finalize on a partial result");
      assertEquals(json.pending, 1);

      const repoll = [...stub.enqueueBodies.entries()].find(([u]) => u.includes("poll-transcript"));
      assert(repoll, "re-enqueued itself");
      assertEquals(repoll![1].transcriptIds, ["tid-A", "tid-B"], "ids propagated so the re-poll doesn't lose them");

      const fresh = await getFinding(orgId, findingId);
      assert(!fresh?.rawTranscript, "no transcript written while a leg is outstanding");
      assertEquals(fresh?.findingStatus, "transcribing");
    } finally {
      undo();
    }
  },
});

Deno.test({
  name: "stepPollTranscript — multi-genie keeps a good leg when the other one errors",
  ...kvOpts,
  fn: async () => {
    setupEnv();
    resetFirestoreCredentials();
    const { orgId, findingId } = uniqueIds();
    await saveFinding(orgId, {
      id: findingId, auditJobId: "job-mg3", findingStatus: "transcribing",
      record: { RecordId: 1 }, assemblyAiTranscriptIds: ["tid-A", "tid-B"],
    });
    const stub = freshStub({});
    const undo = installPerIdStub(stub, {
      "tid-A": { status: "error", error: "boom" },
      "tid-B": { status: "completed", text: "survivor", utterances: [utt("A", "survivor", 0)] },
    });
    try {
      const res = await stepPollTranscript(reqWith({ findingId, orgId, transcriptIds: ["tid-A", "tid-B"] }));
      const json = await res.json();
      assertEquals(json.legs, 1);
      const fresh = await getFinding(orgId, findingId);
      // One dead leg must not sink an audit whose other recording is fine —
      // that was the old blocking loop's behaviour and it must be preserved.
      assert(fresh!.rawTranscript.includes("survivor"), `expected the good leg, got: ${fresh!.rawTranscript}`);
      assert(fresh!.rawTranscript !== "Genie Invalid", "one bad leg must not fail the whole audit");
    } finally {
      undo();
    }
  },
});

Deno.test({
  name: "stepPollTranscript — multi-genie with every leg failed finalizes as Genie Invalid",
  ...kvOpts,
  fn: async () => {
    setupEnv();
    resetFirestoreCredentials();
    const { orgId, findingId } = uniqueIds();
    await saveFinding(orgId, {
      id: findingId, auditJobId: "job-mg4", findingStatus: "transcribing",
      record: { RecordId: 1 }, assemblyAiTranscriptIds: ["tid-A", "tid-B"],
    });
    const stub = freshStub({});
    const undo = installPerIdStub(stub, {
      "tid-A": { status: "error", error: "boom" },
      "tid-B": { status: "error", error: "boom" },
    });
    try {
      await stepPollTranscript(reqWith({ findingId, orgId, transcriptIds: ["tid-A", "tid-B"] }));
      const fresh = await getFinding(orgId, findingId);
      assertEquals(fresh?.rawTranscript, "Genie Invalid");
      assertEquals(fresh?.findingStatus, "finished", "must reach a terminal state, never sit in 'transcribing'");
    } finally {
      undo();
    }
  },
});

Deno.test({
  name: "stepPollTranscript — multi-genie falls back to ids on the finding when payload lacks them",
  ...kvOpts,
  fn: async () => {
    setupEnv();
    resetFirestoreCredentials();
    const { orgId, findingId } = uniqueIds();
    await saveFinding(orgId, {
      id: findingId, auditJobId: "job-mg5", findingStatus: "transcribing",
      record: { RecordId: 1 }, assemblyAiTranscriptIds: ["tid-A", "tid-B"],
    });
    const stub = freshStub({});
    const undo = installPerIdStub(stub, {
      "tid-A": { status: "completed", text: "one", utterances: [utt("A", "one", 0)] },
      "tid-B": { status: "completed", text: "two", utterances: [utt("A", "two", 0)] },
    });
    try {
      // Mimics a message enqueued before the payload-shape change deployed.
      const res = await stepPollTranscript(reqWith({ findingId, orgId }));
      const json = await res.json();
      assertEquals(json.completed, true);
      assertEquals(stub.polledTranscriptIds, ["tid-A", "tid-B"]);
    } finally {
      undo();
    }
  },
});
