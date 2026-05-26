/** Regression tests for the LI6JHRl9-N6uvuRoA8ykO incident: a multi-genie
 *  re-audit downloaded the recording successfully (saw [GENIE] ✅ download ok
 *  in prod logs), but step-transcribe's getFinding raced step-init's chunked
 *  saveFinding and read a stale view missing s3RecordingKeys/s3RecordingKey/
 *  recordingPath. The line 36 saveFinding then overwrote the persisted doc
 *  with that stale snapshot — permanently wiping the recording fields — and
 *  the handler fell through to the "no s3 key" Invalid-Genie skip. Fix:
 *  step-init now payload-carries the recording fields and step-transcribe
 *  hydrates the finding from the payload before any save. */

import { assert, assertEquals } from "#assert";
import { stepTranscribe } from "./mod.ts";
import { resetFirestoreCredentials } from "@core/data/firestore/mod.ts";
import { saveFinding, getFinding } from "@audit/domain/data/audit-repository/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

interface Stub {
  enqueueBodies: Map<string, Record<string, unknown>>;
}

function installFetchStub(stub: Stub): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input instanceof URL ? input.toString() : input.url);
    if (url.includes("qstash") || url.includes("upstash.io") || url.includes("/audit/step/")) {
      let bodyJson: Record<string, unknown> = {};
      try { bodyJson = JSON.parse(String(init?.body ?? "{}")); } catch { /* leave empty */ }
      stub.enqueueBodies.set(url, bodyJson);
      return new Response(JSON.stringify({ messageId: "stub" }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("api.assemblyai.com")) {
      // submitTranscription expects { id: "..." }
      return new Response(JSON.stringify({ id: "tid-stub", status: "queued" }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    return new Response("", { status: 200 });
  }) as typeof globalThis.fetch;
  return () => { globalThis.fetch = original; };
}

function reqWith(body: Record<string, unknown>): Request {
  return new Request("https://test.local/audit/step/transcribe", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const kvOpts = { sanitizeResources: false, sanitizeOps: false };

function uniqueIds(): { orgId: OrgId; findingId: string } {
  const tag = crypto.randomUUID().slice(0, 8);
  return {
    orgId: ("test-tx-" + tag) as unknown as OrgId,
    findingId: "fid-tx-" + tag,
  };
}

function setupEnv(): void {
  Deno.env.set("QSTASH_TOKEN", "test-stub-token");
  Deno.env.set("LOCAL_QUEUE", "");
}

// ── Test A — payload-carried s3RecordingKey is used when finding lacks it ──

Deno.test({
  name: "stepTranscribe — payload s3RecordingKey hydrates a stale finding (LI6JHRl9 regression)",
  ...kvOpts,
  fn: async () => {
    setupEnv();
    resetFirestoreCredentials();
    const { orgId, findingId } = uniqueIds();
    // Stale finding: looks like a pre-step-init state — no recording fields.
    // This is the snapshot step-transcribe's getFinding would see if it
    // raced step-init's saveFinding.
    await saveFinding(orgId, {
      id: findingId,
      auditJobId: "job-tx",
      findingStatus: "getting-recording",
      record: { RecordId: 1234 },
    });
    const stub: Stub = { enqueueBodies: new Map() };
    const undo = installFetchStub(stub);
    try {
      const res = await stepTranscribe(reqWith({
        findingId, orgId,
        s3RecordingKeys: ["recordings/job-tx/27557328.mp3"],
        s3RecordingKey: "recordings/job-tx/27557328.mp3",
        recordingPath: "recordings/job-tx/27557328.mp3",
        // assemblyAiUploadUrl carried too so we skip the S3 read + upload
        // and head straight to submitTranscription (stubbed below).
        assemblyAiUploadUrl: "https://cdn.assemblyai.com/upload/stub",
      }));
      assertEquals(res.status, 200);
      const json = await res.json();
      // Critical: NOT the "no s3 key" Invalid-Genie skip.
      assert(json.reason !== "no s3 key", `expected hydration to avoid the no-s3-key skip; got ${JSON.stringify(json)}`);
      // The persisted finding must still have s3RecordingKey after the
      // handler's first saveFinding (which would otherwise wipe it).
      const fresh = await getFinding(orgId, findingId);
      assertEquals(fresh?.s3RecordingKey, "recordings/job-tx/27557328.mp3");
      assert(Array.isArray(fresh?.s3RecordingKeys) && fresh!.s3RecordingKeys.length === 1, "s3RecordingKeys preserved");
    } finally {
      undo();
    }
  },
});

// ── Test B — finding-doc-only path still works for legacy in-flight messages ─

Deno.test({
  name: "stepTranscribe — legacy in-flight message (no payload recording fields) still reads from finding doc",
  ...kvOpts,
  fn: async () => {
    setupEnv();
    resetFirestoreCredentials();
    const { orgId, findingId } = uniqueIds();
    await saveFinding(orgId, {
      id: findingId,
      auditJobId: "job-tx2",
      findingStatus: "getting-recording",
      record: { RecordId: 1234 },
      s3RecordingKey: "recordings/job-tx2/27557329.mp3",
      recordingPath: "recordings/job-tx2/27557329.mp3",
      assemblyAiUploadUrl: "https://cdn.assemblyai.com/upload/legacy",
    });
    const stub: Stub = { enqueueBodies: new Map() };
    const undo = installFetchStub(stub);
    try {
      // No recording fields in the payload — mimics a message enqueued before
      // this fix deployed.
      const res = await stepTranscribe(reqWith({ findingId, orgId }));
      assertEquals(res.status, 200);
      const json = await res.json();
      assert(json.reason !== "no s3 key", `legacy path should not skip when finding has the key`);
      const fresh = await getFinding(orgId, findingId);
      assertEquals(fresh?.s3RecordingKey, "recordings/job-tx2/27557329.mp3");
    } finally {
      undo();
    }
  },
});

// ── Test C — neither payload nor finding has a key → legitimate skip ──────

Deno.test({
  name: "stepTranscribe — payload AND finding both missing s3 key still routes to Invalid Genie (no false positives)",
  ...kvOpts,
  fn: async () => {
    setupEnv();
    resetFirestoreCredentials();
    const { orgId, findingId } = uniqueIds();
    await saveFinding(orgId, {
      id: findingId,
      auditJobId: "job-tx3",
      findingStatus: "getting-recording",
      record: { RecordId: 1234 },
    });
    const stub: Stub = { enqueueBodies: new Map() };
    const undo = installFetchStub(stub);
    try {
      const res = await stepTranscribe(reqWith({ findingId, orgId }));
      assertEquals(res.status, 200);
      const json = await res.json();
      assertEquals(json.reason, "no s3 key");
      const fresh = await getFinding(orgId, findingId);
      assertEquals(fresh?.rawTranscript, "Invalid Genie");
      assertEquals(fresh?.findingStatus, "finished");
    } finally {
      undo();
    }
  },
});
