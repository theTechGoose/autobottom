/**
 * Integration tests for s3/mod.ts.
 * Mocks fetch calls to S3 and verifies correct URL construction,
 * AWS SigV4 headers, and response handling.
 */

import { assertEquals } from "@std/assert";
import { assertRejects } from "@std/assert";
import { mockFetch, restoreFetch } from "../mock-fetch.ts";
import { S3Ref } from "./mod.ts";

// Required env vars
Deno.env.set("AWS_ACCESS_KEY_ID", "test-key");
Deno.env.set("AWS_SECRET_ACCESS_KEY", "test-secret");
Deno.env.set("AWS_REGION", "us-east-1");

// ---------------------------------------------------------------------------
// S3Ref.save — successful PUT
// ---------------------------------------------------------------------------

Deno.test("S3Ref.save — sends PUT with signed headers to correct URL", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;

  mockFetch("s3.us-east-1.amazonaws.com", (url, init) => {
    capturedUrl = url as string;
    capturedInit = init;
    return new Response("", { status: 200 });
  });

  try {
    const ref = new S3Ref("my-bucket", "path/to/file.txt");
    await ref.save("hello world");

    assertEquals(capturedUrl.includes("my-bucket.s3.us-east-1.amazonaws.com"), true);
    assertEquals(capturedUrl.includes("/path/to/file.txt"), true);
    assertEquals(capturedInit?.method, "PUT");

    const headers = capturedInit?.headers as Record<string, string>;
    assertEquals(headers["authorization"].startsWith("AWS4-HMAC-SHA256"), true);
    assertEquals(typeof headers["x-amz-date"], "string");
    assertEquals(typeof headers["x-amz-content-sha256"], "string");
  } finally {
    restoreFetch();
  }
});

// ---------------------------------------------------------------------------
// S3Ref.save — throws on non-ok response
// ---------------------------------------------------------------------------

Deno.test("S3Ref.save — throws on non-ok response", async () => {
  mockFetch("s3.us-east-1.amazonaws.com", () => {
    return new Response("Access Denied", { status: 403 });
  });

  try {
    const ref = new S3Ref("my-bucket", "path/to/file.txt");
    await assertRejects(
      () => ref.save("data"),
      Error,
      "S3 PUT failed: 403",
    );
  } finally {
    restoreFetch();
  }
});

// ---------------------------------------------------------------------------
// S3Ref.get — successful GET returns bytes
// ---------------------------------------------------------------------------

Deno.test("S3Ref.get — returns Uint8Array on success", async () => {
  const expectedData = new TextEncoder().encode("file contents");

  mockFetch("s3.us-east-1.amazonaws.com", () => {
    return new Response(expectedData, { status: 200 });
  });

  try {
    const ref = new S3Ref("my-bucket", "path/to/file.txt");
    const result = await ref.get();
    assertEquals(result instanceof Uint8Array, true);
    assertEquals(new TextDecoder().decode(result!), "file contents");
  } finally {
    restoreFetch();
  }
});

// ---------------------------------------------------------------------------
// S3Ref.get — 404 returns null
// ---------------------------------------------------------------------------

Deno.test("S3Ref.get — returns null on 404", async () => {
  mockFetch("s3.us-east-1.amazonaws.com", () => {
    return new Response("Not Found", { status: 404 });
  });

  try {
    const ref = new S3Ref("my-bucket", "missing-key.txt");
    const result = await ref.get();
    assertEquals(result, null);
  } finally {
    restoreFetch();
  }
});

// ---------------------------------------------------------------------------
// S3Ref.get — NoSuchKey XML in non-ok response returns null
// ---------------------------------------------------------------------------

Deno.test("S3Ref.get — returns null on NoSuchKey XML error response", async () => {
  mockFetch("s3.us-east-1.amazonaws.com", () => {
    return new Response(
      '<?xml version="1.0"?><Error><Code>NoSuchKey</Code></Error>',
      { status: 403 },
    );
  });

  try {
    const ref = new S3Ref("my-bucket", "missing-key.txt");
    const result = await ref.get();
    assertEquals(result, null);
  } finally {
    restoreFetch();
  }
});
