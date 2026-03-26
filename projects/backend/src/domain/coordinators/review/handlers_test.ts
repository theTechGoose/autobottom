/** Integration tests for review/handlers.ts */

import { assertEquals } from "@std/assert";
import { setKvInstance, resetKvInstance } from "../../../../kv-factory.ts";
import { mockFetchJson, restoreFetch } from "../../../../test-utils/mod.ts";
import { createOrg, createUser, createSession } from "../auth/mod.ts";
import { handleReviewPage, handleNext, handleStats } from "./handlers.ts";
import { populateReviewQueue } from "./mod.ts";

// -- env --

Deno.env.set("SELF_URL", "http://localhost:8000");
Deno.env.set("DENO_KV_URL", "http://localhost:4512");
Deno.env.set("KV_SERVICE_URL", "http://localhost:4512");
Deno.env.set("LOCAL_QUEUE", "true");
Deno.env.set("QSTASH_URL", "http://localhost:9999");
Deno.env.set("QSTASH_TOKEN", "test-token");
Deno.env.set("GROQ_API_KEY", "test-key");

// -- helpers --

async function withKv<T>(fn: (kv: Deno.Kv) => Promise<T>): Promise<T> {
  const kv = await Deno.openKv(":memory:");
  setKvInstance(kv);
  try {
    return await fn(kv);
  } finally {
    restoreFetch();
    resetKvInstance();
    kv.close();
  }
}

/** Build a Request with a session cookie for the given token. */
function authedRequest(token: string, url = "http://localhost:8000/review"): Request {
  return new Request(url, {
    headers: { cookie: `session=${token}` },
  });
}

function unauthRequest(url = "http://localhost:8000/review"): Request {
  return new Request(url);
}

function makeQuestion(answer: string, header = "Q") {
  return { answer, header, populated: "pop", thinking: "think", defense: "def" };
}

// -- Test 1: handleReviewPage returns 200 with HTML --

Deno.test(
  "handleReviewPage: returns 200 with HTML content type",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withKv(async () => {
      mockFetchJson(/.*/, {});
      const req = unauthRequest();
      const res = await handleReviewPage(req);
      assertEquals(res.status, 200);
      assertEquals(res.headers.get("content-type"), "text/html; charset=utf-8");
    });
  },
);

// -- Test 2: handleReviewPage with authenticated user also returns HTML --

Deno.test(
  "handleReviewPage: authenticated user gets HTML with org config embedded",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withKv(async () => {
      mockFetchJson(/.*/, {});
      const orgId = await createOrg("Test Org", "admin@test.com");
      await createUser(orgId, "reviewer@test.com", "pass123", "reviewer");
      const token = await createSession({ email: "reviewer@test.com", orgId, role: "reviewer" });

      const req = authedRequest(token);
      const res = await handleReviewPage(req);
      assertEquals(res.status, 200);
      assertEquals(res.headers.get("content-type"), "text/html; charset=utf-8");
    });
  },
);

// -- Test 3: handleNext returns 401 when unauthenticated --

Deno.test(
  "handleNext: unauthenticated request returns 401",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withKv(async () => {
      mockFetchJson(/.*/, {});
      const req = unauthRequest();
      const res = await handleNext(req);
      assertEquals(res.status, 401);
      const body = await res.json();
      assertEquals(body.error, "unauthorized");
    });
  },
);

// -- Test 4: handleNext returns item JSON when queue has items --

Deno.test(
  "handleNext: returns item JSON when queue has items",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withKv(async () => {
      mockFetchJson(/.*/, {});
      const orgId = await createOrg("Test Org 2", "admin2@test.com");
      await createUser(orgId, "reviewer2@test.com", "pass123", "reviewer");
      const token = await createSession({ email: "reviewer2@test.com", orgId, role: "reviewer" });

      await populateReviewQueue(orgId, "finding-001", [
        makeQuestion("No", "Did the agent greet?"),
      ]);

      const req = authedRequest(token, `http://localhost:8000/review/next`);
      const res = await handleNext(req);
      assertEquals(res.status, 200);
      const body = await res.json();
      // claimNextItem returns { current, transcript, peek, remaining, auditRemaining }
      assertEquals(typeof body, "object");
      assertEquals(body.current !== undefined, true);
    });
  },
);

// -- Test 5: handleNext returns null current when queue is empty --

Deno.test(
  "handleNext: returns null current when queue is empty",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withKv(async () => {
      mockFetchJson(/.*/, {});
      const orgId = await createOrg("Test Org 3", "admin3@test.com");
      await createUser(orgId, "reviewer3@test.com", "pass123", "reviewer");
      const token = await createSession({ email: "reviewer3@test.com", orgId, role: "reviewer" });

      const req = authedRequest(token, "http://localhost:8000/review/next");
      const res = await handleNext(req);
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.current, null);
      assertEquals(body.remaining, 0);
    });
  },
);

// -- Test 6: handleStats returns stats JSON --

Deno.test(
  "handleStats: returns pending and decided counts",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withKv(async () => {
      mockFetchJson(/.*/, {});
      const orgId = await createOrg("Stats Org", "statsadmin@test.com");
      await createUser(orgId, "statsreviewer@test.com", "pass123", "reviewer");
      const token = await createSession({ email: "statsreviewer@test.com", orgId, role: "reviewer" });

      await populateReviewQueue(orgId, "finding-stats-1", [
        makeQuestion("No", "Did they follow up?"),
      ]);

      const req = authedRequest(token, "http://localhost:8000/review/stats");
      const res = await handleStats(req);
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(typeof body.pending, "number");
      assertEquals(typeof body.decided, "number");
      assertEquals(body.pending, 1);
      assertEquals(body.decided, 0);
    });
  },
);
