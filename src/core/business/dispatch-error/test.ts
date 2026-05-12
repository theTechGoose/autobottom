/** Regression tests for the [DISPATCH-CATCH] safety net.
 *
 *  Locks the contract that ANY uncaught FS abort error reaching the dispatch
 *  catch in main.ts becomes a structured `{ retry: true }` response instead
 *  of a raw `500 {"message":"signal aborted"}`. If these break, the
 *  foolproof safety net has regressed — fix the code, not the test.
 *  See plan: /Users/adam/.claude/plans/hiya-please-review-this-gentle-starfish.md */

import { assertEquals } from "jsr:@std/assert";
import { buildDispatchErrorResponse, isAbortError, isDanetAbortBody } from "./mod.ts";

// ── isAbortError ────────────────────────────────────────────────────────────

Deno.test("isAbortError detects Deno's AbortError class name", () => {
  const err = new Error("AbortError: The operation was aborted");
  assertEquals(isAbortError(err), true);
});

Deno.test("isAbortError detects our 'signal aborted' message", () => {
  const err = new Error("The signal has been aborted");
  assertEquals(isAbortError(err), true);
});

Deno.test("isAbortError detects bare 'aborted' substring", () => {
  const err = new Error("operation aborted while waiting on Firestore");
  assertEquals(isAbortError(err), true);
});

Deno.test("isAbortError detects 'signal' even without 'abort' word", () => {
  const err = new Error("upstream signal raised");
  assertEquals(isAbortError(err), true);
});

Deno.test("isAbortError returns false for unrelated errors", () => {
  assertEquals(isAbortError(new Error("permission denied")), false);
  assertEquals(isAbortError(new Error("not found")), false);
  assertEquals(isAbortError(new Error("Firestore set failed: 400")), false);
});

Deno.test("isAbortError handles non-Error throws (strings, objects)", () => {
  assertEquals(isAbortError("the signal aborted"), true);
  assertEquals(isAbortError({ toString: () => "stream aborted" }), true);
  assertEquals(isAbortError("plain string"), false);
  assertEquals(isAbortError(null), false);
  assertEquals(isAbortError(undefined), false);
});

// ── buildDispatchErrorResponse ──────────────────────────────────────────────

Deno.test("buildDispatchErrorResponse — GET abort returns 200 + retry:true", async () => {
  const err = new Error("The signal has been aborted");
  const res = buildDispatchErrorResponse(err, { method: "GET", path: "/admin/users" });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.retry, true);
  assertEquals(body.method, "GET");
  assertEquals(body.path, "/admin/users");
  // CRITICAL: ensure we never leak the raw error message in retry responses
  // — the frontend should see a friendly "Server busy" string, not the
  // internal "signal aborted" detail.
  assertEquals(body.error, "Server busy, please retry");
});

Deno.test("buildDispatchErrorResponse — POST abort returns 503 + retry:true", async () => {
  const err = new Error("AbortError: signal aborted");
  const res = buildDispatchErrorResponse(err, { method: "POST", path: "/review/api/decide" });
  assertEquals(res.status, 503);
  const body = await res.json();
  assertEquals(body.retry, true);
  assertEquals(body.method, "POST");
  assertEquals(body.path, "/review/api/decide");
});

Deno.test("buildDispatchErrorResponse — non-abort error returns 500 + ok:false", async () => {
  const err = new Error("Some genuinely unexpected bug");
  const res = buildDispatchErrorResponse(err, { method: "GET", path: "/admin/audits-by-record" });
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.ok, false);
  // Non-abort errors DO leak the message (intentional — devs need diagnosis).
  // The contract is: only FS aborts get the friendly retry shape.
  assertEquals(body.error, "Some genuinely unexpected bug");
  assertEquals(body.path, "/admin/audits-by-record");
});

Deno.test("buildDispatchErrorResponse — DELETE abort returns 503 (treated as non-GET)", async () => {
  const err = new Error("aborted");
  const res = buildDispatchErrorResponse(err, { method: "DELETE", path: "/admin/delete-finding" });
  assertEquals(res.status, 503);
});

Deno.test("buildDispatchErrorResponse — string throw still produces structured body", async () => {
  const res = buildDispatchErrorResponse("oh no, signal aborted", { method: "GET", path: "/x" });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.retry, true);
});

Deno.test("buildDispatchErrorResponse — body is always JSON content-type", () => {
  const res = buildDispatchErrorResponse(new Error("aborted"), { method: "GET", path: "/x" });
  assertEquals(res.headers.get("content-type"), "application/json");
});

// ── Contract guard: the precise shape the frontend depends on ───────────────

Deno.test("CONTRACT — abort response shape is { retry, error, path, method }", async () => {
  const res = buildDispatchErrorResponse(new Error("signal aborted"), { method: "GET", path: "/foo" });
  const body = await res.json();
  assertEquals(Object.keys(body).sort(), ["error", "method", "path", "retry"]);
});

Deno.test("CONTRACT — 500 response shape is { ok, error, path, method }", async () => {
  const res = buildDispatchErrorResponse(new Error("real bug"), { method: "POST", path: "/foo" });
  const body = await res.json();
  assertEquals(Object.keys(body).sort(), ["error", "method", "ok", "path"]);
});

// ── isDanetAbortBody — response-level boundary wrap ─────────────────────────
// These lock the second safety net: even when danet's internal exception
// filter catches a controller exception BEFORE it reaches our outer
// try/catch, the backendFetch wrap in main.ts inspects the response body
// to detect danet's auto-generated 500 signature. Without this layer the
// dispatch-catch alone would be a no-op for the most common 500 path.

Deno.test("isDanetAbortBody — matches danet's auto-generated 500 abort body verbatim", () => {
  // The exact body shape user pulled from production logs.
  assertEquals(isDanetAbortBody('{"status":500,"message":"The signal has been aborted"}'), true);
});

Deno.test("isDanetAbortBody — matches alternate AbortError phrasing", () => {
  assertEquals(isDanetAbortBody('{"status":500,"message":"AbortError: The operation was aborted"}'), true);
});

Deno.test("isDanetAbortBody — matches when only the abort substring is present", () => {
  assertEquals(isDanetAbortBody('{"status":500,"message":"upstream stream aborted while reading"}'), true);
});

Deno.test("isDanetAbortBody — rejects non-abort 500 bodies", () => {
  assertEquals(isDanetAbortBody('{"status":500,"message":"permission denied"}'), false);
  assertEquals(isDanetAbortBody('{"status":500,"message":"not found"}'), false);
  assertEquals(isDanetAbortBody('{"error":"Server busy, please retry"}'), false);
});

Deno.test("isDanetAbortBody — rejects empty / huge bodies", () => {
  assertEquals(isDanetAbortBody(""), false);
  // Bodies over 2k chars are not danet's tiny error envelopes — bail.
  assertEquals(isDanetAbortBody("a".repeat(2001) + "aborted"), false);
});

// ── Regression sentinel — the original symptom that motivated this code ─────

Deno.test("REGRESSION — /admin/audits-by-record abort no longer produces a raw 500", async () => {
  // The symptom user reported: API 500 with body
  // {"status":500,"message":"The signal has been aborted"}
  // After this fix, it MUST become a 200 with { retry: true }.
  const err = new Error("The signal has been aborted");
  const res = buildDispatchErrorResponse(err, { method: "GET", path: "/admin/audits-by-record" });
  assertEquals(res.status, 200, "abort on a GET must not be a 500");
  const body = await res.json();
  assertEquals(body.retry, true);
  // We must NEVER leak the raw "signal aborted" message in the retry body.
  assertEquals(body.error.includes("aborted"), false);
});
