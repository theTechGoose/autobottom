/**
 * Integration tests for genie/mod.ts.
 * Mocks fetch calls to the Genie recording API and verifies correct
 * URL construction, auth headers, and response handling.
 *
 * Note: The module has internal retry logic (up to 5 retries with 2s delay).
 * Tests return valid responses on the first attempt to avoid retry delays.
 */

import { assertEquals } from "@std/assert";
import { mockFetch, restoreFetch } from "../mock-fetch.ts";
import { getRecordingUrl, downloadRecording } from "./mod.ts";

// Required env vars (must be set before import resolves env.ts lazy getters)
Deno.env.set("GENIE_AUTH", "test-bearer-primary");
Deno.env.set("GENIE_AUTH_TWO", "test-bearer-secondary");
Deno.env.set("GENIE_BASE_URL", "https://mock-genie.example.com");
Deno.env.set("GENIE_PRIMARY_ACCOUNT", "111");
Deno.env.set("GENIE_SECONDARY_ACCOUNT", "222");
// Other required env vars that env.ts may need at import time
Deno.env.set("SELF_URL", "http://localhost:8000");
Deno.env.set("QSTASH_URL", "http://mock-qstash");
Deno.env.set("QSTASH_TOKEN", "mock-token");
Deno.env.set("AWS_ACCESS_KEY_ID", "test-key");
Deno.env.set("AWS_SECRET_ACCESS_KEY", "test-secret");
Deno.env.set("S3_BUCKET", "test-bucket");
Deno.env.set("POSTMARK_SERVER", "test-postmark");
Deno.env.set("FROM_EMAIL", "test@example.com");
Deno.env.set("ALERT_EMAIL", "test@example.com");
Deno.env.set("KV_SERVICE_URL", "http://localhost:4512");
Deno.env.set("DENO_KV_URL", "http://localhost:4512");
Deno.env.set("GROQ_API_KEY", "test-groq");
Deno.env.set("OPEN_AI_KEY", "test-openai");
Deno.env.set("PINECONE_DB_KEY", "test-pinecone");
Deno.env.set("PINECONE_INDEX", "test-index");
Deno.env.set("ASSEMBLYAI_API_KEY", "test-assemblyai");
Deno.env.set("QB_REALM", "test-realm");
Deno.env.set("QB_USER_TOKEN", "test-qb-token");

// ---------------------------------------------------------------------------
// getRecordingUrl — returns URL from primary account
// ---------------------------------------------------------------------------

Deno.test("getRecordingUrl — returns recording URL from primary account on first attempt", async () => {
  let capturedUrl = "";
  let capturedHeaders: Headers | undefined;

  mockFetch("mock-genie.example.com/api/v1/111/judge_search.wr", (url, init) => {
    capturedUrl = url as string;
    capturedHeaders = new Headers(init?.headers as HeadersInit);
    return new Response(
      JSON.stringify({
        data: [
          { contract: "12345", src: "https://mock-genie.example.com/recording/abc.mp3" },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });

  try {
    const result = await getRecordingUrl(12345);

    assertEquals(capturedUrl.includes("filter_contract=12345"), true);
    assertEquals(capturedHeaders?.get("Authorization"), "Bearer test-bearer-primary");
    assertEquals(result, "https://mock-genie.example.com/recording/abc.mp3");
  } finally {
    restoreFetch();
  }
});

// ---------------------------------------------------------------------------
// getRecordingUrl — falls back to secondary account
// ---------------------------------------------------------------------------

Deno.test("getRecordingUrl — falls back to secondary when primary returns no data", async () => {
  let secondaryCalled = false;

  mockFetch("mock-genie.example.com/api/v1/111/judge_search.wr", () => {
    return new Response(
      JSON.stringify({ data: [] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });

  mockFetch("mock-genie.example.com/api/v1/222/judge_search.wr", (_url, init) => {
    secondaryCalled = true;
    const headers = new Headers(init?.headers as HeadersInit);
    assertEquals(headers.get("Authorization"), "Bearer test-bearer-secondary");
    return new Response(
      JSON.stringify({
        data: [
          { contract: "99", src: "https://mock-genie.example.com/recording/secondary.mp3" },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });

  try {
    const result = await getRecordingUrl(99);
    assertEquals(secondaryCalled, true);
    assertEquals(result, "https://mock-genie.example.com/recording/secondary.mp3");
  } finally {
    restoreFetch();
  }
});

// ---------------------------------------------------------------------------
// getRecordingUrl — returns null when both accounts fail
// ---------------------------------------------------------------------------

Deno.test({
  name: "getRecordingUrl — returns null when both accounts have no data",
  // Retries internally (5 attempts per account), so sanitizers may see lingering ops
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    mockFetch("mock-genie.example.com", () => {
      return new Response(
        JSON.stringify({ data: [] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    try {
      const result = await getRecordingUrl(0);
      assertEquals(result, null);
    } finally {
      restoreFetch();
    }
  },
});

// ---------------------------------------------------------------------------
// downloadRecording — downloads bytes from primary account
// ---------------------------------------------------------------------------

Deno.test("downloadRecording — returns audio bytes from primary account", async () => {
  // Create a payload larger than 1024 bytes (the minimum the module enforces)
  const audioBytes = new Uint8Array(2048).fill(0xFF);

  // Mock the search endpoint to return a recording URL
  mockFetch("mock-genie.example.com/api/v1/111/judge_search.wr", () => {
    return new Response(
      JSON.stringify({
        data: [
          { contract: "555", src: "https://mock-genie.example.com/recording/555.mp3" },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });

  // Mock the download endpoint
  mockFetch("mock-genie.example.com/recording/555.mp3", () => {
    return new Response(audioBytes, { status: 200 });
  });

  try {
    const result = await downloadRecording(555);
    assertEquals(result instanceof Uint8Array, true);
    assertEquals(result!.byteLength, 2048);
  } finally {
    restoreFetch();
  }
});
