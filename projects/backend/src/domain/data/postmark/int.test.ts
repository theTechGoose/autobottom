/**
 * Integration tests for postmark/mod.ts.
 * Mocks the fetch call to the Postmark API and verifies correct request
 * formatting and error handling.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { mockFetch, restoreFetch } from "../mock-fetch.ts";
import { sendEmail } from "./mod.ts";

// Required env vars
Deno.env.set("POSTMARK_SERVER", "test-postmark-token");
Deno.env.set("FROM_EMAIL", "sender@example.com");

// ---------------------------------------------------------------------------
// sendEmail — successful send
// ---------------------------------------------------------------------------

Deno.test("sendEmail — sends correct request to Postmark API", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;

  mockFetch("api.postmarkapp.com/email", (url, init) => {
    capturedUrl = url as string;
    capturedInit = init;
    return new Response(JSON.stringify({ MessageID: "abc-123" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  try {
    await sendEmail({
      to: "recipient@example.com",
      subject: "Test Subject",
      htmlBody: "<p>Hello</p>",
    });

    assertEquals(capturedUrl, "https://api.postmarkapp.com/email");
    assertEquals(capturedInit?.method, "POST");

    const headers = capturedInit?.headers as Record<string, string>;
    assertEquals(headers["X-Postmark-Server-Token"], "test-postmark-token");
    assertEquals(headers["Content-Type"], "application/json");

    const body = JSON.parse(capturedInit?.body as string);
    assertEquals(body.To, "recipient@example.com");
    assertEquals(body.Subject, "Test Subject");
    assertEquals(body.HtmlBody, "<p>Hello</p>");
    assertEquals(body.From, "sender@example.com");
  } finally {
    restoreFetch();
  }
});

// ---------------------------------------------------------------------------
// sendEmail — array of recipients joined with comma
// ---------------------------------------------------------------------------

Deno.test("sendEmail — joins array of recipients with comma", async () => {
  let capturedBody = "";

  mockFetch("api.postmarkapp.com/email", (_url, init) => {
    capturedBody = init?.body as string;
    return new Response(JSON.stringify({ MessageID: "def-456" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  try {
    await sendEmail({
      to: ["a@example.com", "b@example.com"],
      subject: "Multi",
      htmlBody: "<p>Hi</p>",
    });

    const body = JSON.parse(capturedBody);
    assertEquals(body.To, "a@example.com,b@example.com");
  } finally {
    restoreFetch();
  }
});

// ---------------------------------------------------------------------------
// sendEmail — throws on non-ok response
// ---------------------------------------------------------------------------

Deno.test("sendEmail — throws on non-ok response from Postmark", async () => {
  mockFetch("api.postmarkapp.com/email", () => {
    return new Response("Invalid token", { status: 401 });
  });

  try {
    await assertRejects(
      () =>
        sendEmail({
          to: "x@example.com",
          subject: "Fail",
          htmlBody: "<p>Oops</p>",
        }),
      Error,
      "Postmark failed: 401",
    );
  } finally {
    restoreFetch();
  }
});
