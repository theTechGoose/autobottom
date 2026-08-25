/** Regression tests for the BTuR4O… incident: a chunked saveFinding from
 *  step-poll-transcript wasn't visible to step-transcribe-cb across the
 *  QStash isolate hop, the 3-retry chunked read (200/400/600ms) still
 *  missed it, and the audit silently finalized with 0 Yes/0 No. Fix:
 *  carry rawTranscript in the QStash payload so the cb never reads it
 *  from Firestore. These tests pin the new behavior with the same
 *  fetch-stub pattern as step-poll-transcript/test.ts. */

import { assert, assertEquals } from "#assert";
import { stepTranscribeCb } from "./mod.ts";
import { resetFirestoreCredentials } from "@core/data/firestore/mod.ts";
import { saveFinding, getFinding, getTranscript } from "@audit/domain/data/audit-repository/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

interface Stub {
  enqueueBodies: Map<string, Record<string, unknown>>;
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

function reqWith(body: Record<string, unknown>): Request {
  return new Request("https://test.local/audit/step/transcribe-complete", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const kvOpts = { sanitizeResources: false, sanitizeOps: false };

function uniqueIds(): { orgId: OrgId; findingId: string } {
  const tag = crypto.randomUUID().slice(0, 8);
  return {
    orgId: ("test-tcb-" + tag) as unknown as OrgId,
    findingId: "fid-tcb-" + tag,
  };
}

function setupEnv(): void {
  Deno.env.set("QSTASH_TOKEN", "test-stub-token");
  Deno.env.set("LOCAL_QUEUE", "");
}

// ── Test A — payload rawTranscript wins even when finding doc lacks it ─────

Deno.test({
  name: "stepTranscribeCb — uses payload rawTranscript when finding has none (BTuR4O… regression)",
  ...kvOpts,
  fn: async () => {
    setupEnv();
    resetFirestoreCredentials();
    const { orgId, findingId } = uniqueIds();
    // Finding looks healthy EXCEPT rawTranscript is missing — exactly the
    // chunked-write race state that produced 0/0 audits in prod.
    await saveFinding(orgId, {
      id: findingId,
      findingStatus: "transcribing",
      s3RecordingKey: "recordings/foo.mp3",
      record: { RecordId: 1234 },
    });
    const stub: Stub = { enqueueBodies: new Map() };
    const undo = installFetchStub(stub);
    try {
      const res = await stepTranscribeCb(reqWith({
        findingId, orgId,
        rawTranscript: "Hello from the payload",
        utteranceTimes: [0, 500, 1200],
      }));
      assertEquals(res.status, 200);
      const json = await res.json();
      assertEquals(json.ok, true);
      assertEquals(json.skipped, undefined, "should not have hit the skip-to-finalize path");
      // Both prepare + diarize-async should be enqueued.
      const enqueued = [...stub.enqueueBodies.values()];
      assert(enqueued.some((b) => (b as { findingId?: string }).findingId === findingId), "expected prepare/diarize enqueue");
      // Finding doc should now reflect the payload value so downstream
      // pipeline steps (ask-batch, ask-all) read the same text.
      const fresh = await getFinding(orgId, findingId);
      assertEquals(fresh?.rawTranscript, "Hello from the payload");
      // Canonical audit-transcript doc was written too.
      const t = await getTranscript(orgId, findingId);
      assertEquals(t?.raw, "Hello from the payload");
      assertEquals(t?.utteranceTimes, [0, 500, 1200]);
    } finally {
      undo();
    }
  },
});

// ── Test B — Genie Invalid sentinel in payload still routes to finalize ────

Deno.test({
  name: "stepTranscribeCb — payload carrying 'Genie Invalid' sentinel skips straight to finalize",
  ...kvOpts,
  fn: async () => {
    setupEnv();
    resetFirestoreCredentials();
    const { orgId, findingId } = uniqueIds();
    await saveFinding(orgId, {
      id: findingId,
      findingStatus: "finished",
      record: { RecordId: 1234 },
    });
    const stub: Stub = { enqueueBodies: new Map() };
    const undo = installFetchStub(stub);
    try {
      const res = await stepTranscribeCb(reqWith({
        findingId, orgId,
        rawTranscript: "Genie Invalid",
      }));
      assertEquals(res.status, 200);
      const json = await res.json();
      assertEquals(json.skipped, true);
      assertEquals(json.reason, "invalid transcript");
      // Finalize should have been enqueued; prepare/diarize-async should NOT.
      const enqueued = [...stub.enqueueBodies.entries()];
      const finalizeOnly = enqueued.filter(([url]) => url.includes("finalize"));
      const prepareOrDiarize = enqueued.filter(([url]) => url.includes("prepare") || url.includes("diarize"));
      assert(finalizeOnly.length > 0, "expected a finalize enqueue");
      assertEquals(prepareOrDiarize.length, 0, "should NOT have enqueued prepare/diarize for invalid transcript");
    } finally {
      undo();
    }
  },
});

// ── Test C — legacy in-flight message with empty payload falls back to finding ─

Deno.test({
  name: "stepTranscribeCb — empty payload still reads finding.rawTranscript (legacy in-flight messages)",
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
      rawTranscript: "Legacy text from finding doc",
    });
    const stub: Stub = { enqueueBodies: new Map() };
    const undo = installFetchStub(stub);
    try {
      const res = await stepTranscribeCb(reqWith({ findingId, orgId }));
      assertEquals(res.status, 200);
      const json = await res.json();
      assertEquals(json.ok, true);
      assertEquals(json.skipped, undefined, "should NOT have skipped when finding doc has the transcript");
      const t = await getTranscript(orgId, findingId);
      assertEquals(t?.raw, "Legacy text from finding doc");
    } finally {
      undo();
    }
  },
});
