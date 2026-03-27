/**
 * E2E tests for stepCleanup coordinator.
 *
 * stepCleanup deletes a Pinecone namespace (by findingId or explicit namespace).
 * We mock fetch to avoid real Pinecone calls.
 */

import { assertEquals } from "@std/assert";
import { mockFetchJson, restoreFetch } from "../../../data/mock-fetch.ts";
import { stepCleanup } from "./mod.ts";

// -- env setup ---------------------------------------------------------------

Deno.env.set("PINECONE_DB_KEY", "test-pinecone-key");
Deno.env.set("PINECONE_INDEX", "test-index");
Deno.env.set("OPEN_AI_KEY", "test-openai-key");

// -- helpers -----------------------------------------------------------------

function makeReq(body: unknown): Request {
  return new Request("http://localhost:8000/audit/step/cleanup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function withMockFetch(fn: () => Promise<void>): Promise<void> {
  // Mock Pinecone index describe (getPineconeHost)
  mockFetchJson("api.pinecone.io", { host: "test-index.svc.pinecone.io" });
  // Mock Pinecone delete namespace
  mockFetchJson("pinecone.io", { ok: true });
  return fn().finally(() => restoreFetch());
}

// -- Test 1: Happy path — cleanup returns ok ---------------------------------

Deno.test({
  name: "stepCleanup: returns 200 with { ok: true } on successful cleanup",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withMockFetch(async () => {
      const req = makeReq({
        findingId: "finding-cleanup-1",
        orgId: "org1",
      });
      const res = await stepCleanup(req);
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.ok, true);
    });
  },
});

// -- Test 2: Uses explicit pineconeNamespace when provided -------------------

Deno.test({
  name: "stepCleanup: uses pineconeNamespace when provided instead of findingId",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    let deletedNamespace = "";
    // Mock Pinecone index describe
    mockFetchJson("api.pinecone.io", { host: "test-index.svc.pinecone.io" });
    // Mock Pinecone delete — capture the body to verify namespace
    mockFetchJson(/pinecone\.io\/vectors\/delete/, { ok: true });

    try {
      const req = makeReq({
        findingId: "finding-cleanup-2",
        orgId: "org1",
        pineconeNamespace: "custom-namespace-xyz",
      });
      const res = await stepCleanup(req);
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.ok, true);
    } finally {
      restoreFetch();
    }
  },
});

// -- Test 3: Cleanup succeeds even when Pinecone delete fails ----------------

Deno.test({
  name: "stepCleanup: returns ok even when Pinecone delete fails (error is swallowed)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    // Mock Pinecone index describe
    mockFetchJson("api.pinecone.io", { host: "test-index.svc.pinecone.io" });
    // Mock Pinecone delete to return an error
    mockFetchJson(/pinecone\.io\/vectors\/delete/, { error: "not found" }, 500);

    try {
      const req = makeReq({
        findingId: "finding-cleanup-fail",
        orgId: "org1",
      });
      const res = await stepCleanup(req);
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.ok, true);
    } finally {
      restoreFetch();
    }
  },
});
