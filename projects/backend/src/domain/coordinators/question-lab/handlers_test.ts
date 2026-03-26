/** Integration tests for question-lab/handlers.ts */

import { assertEquals } from "@std/assert";
import { setKvInstance, resetKvInstance } from "../../../../kv-factory.ts";
import { mockFetchJson, restoreFetch } from "../../../../test-utils/mod.ts";
import { createOrg, createUser, createSession } from "../auth/mod.ts";
import { routeQuestionLab } from "./handlers.ts";

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

function authedRequest(token: string, url: string, method = "GET"): Request {
  return new Request(url, {
    method,
    headers: { cookie: `session=${token}` },
  });
}

function unauthRequest(url: string, method = "GET"): Request {
  return new Request(url, { method });
}

// -- Test 1: router returns 404 for unknown path --

Deno.test(
  "routeQuestionLab: returns 404 for unknown path",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withKv(async () => {
      mockFetchJson(/.*/, {});
      const req = unauthRequest("http://localhost:8000/question-lab/does-not-exist");
      const res = await routeQuestionLab(req);
      assertEquals(res.status, 404);
      const body = await res.json();
      assertEquals(body.error, "not found");
    });
  },
);

// -- Test 2: router returns 404 for mismatched method on known path --

Deno.test(
  "routeQuestionLab: returns 404 for wrong HTTP method on known path",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withKv(async () => {
      mockFetchJson(/.*/, {});
      // /question-lab/api/configs is GET-only; DELETE is not registered
      const req = unauthRequest("http://localhost:8000/question-lab/api/configs", "DELETE");
      const res = await routeQuestionLab(req);
      assertEquals(res.status, 404);
      const body = await res.json();
      assertEquals(body.error, "not found");
    });
  },
);

// -- Test 3: unauthenticated GET /question-lab/api/configs returns 401 --

Deno.test(
  "routeQuestionLab: unauthenticated GET /api/configs returns 401",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withKv(async () => {
      mockFetchJson(/.*/, {});
      const req = unauthRequest("http://localhost:8000/question-lab/api/configs");
      const res = await routeQuestionLab(req);
      assertEquals(res.status, 401);
      const body = await res.json();
      assertEquals(body.error, "unauthorized");
    });
  },
);

// -- Test 4: authenticated GET /api/configs returns JSON array --

Deno.test(
  "routeQuestionLab: authenticated GET /api/configs returns JSON array",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withKv(async () => {
      mockFetchJson(/.*/, {});
      const orgId = await createOrg("QLab Org", "qlabadmin@test.com");
      await createUser(orgId, "qlab@test.com", "pass123", "reviewer");
      const token = await createSession({ email: "qlab@test.com", orgId, role: "reviewer" });

      const req = authedRequest(token, "http://localhost:8000/question-lab/api/configs");
      const res = await routeQuestionLab(req);
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(Array.isArray(body), true);
    });
  },
);

// -- Test 5: POST /api/configs creates a config and returns it --

Deno.test(
  "routeQuestionLab: POST /api/configs creates a config",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withKv(async () => {
      mockFetchJson(/.*/, {});
      const orgId = await createOrg("QLab Org 2", "qlabadmin2@test.com");
      await createUser(orgId, "qlab2@test.com", "pass123", "reviewer");
      const token = await createSession({ email: "qlab2@test.com", orgId, role: "reviewer" });

      const req = new Request("http://localhost:8000/question-lab/api/configs", {
        method: "POST",
        headers: {
          cookie: `session=${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "My Test Config" }),
      });
      const res = await routeQuestionLab(req);
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.name, "My Test Config");
      assertEquals(typeof body.id, "string");
    });
  },
);

// -- Test 6: unauthenticated POST /api/configs returns 401 --

Deno.test(
  "routeQuestionLab: unauthenticated POST /api/configs returns 401",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withKv(async () => {
      mockFetchJson(/.*/, {});
      const req = new Request("http://localhost:8000/question-lab/api/configs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "should fail" }),
      });
      const res = await routeQuestionLab(req);
      assertEquals(res.status, 401);
      const body = await res.json();
      assertEquals(body.error, "unauthorized");
    });
  },
);
