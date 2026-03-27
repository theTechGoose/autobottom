/**
 * Tests for sound file handler (handleSoundFile).
 * Verifies: S3 path routing, local file fallback, bad path rejection.
 */

import { assertEquals } from "@std/assert";
import { handleSoundFile } from "./sounds.ts";
import { mockFetch, mockFetchJson, restoreFetch } from "../domain/data/mock-fetch.ts";

// ---- env setup -------------------------------------------------------
Deno.env.set("S3_BUCKET", "test-bucket");
Deno.env.set("AWS_ACCESS_KEY_ID", "test-key");
Deno.env.set("AWS_SECRET_ACCESS_KEY", "test-secret");
Deno.env.set("AWS_REGION", "us-east-1");

function makeGet(path: string): Request {
  return new Request(`http://localhost:8000${path}`, { method: "GET" });
}

// ---- Test 1: S3 path routing (/sounds/orgId/packId/slot.mp3) ---------
Deno.test({ name: "handleSoundFile: serves mp3 from S3 for orgId/packId/slot path", sanitizeResources: false, sanitizeOps: false, fn: async () => {
  // Mock S3 GET to return audio bytes
  const fakeAudio = new Uint8Array([0xFF, 0xFB, 0x90, 0x00]);
  mockFetch(/s3\.us-east-1\.amazonaws\.com/, () =>
    new Response(fakeAudio, { status: 200 }),
  );

  const req = makeGet("/sounds/org1/pack1/ding.mp3");
  const res = await handleSoundFile(req);

  assertEquals(res !== null, true);
  assertEquals(res!.status, 200);
  assertEquals(res!.headers.get("Content-Type"), "audio/mpeg");
  assertEquals(res!.headers.get("Cache-Control"), "public, max-age=86400");

  restoreFetch();
}});

// ---- Test 2: S3 returns null → 404 -----------------------------------
Deno.test({ name: "handleSoundFile: returns 404 when S3 file not found", sanitizeResources: false, sanitizeOps: false, fn: async () => {
  // Mock S3 GET to return 404
  mockFetch(/s3\.us-east-1\.amazonaws\.com/, () =>
    new Response("", { status: 404 }),
  );

  const req = makeGet("/sounds/org1/pack1/missing.mp3");
  const res = await handleSoundFile(req);

  assertEquals(res !== null, true);
  assertEquals(res!.status, 404);

  restoreFetch();
}});

// ---- Test 3: Bad path rejection (non-mp3, non-matching path) ---------
Deno.test("handleSoundFile: rejects bad path with 400", async () => {
  // A path under /sounds/ that doesn't match the S3 pattern or legacy pattern
  const req = makeGet("/sounds/org1/pack1/slot.wav");
  const res = await handleSoundFile(req);

  assertEquals(res !== null, true);
  assertEquals(res!.status, 400);
  const body = await res!.json();
  assertEquals(body.error, "bad path");
});

// ---- Test 4: Returns null for non /sounds/ paths ---------------------
Deno.test("handleSoundFile: returns null for non-sound paths", async () => {
  const req = makeGet("/api/badges");
  const res = await handleSoundFile(req);

  assertEquals(res, null);
});

// ---- Test 5: Legacy local file path (single filename) ----------------
Deno.test({ name: "handleSoundFile: serves local file for simple filename.mp3", sanitizeResources: false, sanitizeOps: false, fn: async () => {
  // This test verifies the fallback path is attempted.
  // Since the file won't exist in test, it should return 404.
  const req = makeGet("/sounds/nonexistent-file.mp3");
  const res = await handleSoundFile(req);

  assertEquals(res !== null, true);
  // File doesn't exist locally, so we get 404
  assertEquals(res!.status, 404);
}});
