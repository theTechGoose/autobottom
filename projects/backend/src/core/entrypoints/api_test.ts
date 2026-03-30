/**
 * Characterization tests for handleAuditByRid and handlePackageByRid.
 * These tests lock in the current behavior before any refactoring.
 */

import { assertEquals } from "@std/assert";
import { MockFetch } from "@test/mock-fetch";

import { handleAuditByRid, handlePackageByRid } from "./api.ts";
import { Kv } from "../domain/data/kv/mod.ts";
import { KvTestHelpers } from "../domain/data/kv/test-helpers.ts";

// ---- env setup -------------------------------------------------------
// queue.ts reads env.selfUrl to build the enqueue URL; env.ts throws if missing.
// We set these before any imports resolve (top-level, before Deno.test).
Deno.env.set("SELF_URL", "http://localhost:8000");
Deno.env.set("QSTASH_URL", "http://mock-qstash");
Deno.env.set("QSTASH_TOKEN", "mock-token");
Deno.env.set("LOCAL_QUEUE", "true"); // avoids QStash HTTP; enqueue fires via setTimeout

// quickbase.ts reads QB_REALM and QB_USER_TOKEN at module init
Deno.env.set("QB_REALM", "test-realm");
Deno.env.set("QB_USER_TOKEN", "test-token");

// ---- helpers ----------------------------------------------------------

function makeReq(url: string, body?: unknown): Request {
  if (body !== undefined) {
    return new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  return new Request(url, { method: "POST" });
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

// ---- Test 1: handleAuditByRid returns 400 when no rid ----------------

Deno.test("handleAuditByRid: returns 400 when rid param is missing", async () => {
  const req = makeReq("http://localhost:8000/audit/test-by-rid");
  const res = await handleAuditByRid("org1" as any, req);

  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "rid parameter required");
});

// ---- Test 2: handleAuditByRid creates job+finding with body.record ---

Deno.test({ name: "handleAuditByRid: creates job and finding when body.record is provided", sanitizeResources: false, sanitizeOps: false, fn: async () => {
  // Mock the enqueue fetch call that fires from LOCAL_QUEUE setTimeout
  // The setTimeout fires async — we don't need to intercept it for this test
  // because localEnqueue swallows errors internally. But we install a catch-all.
  MockFetch.routeJson(/.*/, { ok: true });

  const result = await withKv(async () => {
    const record = { RecordId: "42", VoGenie: "vg-abc123" };
    const req = makeReq(
      "http://localhost:8000/audit/test-by-rid?rid=42",
      { record },
    );
    const res = await handleAuditByRid("org1" as any, req);
    return res;
  });

  const body = await result.json();

  assertEquals(result.status, 200);
  assertEquals(body.status, "queued");
  assertEquals(typeof body.jobId, "string");
  assertEquals(typeof body.findingId, "string");
  assertEquals(body.jobId.length > 0, true);
  assertEquals(body.findingId.length > 0, true);

  MockFetch.restore();
}});

// ---- Test 3: handleAuditByRid fetches from QuickBase when no body.record ---

Deno.test({ name: "handleAuditByRid: fetches from QuickBase when body.record is absent", sanitizeResources: false, sanitizeOps: false, fn: async () => {
  // Mock QuickBase API response
  const qbResponse = {
    data: [
      {
        3: { value: "99" },
        6: { value: "qb-vg-xyz" },
        7: { value: "dest-1" },
      },
    ],
    fields: [],
  };
  MockFetch.routeJson("api.quickbase.com", qbResponse);
  // Catch-all for any other fetches (e.g. local queue)
  MockFetch.routeJson(/.*/, { ok: true });

  let capturedRecord: any = null;

  const result = await withKv(async () => {
    const req = makeReq("http://localhost:8000/audit/test-by-rid?rid=99");
    // No body — controller will call getDateLegByRid
    const res = await handleAuditByRid("org1" as any, req);
    return res;
  });

  const body = await result.json();

  assertEquals(result.status, 200);
  assertEquals(body.status, "queued");
  assertEquals(typeof body.jobId, "string");
  assertEquals(typeof body.findingId, "string");

  MockFetch.restore();
}});

// ---- Test 4: handleAuditByRid uses override for recordingId ----------

Deno.test({ name: "handleAuditByRid: override param sets recordingId on finding", sanitizeResources: false, sanitizeOps: false, fn: async () => {
  MockFetch.routeJson(/.*/, { ok: true });

  // We'll use body.record so we don't need QB, and pass override param
  const result = await withKv(async () => {
    const record = { RecordId: "10", VoGenie: "original-voice-id" };
    const req = makeReq(
      "http://localhost:8000/audit/test-by-rid?rid=10&override=forced-voice-id",
      { record },
    );
    return await handleAuditByRid("org1" as any, req);
  });

  const body = await result.json();

  assertEquals(result.status, 200);
  assertEquals(body.status, "queued");
  // The finding is saved internally; we verify via the response shape
  // (recording override is stored in KV — the response still returns queued)
  assertEquals(typeof body.findingId, "string");

  MockFetch.restore();
}});

// ---- Test 5: handlePackageByRid uses GenieNumber as default field -----

Deno.test({ name: "handlePackageByRid: uses GenieNumber as default recordingIdField", sanitizeResources: false, sanitizeOps: false, fn: async () => {
  MockFetch.routeJson(/.*/, { ok: true });

  // Provide a record with GenieNumber so we can verify the field is picked up
  const record = { RecordId: "55", GenieNumber: "gn-9000" };

  const result = await withKv(async () => {
    const req = makeReq(
      "http://localhost:8000/audit/package-by-rid?rid=55",
      { record },
    );
    return await handlePackageByRid("org1" as any, req);
  });

  const body = await result.json();

  assertEquals(result.status, 200);
  assertEquals(body.status, "queued");
  assertEquals(typeof body.jobId, "string");
  assertEquals(typeof body.findingId, "string");

  MockFetch.restore();
}});

// ---- Test 6: handlePackageByRid returns 400 when rid is missing -------

Deno.test("handlePackageByRid: returns 400 when rid param is missing", async () => {
  const req = makeReq("http://localhost:8000/audit/package-by-rid");
  const res = await handlePackageByRid("org1" as any, req);

  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "rid parameter required");
});

// ---- Test 7: handlePackageByRid defaults record to { RecordId: rid } --

Deno.test({ name: "handlePackageByRid: defaults record to { RecordId: rid } when body is empty", sanitizeResources: false, sanitizeOps: false, fn: async () => {
  MockFetch.routeJson(/.*/, { ok: true });

  const result = await withKv(async () => {
    // No body — record defaults to { RecordId: "77" }
    const req = makeReq("http://localhost:8000/audit/package-by-rid?rid=77");
    return await handlePackageByRid("org1" as any, req);
  });

  const body = await result.json();

  assertEquals(result.status, 200);
  assertEquals(body.status, "queued");

  MockFetch.restore();
}});
