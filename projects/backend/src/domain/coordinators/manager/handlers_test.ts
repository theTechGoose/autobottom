/** Integration tests for manager/handlers.ts */

import { assertEquals } from "@std/assert";
import { setKvInstance, resetKvInstance } from "../../../../kv-factory.ts";
import { mockFetchJson, restoreFetch } from "../../../../test-utils/mod.ts";
import { createOrg, createUser, createSession } from "../auth/mod.ts";
import { handleManagerPage, handleManagerQueueList } from "./handlers.ts";
import { orgKey } from "../../../../lib/org.ts";
import type { ManagerQueueItem } from "./mod.ts";

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

function authedRequest(token: string, url = "http://localhost:8000/manager"): Request {
  return new Request(url, {
    headers: { cookie: `session=${token}` },
  });
}

function unauthRequest(url = "http://localhost:8000/manager"): Request {
  return new Request(url);
}

/** Seed a ManagerQueueItem directly into KV. */
async function seedManagerQueueItem(kv: Deno.Kv, orgId: string, item: ManagerQueueItem): Promise<void> {
  await kv.set(orgKey(orgId, "manager-queue", item.findingId), item);
}

function makeQueueItem(findingId: string): ManagerQueueItem {
  return {
    findingId,
    owner: "agent@test.com",
    recordId: "rec-001",
    recordingId: "recording-001",
    totalQuestions: 5,
    failedCount: 2,
    completedAt: Date.now(),
    jobTimestamp: "2026-01-01T00:00:00Z",
    status: "pending",
  };
}

// -- Test 1: handleManagerPage returns 200 with HTML --

Deno.test(
  "handleManagerPage: returns 200 with HTML content type",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withKv(async () => {
      mockFetchJson(/.*/, {});
      const req = unauthRequest();
      const res = await handleManagerPage(req);
      assertEquals(res.status, 200);
      assertEquals(res.headers.get("content-type"), "text/html; charset=utf-8");
    });
  },
);

// -- Test 2: handleManagerQueueList returns 401 when unauthenticated --

Deno.test(
  "handleManagerQueueList: unauthenticated request returns 401",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withKv(async () => {
      mockFetchJson(/.*/, {});
      const req = unauthRequest();
      const res = await handleManagerQueueList(req);
      assertEquals(res.status, 401);
      const body = await res.json();
      assertEquals(body.error, "unauthorized");
    });
  },
);

// -- Test 3: handleManagerQueueList returns empty array when queue is empty --

Deno.test(
  "handleManagerQueueList: returns empty array when queue is empty",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withKv(async () => {
      mockFetchJson(/.*/, {});
      const orgId = await createOrg("Manager Org", "mgradmin@test.com");
      await createUser(orgId, "manager@test.com", "pass123", "manager");
      const token = await createSession({ email: "manager@test.com", orgId, role: "manager" });

      const req = authedRequest(token, "http://localhost:8000/manager/queue");
      const res = await handleManagerQueueList(req);
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(Array.isArray(body), true);
      assertEquals(body.length, 0);
    });
  },
);

// -- Test 4: handleManagerQueueList returns seeded items --

Deno.test(
  "handleManagerQueueList: returns queue items JSON",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withKv(async (kv) => {
      mockFetchJson(/.*/, {});
      const orgId = await createOrg("Manager Org 2", "mgradmin2@test.com");
      await createUser(orgId, "manager2@test.com", "pass123", "manager");
      const token = await createSession({ email: "manager2@test.com", orgId, role: "manager" });

      await seedManagerQueueItem(kv, orgId, makeQueueItem("finding-mgr-001"));
      await seedManagerQueueItem(kv, orgId, makeQueueItem("finding-mgr-002"));

      const req = authedRequest(token, "http://localhost:8000/manager/queue");
      const res = await handleManagerQueueList(req);
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(Array.isArray(body), true);
      assertEquals(body.length, 2);
      // Each item should have expected fields
      const ids = body.map((i: ManagerQueueItem) => i.findingId).sort();
      assertEquals(ids, ["finding-mgr-001", "finding-mgr-002"]);
    });
  },
);

// -- Test 5: handleManagerQueueList response is JSON content type --

Deno.test(
  "handleManagerQueueList: response has JSON content type",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withKv(async () => {
      mockFetchJson(/.*/, {});
      const orgId = await createOrg("Manager Org 3", "mgradmin3@test.com");
      await createUser(orgId, "manager3@test.com", "pass123", "manager");
      const token = await createSession({ email: "manager3@test.com", orgId, role: "manager" });

      const req = authedRequest(token, "http://localhost:8000/manager/queue");
      const res = await handleManagerQueueList(req);
      assertEquals(res.status, 200);
      assertEquals(res.headers.get("content-type"), "application/json");
    });
  },
);
