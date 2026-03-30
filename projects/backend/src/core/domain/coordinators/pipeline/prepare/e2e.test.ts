/**
 * E2E tests for stepPrepare coordinator.
 *
 * stepPrepare reads a finding from KV, fetches questions (QuickBase or cache),
 * populates them with record data, embeds transcript in Pinecone, and fans out
 * question batches. External calls (QuickBase, Pinecone, queue) are mocked.
 */

import { assertEquals } from "@std/assert";
import { MockFetch } from "@test/mock-fetch";
import { Kv } from "../../../data/kv/mod.ts";
import { KvTestHelpers } from "../../../data/kv/test-helpers.ts";
import { stepPrepare } from "./mod.ts";

// -- env setup ---------------------------------------------------------------

Deno.env.set("LOCAL_QUEUE", "true");
Deno.env.set("SELF_URL", "http://localhost:8000");
Deno.env.set("DENO_KV_URL", "http://localhost:4512");
Deno.env.set("KV_SERVICE_URL", "http://localhost:4512");
Deno.env.set("QSTASH_URL", "http://mock-qstash");
Deno.env.set("QSTASH_TOKEN", "mock-token");
Deno.env.set("PINECONE_DB_KEY", "test-pinecone-key");
Deno.env.set("PINECONE_INDEX", "test-index");
Deno.env.set("OPEN_AI_KEY", "test-openai-key");
Deno.env.set("QB_REALM", "test-realm");
Deno.env.set("QB_USER_TOKEN", "test-qb-token");

// -- helpers -----------------------------------------------------------------

function makeReq(body: unknown): Request {
  return new Request("http://localhost:8000/audit/step/prepare", {
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
  // Mock Pinecone index describe
  MockFetch.routeJson("api.pinecone.io", { host: "test-index.svc.pinecone.io" });
  // Mock Pinecone upsert
  MockFetch.routeJson(/pinecone\.io\/vectors/, { upsertedCount: 1 });
  // Mock Pinecone describe_index_stats
  MockFetch.routeJson(/pinecone\.io\/describe/, { namespaces: {} });
  // Mock QuickBase questions query
  MockFetch.routeJson("api.quickbase.com", { data: [] });
  // Catch-all for local queue enqueue
  MockFetch.routeJson(/.*/, { ok: true });
  return fn().finally(() => MockFetch.restore());
}

function makeFinding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "finding-prepare-1",
    findingStatus: "transcribing",
    owner: "agent@example.com",
    rawTranscript: "Hello caller, how can I help you today?",
    record: { RecordId: "rec-001", RelatedDestinationId: "dest-1" },
    ...overrides,
  };
}

// -- Test 1: Returns 404 when finding not found ------------------------------

Deno.test({
  name: "stepPrepare: returns 404 when finding is not in KV",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withKv(async (kv) => {
      await withMockFetch(async () => {
        const req = makeReq({
          findingId: "does-not-exist",
          orgId: "org1",
        });
        const res = await stepPrepare(req);
        assertEquals(res.status, 404);
        const body = await res.json();
        assertEquals(body.error, "finding not found");
      });
    });
  },
});

// -- Test 2: Skips to finalize for "Invalid Genie" transcript ----------------

Deno.test({
  name: "stepPrepare: skips to finalize when transcript contains Invalid Genie",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withKv(async (kv) => {
      await kv.saveFinding("org1", makeFinding({
        id: "finding-invalid-prep",
        rawTranscript: "Invalid Genie - could not retrieve audio",
      }));

      await withMockFetch(async () => {
        const req = makeReq({
          findingId: "finding-invalid-prep",
          orgId: "org1",
        });
        const res = await stepPrepare(req);
        assertEquals(res.status, 200);
        const body = await res.json();
        assertEquals(body.ok, true);
        assertEquals(body.skipped, true);
      });
    });
  },
});

// -- Test 3: Returns 0 batches when no questions available -------------------

Deno.test({
  name: "stepPrepare: returns 0 batches when no questions are available",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withKv(async (kv) => {
      await kv.saveFinding("org1", makeFinding({
        id: "finding-no-questions",
        record: { RecordId: "rec-001", RelatedDestinationId: "" },
      }));

      await withMockFetch(async () => {
        const req = makeReq({
          findingId: "finding-no-questions",
          orgId: "org1",
        });
        const res = await stepPrepare(req);
        assertEquals(res.status, 200);
        const body = await res.json();
        assertEquals(body.ok, true);
        assertEquals(body.batches, 0);
      });
    });
  },
});

// -- Test 4: Uses cached questions and fans out correct batch count -----------

Deno.test({
  name: "stepPrepare: uses cached questions and creates correct number of batches",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withKv(async (kv) => {
      await kv.saveFinding("org1", makeFinding({
        id: "finding-cached-qs",
        record: { RecordId: "rec-001", RelatedDestinationId: "dest-cached" },
      }));

      // Pre-cache 7 questions for the destination
      const cachedQuestions = Array.from({ length: 7 }, (_, i) => ({
        header: `Q${i}`,
        unpopulated: `Question ${i}?`,
        populated: `Question ${i}?`,
        autoYesExp: "",
      }));
      await kv.cacheQuestions("org1", "dest-cached", cachedQuestions);

      await withMockFetch(async () => {
        const req = makeReq({
          findingId: "finding-cached-qs",
          orgId: "org1",
        });
        const res = await stepPrepare(req);
        assertEquals(res.status, 200);
        const body = await res.json();
        assertEquals(body.ok, true);
        // 7 questions / 5 per batch = 2 batches
        assertEquals(body.batches, 2);
      });

      // Verify finding was updated with populated questions
      const updated = await kv.getFinding("org1", "finding-cached-qs");
      assertEquals(updated?.findingStatus, "asking-questions");
      assertEquals(updated?.populatedQuestions?.length, 7);
    });
  },
});
