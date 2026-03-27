/** Integration tests for judge handlers (moved from coordinators/judge/handlers_test.ts) */

import { assertEquals } from "@std/assert";
import { setKvInstance, resetKvInstance } from "../domain/data/kv/factory.ts";
import { mockFetchJson, restoreFetch } from "../domain/data/mock-fetch.ts";
import { createOrg, createUser, createSession } from "../domain/coordinators/auth/mod.ts";
import { handleNext, handleStats } from "./judge.ts";
import { populateJudgeQueue } from "../domain/coordinators/judge/mod.ts";

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

function authedRequest(token: string, url = "http://localhost:8000/judge"): Request {
  return new Request(url, {
    headers: { cookie: `session=${token}` },
  });
}

function unauthRequest(url = "http://localhost:8000/judge"): Request {
  return new Request(url);
}

function makeQuestion(answer: string, header = "Q") {
  return { answer, header, populated: "pop", thinking: "think", defense: "def" };
}

// -- Test 1: handleNext returns 401 when unauthenticated --

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

// -- Test 4: handleNext returns item from queue when items exist --

Deno.test(
  "handleNext: returns judge item from queue",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withKv(async () => {
      mockFetchJson(/.*/, {});
      const orgId = await createOrg("Judge Org 2", "judgeadmin2@test.com");
      await createUser(orgId, "judge2@test.com", "pass123", "judge");
      const token = await createSession({ email: "judge2@test.com", orgId, role: "judge" });

      await populateJudgeQueue(orgId, "appeal-001", [
        makeQuestion("Yes", "Did agent follow script?"),
        makeQuestion("No", "Did agent verify identity?"),
      ]);

      const req = authedRequest(token, "http://localhost:8000/judge/next");
      const res = await handleNext(req);
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(typeof body, "object");
      // current should be one of the queued items
      assertEquals(body.current !== undefined, true);
      assertEquals(body.current !== null, true);
      assertEquals(body.current.findingId, "appeal-001");
    });
  },
);

// -- Test 5: handleNext returns null current when queue is empty --

Deno.test(
  "handleNext: returns null current when judge queue is empty",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withKv(async () => {
      mockFetchJson(/.*/, {});
      const orgId = await createOrg("Judge Org 3", "judgeadmin3@test.com");
      await createUser(orgId, "judge3@test.com", "pass123", "judge");
      const token = await createSession({ email: "judge3@test.com", orgId, role: "judge" });

      const req = authedRequest(token, "http://localhost:8000/judge/next");
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
      const orgId = await createOrg("Judge Stats Org", "judgestatsadmin@test.com");
      await createUser(orgId, "judgestats@test.com", "pass123", "judge");
      const token = await createSession({ email: "judgestats@test.com", orgId, role: "judge" });

      await populateJudgeQueue(orgId, "appeal-stats-1", [
        makeQuestion("Yes", "Q1"),
        makeQuestion("No", "Q2"),
      ]);

      const req = authedRequest(token, "http://localhost:8000/judge/stats");
      const res = await handleStats(req);
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(typeof body.pending, "number");
      assertEquals(typeof body.decided, "number");
      assertEquals(body.pending, 2);
      assertEquals(body.decided, 0);
    });
  },
);
