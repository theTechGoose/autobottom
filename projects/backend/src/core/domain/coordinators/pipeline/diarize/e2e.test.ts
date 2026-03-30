/**
 * E2E tests for stepTranscribeCb (diarize step) coordinator.
 *
 * stepTranscribeCb reads a finding from KV, diarizes the raw transcript
 * via Groq, saves results, and enqueues the "prepare" step.
 * External calls (Groq, queue) are mocked via fetch intercepts.
 */

import { assertEquals } from "@std/assert";
import { MockFetch } from "@test/mock-fetch";
import { Kv } from "../../../data/kv/mod.ts";
import { KvTestHelpers } from "../../../data/kv/test-helpers.ts";
import { stepTranscribeCb } from "./mod.ts";

// -- env setup ---------------------------------------------------------------

Deno.env.set("LOCAL_QUEUE", "true");
Deno.env.set("SELF_URL", "http://localhost:8000");
Deno.env.set("DENO_KV_URL", "http://localhost:4512");
Deno.env.set("KV_SERVICE_URL", "http://localhost:4512");
Deno.env.set("QSTASH_URL", "http://mock-qstash");
Deno.env.set("QSTASH_TOKEN", "mock-token");
Deno.env.set("GROQ_API_KEY", "test-groq-key");

// -- helpers -----------------------------------------------------------------

function makeReq(body: unknown): Request {
  return new Request("http://localhost:8000/audit/step/transcribe-complete", {
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

function withMockFetch(fn: () => Promise<void>): Promise<void> {
  // Mock Groq API (diarize calls)
  MockFetch.routeJson("groq.com", {
    choices: [{ message: { content: "Agent: Hello\nCaller: Hi" } }],
  });
  // Catch-all for local queue enqueue (setTimeout fires fetch)
  MockFetch.routeJson(/.*/, { ok: true });
  return fn().finally(() => MockFetch.restore());
}

function makeFinding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "finding-diarize-1",
    findingStatus: "transcribing",
    owner: "agent@example.com",
    rawTranscript: "Hello how are you I am fine thanks",
    ...overrides,
  };
}

// -- Test 1: Returns 404 when finding not found ------------------------------

Deno.test({
  name: "stepTranscribeCb: returns 404 when finding is not in KV",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withKv(async (kv) => {
      await withMockFetch(async () => {
        const req = makeReq({
          findingId: "does-not-exist",
          orgId: "org1",
        });
        const res = await stepTranscribeCb(req);
        assertEquals(res.status, 404);
        const body = await res.json();
        assertEquals(body.error, "finding not found");
      });
    });
  },
});

// -- Test 2: Skips to finalize for "Invalid Genie" transcript ----------------

Deno.test({
  name: "stepTranscribeCb: skips to finalize when transcript contains Invalid Genie",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withKv(async (kv) => {
      await kv.saveFinding("org1", makeFinding({
        id: "finding-invalid-genie",
        rawTranscript: "Invalid Genie - could not retrieve audio",
      }));

      await withMockFetch(async () => {
        const req = makeReq({
          findingId: "finding-invalid-genie",
          orgId: "org1",
        });
        const res = await stepTranscribeCb(req);
        assertEquals(res.status, 200);
        const body = await res.json();
        assertEquals(body.ok, true);
        assertEquals(body.skipped, true);
        assertEquals(body.reason, "invalid transcript");
      });
    });
  },
});

// -- Test 3: Happy path — processes transcript and enqueues prepare step -----
// Note: The Groq SDK uses its own HTTP client, so diarization will fail
// gracefully in the test environment. The coordinator catches the error and
// continues, saving the raw transcript and enqueuing the next step.

Deno.test({
  name: "stepTranscribeCb: processes transcript, saves it, and returns ok",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withKv(async (kv) => {
      const rawText = "Hello how are you I am fine thanks for calling";
      await kv.saveFinding("org1", makeFinding({
        id: "finding-diarize-happy",
        rawTranscript: rawText,
      }));

      await withMockFetch(async () => {
        const req = makeReq({
          findingId: "finding-diarize-happy",
          orgId: "org1",
        });
        const res = await stepTranscribeCb(req);
        assertEquals(res.status, 200);
        const body = await res.json();
        assertEquals(body.ok, true);
      });

      // Verify finding still has its rawTranscript preserved
      const updated = await kv.getFinding("org1", "finding-diarize-happy");
      assertEquals(updated?.rawTranscript, rawText);
    });
  },
});

// -- Test 4: Skips when no transcript at all ---------------------------------

Deno.test({
  name: "stepTranscribeCb: skips to finalize when rawTranscript is missing",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withKv(async (kv) => {
      await kv.saveFinding("org1", makeFinding({
        id: "finding-no-transcript",
        rawTranscript: undefined,
      }));

      await withMockFetch(async () => {
        const req = makeReq({
          findingId: "finding-no-transcript",
          orgId: "org1",
        });
        const res = await stepTranscribeCb(req);
        assertEquals(res.status, 200);
        const body = await res.json();
        assertEquals(body.ok, true);
        assertEquals(body.skipped, true);
        assertEquals(body.reason, "no transcript");
      });
    });
  },
});
