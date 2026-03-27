/**
 * Characterization tests for stepFinalize.
 * These lock in current behavior before any refactoring.
 *
 * Strategy:
 * - Use freshKv + setKvInstance so all KV reads/writes hit in-memory storage.
 * - Seed finding data via saveFinding (same key structure getFinding expects).
 * - Mock fetch for all outbound HTTP (Deno KV service, cleanup queue, webhook).
 * - Avoid generateFeedback by pre-seeding finding.feedback or using all-Yes answers.
 */

import { assertEquals } from "@std/assert";
import { mockFetch, mockFetchJson, restoreFetch } from "../../../data/mock-fetch.ts";
import { freshKv } from "../../../data/kv/test-helpers.ts";
import { setKvInstance, resetKvInstance } from "../../../data/kv/factory.ts";
import { saveFinding } from "../../../data/kv/mod.ts";
import { stepFinalize } from "./mod.ts";

// -- env setup (must be before module evaluation) ----------------------

Deno.env.set("LOCAL_QUEUE", "true");
Deno.env.set("SELF_URL", "http://localhost:8000");
Deno.env.set("DENO_KV_URL", "http://localhost:4512");
Deno.env.set("KV_SERVICE_URL", "http://localhost:4512");
Deno.env.set("ALERT_EMAIL", "test@test.com");
Deno.env.set("FROM_EMAIL", "test@test.com");
Deno.env.set("GROQ_API_KEY", "test-key");
Deno.env.set("QSTASH_URL", "http://localhost:9999");
Deno.env.set("QSTASH_TOKEN", "test-token");

// -- helpers -----------------------------------------------------------

function makeReq(body: unknown): Request {
  return new Request("http://localhost:8000/audit/step/finalize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Install a catch-all mock + specific route, run fn, then restore. */
function withMockFetch(fn: () => Promise<void>): Promise<void> {
  // Deno KV service calls
  mockFetchJson("localhost:4512", { ok: true });
  // Catch-all for cleanup queue (LOCAL_QUEUE fires via setTimeout), etc.
  mockFetchJson(/.*/, { ok: true });
  return fn().finally(() => restoreFetch());
}

async function withKv<T>(fn: (kv: Deno.Kv) => Promise<T>): Promise<T> {
  const kv = await freshKv();
  setKvInstance(kv);
  try {
    return await fn(kv);
  } finally {
    resetKvInstance();
    kv.close();
  }
}

/** Build a minimal answered question. */
function makeAnsweredQuestion(answer: "Yes" | "No", populated = "Did the agent greet?") {
  return {
    header: "Greeting",
    unpopulated: "Did the agent greet?",
    populated,
    autoYesExp: "",
    astResults: {},
    autoYesVal: false,
    autoYesMsg: "",
    answer,
    thinking: "test thinking",
    defense: "test defense",
  };
}

/** Minimal finding fixture. Pre-populated with answeredQuestions to skip batch fetch. */
function makeFinding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "finding-test-1",
    auditJobId: "job-test-1",
    findingStatus: "asking-questions",
    recordingId: "rec-001",
    owner: "agent@example.com",
    updateEndpoint: "none",
    feedback: null,
    rawTranscript: "Hello caller, how can I help you today?",
    populatedQuestions: [],
    answeredQuestions: [],
    record: { RecordId: "1" },
    recordingIdField: "RecordId",
    ...overrides,
  };
}

// =====================================================================
// Test 1: Returns 404 when finding not found
// =====================================================================

Deno.test("stepFinalize: returns 404 when finding is not in KV", async () => {
  await withKv(async () => {
    await withMockFetch(async () => {
      const req = makeReq({
        findingId: "does-not-exist",
        orgId: "org1",
        totalBatches: 0,
      });
      const res = await stepFinalize(req);
      assertEquals(res.status, 404);
      const body = await res.json();
      assertEquals(body.error, "finding not found");
    });
  });
});

// =====================================================================
// Test 2: Normal audit with "No" answers routes to review queue
//         and returns correct yes/no counts
// =====================================================================

Deno.test({ name: "stepFinalize: normal audit with No answers returns correct counts", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  await withKv(async (kv) => {
    // Seed the finding
    const finding = makeFinding({
      id: "finding-normal-1",
      // Pre-set feedback so generateFeedback (Groq) is NOT called
      feedback: {
        heading: "Audit Feedback",
        text: "Pre-set feedback for test.",
        viewUrl: "http://localhost:4512/get?id=finding-normal-1",
        disputeUrl: "http://localhost:8000/audit/appeal?findingId=finding-normal-1",
        recordingUrl: "http://localhost:8000/audit/recording?id=finding-normal-1",
      },
      answeredQuestions: [
        makeAnsweredQuestion("Yes"),
        makeAnsweredQuestion("No", "Did the agent close the call properly?"),
        makeAnsweredQuestion("No", "Did the agent verify the account?"),
      ],
    });
    await saveFinding("org1" as any, finding);

    await withMockFetch(async () => {
      const req = makeReq({
        findingId: "finding-normal-1",
        orgId: "org1",
        totalBatches: 0,
      });
      const res = await stepFinalize(req);
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.ok, true);
      assertEquals(body.yeses, 1);
      assertEquals(body.nos, 2);
    });
  });
}});

// =====================================================================
// Test 3: Invalid recording marks all questions as "No"
// =====================================================================

Deno.test({ name: "stepFinalize: invalid recording sets all questions to No", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  await withKv(async () => {
    const finding = makeFinding({
      id: "finding-invalid-1",
      rawTranscript: "Invalid Genie - could not retrieve audio",
      // populatedQuestions needed so the invalid branch fills answeredQuestions
      populatedQuestions: [
        {
          header: "Greeting",
          unpopulated: "Did the agent greet?",
          populated: "Did the agent greet?",
          autoYesExp: "",
          astResults: {},
          autoYesVal: false,
          autoYesMsg: "",
        },
        {
          header: "Close",
          unpopulated: "Did the agent close?",
          populated: "Did the agent close?",
          autoYesExp: "",
          astResults: {},
          autoYesVal: false,
          autoYesMsg: "",
        },
      ],
      // No pre-existing answeredQuestions — the invalid branch will set them
      answeredQuestions: [],
    });
    await saveFinding("org1" as any, finding);

    await withMockFetch(async () => {
      const req = makeReq({
        findingId: "finding-invalid-1",
        orgId: "org1",
        totalBatches: 0,
      });
      const res = await stepFinalize(req);
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.ok, true);
      // Both questions should be "No" due to invalid recording
      assertEquals(body.nos, 2);
      assertEquals(body.yeses, 0);
    });
  });
}});

// =====================================================================
// Test 4: Returns correct response shape { ok: true, yeses: N, nos: M }
//         with all-Yes answers (no review queue entries, no generateFeedback)
// =====================================================================

Deno.test({ name: "stepFinalize: all-Yes answers return { ok: true, yeses: 3, nos: 0 }", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  await withKv(async () => {
    const finding = makeFinding({
      id: "finding-all-yes-1",
      answeredQuestions: [
        makeAnsweredQuestion("Yes"),
        makeAnsweredQuestion("Yes", "Did the agent verify?"),
        makeAnsweredQuestion("Yes", "Did the agent close?"),
      ],
      // No feedback + no "No" answers → failedQs is empty → generateFeedback is not called
    });
    await saveFinding("org1" as any, finding);

    await withMockFetch(async () => {
      const req = makeReq({
        findingId: "finding-all-yes-1",
        orgId: "org1",
        totalBatches: 0,
      });
      const res = await stepFinalize(req);
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.ok, true);
      assertEquals(body.yeses, 3);
      assertEquals(body.nos, 0);
    });
  });
}});
