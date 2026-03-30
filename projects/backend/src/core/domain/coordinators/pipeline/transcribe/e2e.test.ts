/**
 * E2E tests for stepTranscribe coordinator.
 *
 * stepTranscribe reads a finding from KV, retrieves audio from S3,
 * sends it to AssemblyAI for transcription, saves the result, and
 * enqueues the transcribe-complete (diarize) step.
 * External calls (S3, AssemblyAI, queue) are mocked via fetch intercepts.
 */

import { assertEquals } from "@std/assert";
import { MockFetch } from "@test/mock-fetch";
import { Kv } from "../../../data/kv/mod.ts";
import { KvTestHelpers } from "../../../data/kv/test-helpers.ts";
import { stepTranscribe } from "./mod.ts";

// -- env setup ---------------------------------------------------------------

Deno.env.set("LOCAL_QUEUE", "true");
Deno.env.set("SELF_URL", "http://localhost:8000");
Deno.env.set("DENO_KV_URL", "http://localhost:4512");
Deno.env.set("KV_SERVICE_URL", "http://localhost:4512");
Deno.env.set("QSTASH_URL", "http://mock-qstash");
Deno.env.set("QSTASH_TOKEN", "mock-token");
Deno.env.set("S3_BUCKET", "test-bucket");
Deno.env.set("AWS_ACCESS_KEY_ID", "test-key");
Deno.env.set("AWS_SECRET_ACCESS_KEY", "test-secret");
Deno.env.set("ASSEMBLYAI_API_KEY", "test-assemblyai-key");

// -- helpers -----------------------------------------------------------------

function makeReq(body: unknown): Request {
  return new Request("http://localhost:8000/audit/step/transcribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function withKv<T>(fn: (kv: Kv) => Promise<T>): Promise<T> {
  const kv = await KvTestHelpers.fresh();
  Kv.setInstance(kv);
  try {
    return await fn(kv);
  } finally {
    Kv.resetInstance();
    kv.db.close();
  }
}

/** Build a fake audio payload. */
function fakeAudioBytes(): Uint8Array {
  return new Uint8Array(2048).fill(0xff);
}

function withMockFetch(fn: () => Promise<void>): Promise<void> {
  // Mock S3 GET — returns fake audio bytes
  MockFetch.route(/s3\..*\.amazonaws\.com/, () =>
    new Response(fakeAudioBytes(), { status: 200 })
  );
  // Mock AssemblyAI upload
  MockFetch.routeJson("assemblyai.com/v2/upload", {
    upload_url: "https://cdn.assemblyai.com/upload/test-audio",
  });
  // Mock AssemblyAI transcript submit + poll (returns completed immediately)
  MockFetch.routeJson("assemblyai.com/v2/transcript", {
    id: "tx-123",
    status: "completed",
    text: "Hello caller, how can I help you today?",
    utterances: [
      { speaker: "A", text: "Hello caller, how can I help you today?", start: 0, end: 5000 },
    ],
  });
  // Catch-all for local queue enqueue
  MockFetch.routeJson(/.*/, { ok: true });
  return fn().finally(() => MockFetch.restore());
}

function makeFinding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "finding-transcribe-1",
    auditJobId: "job-1",
    findingStatus: "getting-recording",
    owner: "agent@example.com",
    s3RecordingKey: "recordings/job-1/12345.mp3",
    record: { RecordId: "rec-001" },
    ...overrides,
  };
}

// -- Test 1: Returns 404 when finding not found ------------------------------

Deno.test({
  name: "stepTranscribe: returns 404 when finding is not in KV",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withKv(async (kv) => {
      await withMockFetch(async () => {
        const req = makeReq({
          findingId: "does-not-exist",
          orgId: "org1",
        });
        const res = await stepTranscribe(req);
        assertEquals(res.status, 404);
        const body = await res.json();
        assertEquals(body.error, "finding not found");
      });
    });
  },
});

// -- Test 2: Skips when finding already has a transcript ---------------------

Deno.test({
  name: "stepTranscribe: skips when finding already has rawTranscript",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withKv(async (kv) => {
      await kv.saveFinding("org1", makeFinding({
        id: "finding-already-transcribed",
        rawTranscript: "Already transcribed content here",
      }));

      await withMockFetch(async () => {
        const req = makeReq({
          findingId: "finding-already-transcribed",
          orgId: "org1",
        });
        const res = await stepTranscribe(req);
        assertEquals(res.status, 200);
        const body = await res.json();
        assertEquals(body.ok, true);
        assertEquals(body.skipped, true);
      });
    });
  },
});

// -- Test 3: Marks as Invalid Genie when no S3 key ---------------------------

Deno.test({
  name: "stepTranscribe: marks as Invalid Genie when s3RecordingKey is missing",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withKv(async (kv) => {
      await kv.saveFinding("org1", makeFinding({
        id: "finding-no-s3",
        s3RecordingKey: undefined,
      }));

      await withMockFetch(async () => {
        const req = makeReq({
          findingId: "finding-no-s3",
          orgId: "org1",
        });
        const res = await stepTranscribe(req);
        assertEquals(res.status, 200);
        const body = await res.json();
        assertEquals(body.ok, true);
        assertEquals(body.skipped, true);
        assertEquals(body.reason, "no s3 key");
      });

      // Verify finding was marked as Invalid Genie
      const updated = await kv.getFinding("org1", "finding-no-s3");
      assertEquals(updated?.rawTranscript, "Invalid Genie");
      assertEquals(updated?.findingStatus, "finished");
    });
  },
});

// -- Test 4: Happy path — transcribes audio and saves result -----------------

Deno.test({
  name: "stepTranscribe: transcribes audio from S3 and saves transcript",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withKv(async (kv) => {
      await kv.saveFinding("org1", makeFinding({
        id: "finding-happy-transcribe",
        s3RecordingKey: "recordings/job-1/12345.mp3",
      }));

      await withMockFetch(async () => {
        const req = makeReq({
          findingId: "finding-happy-transcribe",
          orgId: "org1",
        });
        const res = await stepTranscribe(req);
        assertEquals(res.status, 200);
        const body = await res.json();
        assertEquals(body.ok, true);
      });

      // Verify finding was updated with transcript (speaker-labeled by AssemblyAI)
      const updated = await kv.getFinding("org1", "finding-happy-transcribe");
      assertEquals(updated?.rawTranscript, "[AGENT]: Hello caller, how can I help you today?");
    });
  },
});
