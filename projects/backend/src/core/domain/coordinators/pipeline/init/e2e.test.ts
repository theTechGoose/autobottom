/**
 * E2E tests for stepInit coordinator.
 *
 * stepInit reads a finding from KV, downloads its recording from Genie,
 * saves to S3, and enqueues the transcribe step. All external calls
 * (Genie API, S3, queue) are mocked via fetch intercepts.
 */

import { assertEquals } from "@std/assert";
import { MockFetch } from "@test/mock-fetch";
import { Kv } from "../../../data/kv/mod.ts";
import { KvTestHelpers } from "../../../data/kv/test-helpers.ts";
import { stepInit } from "./mod.ts";

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
Deno.env.set("GENIE_AUTH", "test-genie-auth");
Deno.env.set("GENIE_AUTH_TWO", "test-genie-auth-two");
Deno.env.set("GENIE_BASE_URL", "http://mock-genie");
Deno.env.set("GENIE_PRIMARY_ACCOUNT", "1");
Deno.env.set("GENIE_SECONDARY_ACCOUNT", "2");

// -- helpers -----------------------------------------------------------------

function makeReq(body: unknown): Request {
  return new Request("http://localhost:8000/audit/step/init", {
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

/** Build a 2KB fake audio payload (Genie rejects < 1024 bytes). */
function fakeAudioBytes(): Uint8Array {
  return new Uint8Array(2048).fill(0xff);
}

function withMockFetch(fn: () => Promise<void>): Promise<void> {
  // Order matters: more specific patterns first, catch-all last.
  // Mock Genie audio download — returns fake audio bytes (must be before generic mock-genie)
  MockFetch.route(/mock-genie\/audio/, () =>
    new Response(fakeAudioBytes(), { status: 200 })
  );
  // Mock Genie search API — returns a recording source URL
  MockFetch.routeJson("mock-genie", {
    data: [{ contract: "12345", src: "http://mock-genie/audio/12345.mp3" }],
  });
  // Mock S3 PUT
  MockFetch.route(/s3\..*\.amazonaws\.com/, () =>
    new Response("", { status: 200 })
  );
  // Catch-all for local queue enqueue
  MockFetch.routeJson(/.*/, { ok: true });
  return fn().finally(() => MockFetch.restore());
}

function makeFinding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "finding-init-1",
    auditJobId: "job-1",
    findingStatus: "pending",
    recordingId: "12345",
    owner: "agent@example.com",
    record: { RecordId: "rec-001" },
    ...overrides,
  };
}

// -- Test 1: Returns 404 when finding not found ------------------------------

Deno.test({
  name: "stepInit: returns 404 when finding is not in KV",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withKv(async (kv) => {
      await withMockFetch(async () => {
        const req = makeReq({
          findingId: "does-not-exist",
          orgId: "org1",
        });
        const res = await stepInit(req);
        assertEquals(res.status, 404);
        const body = await res.json();
        assertEquals(body.error, "finding not found");
      });
    });
  },
});

// -- Test 2: Skips to finalize for invalid genie ID (all zeros) --------------

Deno.test({
  name: "stepInit: skips to finalize when genie ID is invalid (all zeros)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withKv(async (kv) => {
      await kv.saveFinding("org1", makeFinding({
        id: "finding-invalid-id",
        recordingId: "00000000",
      }));

      await withMockFetch(async () => {
        const req = makeReq({
          findingId: "finding-invalid-id",
          orgId: "org1",
        });
        const res = await stepInit(req);
        assertEquals(res.status, 200);
        const body = await res.json();
        assertEquals(body.ok, true);
        assertEquals(body.skipped, true);
        assertEquals(body.reason, "invalid genie");
      });

      // Verify finding was marked as Invalid Genie
      const updated = await kv.getFinding("org1", "finding-invalid-id");
      assertEquals(updated?.rawTranscript, "Invalid Genie");
      assertEquals(updated?.findingStatus, "finished");
    });
  },
});

// -- Test 3: Happy path — downloads recording, saves to S3, enqueues transcribe

Deno.test({
  name: "stepInit: downloads recording, saves to S3, and enqueues transcribe",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withKv(async (kv) => {
      await kv.saveFinding("org1", makeFinding({
        id: "finding-happy-init",
        recordingId: "12345",
        auditJobId: "job-happy",
      }));

      await withMockFetch(async () => {
        const req = makeReq({
          findingId: "finding-happy-init",
          orgId: "org1",
        });
        const res = await stepInit(req);
        assertEquals(res.status, 200);
        const body = await res.json();
        assertEquals(body.ok, true);
        assertEquals(body.s3Key, "recordings/job-happy/12345.mp3");
      });

      // Verify finding was updated with S3 key
      const updated = await kv.getFinding("org1", "finding-happy-init");
      assertEquals(updated?.s3RecordingKey, "recordings/job-happy/12345.mp3");
      assertEquals(updated?.findingStatus, "getting-recording");
    });
  },
});
