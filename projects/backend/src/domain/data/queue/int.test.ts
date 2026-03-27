/**
 * Integration tests for queue/mod.ts.
 * Tests QStash enqueue behavior by mocking fetch and verifying correct
 * URL construction, headers, and request body formatting.
 *
 * Note: LOCAL_QUEUE mode uses setTimeout which fires asynchronously.
 * QStash mode is tested with mocked fetch.
 */

import { assertEquals } from "@std/assert";
import { assertRejects } from "@std/assert";
import { mockFetch, restoreFetch } from "../mock-fetch.ts";

// Required env vars — must be set BEFORE importing the module because
// queue/mod.ts reads LOCAL_QUEUE at module load time.
Deno.env.set("SELF_URL", "http://localhost:8000");
Deno.env.set("QSTASH_URL", "http://mock-qstash");
Deno.env.set("QSTASH_TOKEN", "mock-token");
Deno.env.set("KV_SERVICE_URL", "http://localhost:4512");
Deno.env.set("DENO_KV_URL", "http://localhost:4512");
Deno.env.set("AWS_ACCESS_KEY_ID", "test-key");
Deno.env.set("AWS_SECRET_ACCESS_KEY", "test-secret");
Deno.env.set("S3_BUCKET", "test-bucket");
Deno.env.set("POSTMARK_SERVER", "test-postmark");
Deno.env.set("FROM_EMAIL", "test@example.com");
Deno.env.set("ALERT_EMAIL", "test@example.com");
Deno.env.set("GROQ_API_KEY", "test-groq");
Deno.env.set("OPEN_AI_KEY", "test-openai");
Deno.env.set("PINECONE_DB_KEY", "test-pinecone");
Deno.env.set("PINECONE_INDEX", "test-index");
Deno.env.set("ASSEMBLYAI_API_KEY", "test-assemblyai");
Deno.env.set("QB_REALM", "test-realm");
Deno.env.set("QB_USER_TOKEN", "test-qb-token");
Deno.env.set("GENIE_AUTH", "test-genie");
Deno.env.set("GENIE_AUTH_TWO", "test-genie-two");
Deno.env.set("GENIE_BASE_URL", "https://mock-genie.example.com");
Deno.env.set("GENIE_PRIMARY_ACCOUNT", "111");
Deno.env.set("GENIE_SECONDARY_ACCOUNT", "222");

// Force QStash mode for these tests (not local mode)
Deno.env.set("LOCAL_QUEUE", "false");

// Dynamic import so LOCAL_QUEUE is read after we set it
const { enqueueStep, enqueueCleanup } = await import("./mod.ts");

// ---------------------------------------------------------------------------
// enqueueStep — sends to QStash enqueue endpoint (no delay)
// ---------------------------------------------------------------------------

Deno.test("enqueueStep — sends to QStash enqueue endpoint with correct headers", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;

  mockFetch("mock-qstash", (url, init) => {
    capturedUrl = url as string;
    capturedInit = init;
    return new Response(
      JSON.stringify({ messageId: "msg-123" }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });

  try {
    const messageId = await enqueueStep("transcribe", { findingId: "f1", org: "test" });

    assertEquals(
      capturedUrl,
      "http://mock-qstash/v2/enqueue/audit-pipeline/http://localhost:8000/audit/step/transcribe",
    );
    assertEquals(capturedInit?.method, "POST");

    const headers = capturedInit?.headers as Record<string, string>;
    assertEquals(headers["Authorization"], "Bearer mock-token");
    assertEquals(headers["Content-Type"], "application/json");
    assertEquals(headers["Upstash-Retries"], "0");

    const body = JSON.parse(capturedInit?.body as string);
    assertEquals(body.findingId, "f1");
    assertEquals(body.org, "test");
    assertEquals(messageId, "msg-123");
  } finally {
    restoreFetch();
  }
});

// ---------------------------------------------------------------------------
// enqueueStep — uses publish endpoint with delay header when delay is set
// ---------------------------------------------------------------------------

Deno.test("enqueueStep — uses publish endpoint with Upstash-Delay header when delayed", async () => {
  let capturedUrl = "";
  let capturedHeaders: Record<string, string> = {};

  mockFetch("mock-qstash", (url, init) => {
    capturedUrl = url as string;
    capturedHeaders = init?.headers as Record<string, string>;
    return new Response(
      JSON.stringify({ messageId: "msg-delayed" }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });

  try {
    await enqueueStep("review", { id: "r1" }, 30);

    assertEquals(
      capturedUrl,
      "http://mock-qstash/v2/publish/http://localhost:8000/audit/step/review",
    );
    assertEquals(capturedHeaders["Upstash-Delay"], "30s");
  } finally {
    restoreFetch();
  }
});

// ---------------------------------------------------------------------------
// enqueueCleanup — sends to cleanup queue
// ---------------------------------------------------------------------------

Deno.test("enqueueCleanup — sends to audit-cleanup queue with delay", async () => {
  let capturedUrl = "";
  let capturedHeaders: Record<string, string> = {};

  mockFetch("mock-qstash", (url, init) => {
    capturedUrl = url as string;
    capturedHeaders = init?.headers as Record<string, string>;
    return new Response(
      JSON.stringify({ messageId: "msg-cleanup" }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });

  try {
    await enqueueCleanup({ auditId: "a1" }, 60);

    // enqueueCleanup always has a delay, so it uses publish endpoint
    assertEquals(
      capturedUrl,
      "http://mock-qstash/v2/publish/http://localhost:8000/audit/step/cleanup",
    );
    assertEquals(capturedHeaders["Upstash-Delay"], "60s");
  } finally {
    restoreFetch();
  }
});

// ---------------------------------------------------------------------------
// enqueueStep — throws on QStash error response
// ---------------------------------------------------------------------------

Deno.test("enqueueStep — throws on non-ok QStash response", async () => {
  mockFetch("mock-qstash", () => {
    return new Response("Rate limited", { status: 429 });
  });

  try {
    await assertRejects(
      () => enqueueStep("transcribe", { id: "x" }),
      Error,
      "QStash enqueue failed: 429",
    );
  } finally {
    restoreFetch();
  }
});
