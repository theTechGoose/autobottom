import { assertEquals, assertRejects } from "@std/assert";
import { mockFetch } from "../helpers/mock-fetch.ts";
import { apiFetch, apiPost, ApiError, fetchJudgeStats } from "../../lib/api.ts";

const REQ = new Request("http://localhost/test", { headers: { cookie: "session=abc123" } });
const REQ_NO_COOKIE = new Request("http://localhost/test");

Deno.test("ApiError stores status, path, message", () => {
  const err = new ApiError(404, "/foo", "not found");
  assertEquals(err.status, 404);
  assertEquals(err.path, "/foo");
  assertEquals(err.message, "API 404: /foo — not found");
});

Deno.test("apiFetch forwards cookie header from request", async () => {
  const mock = mockFetch({ "/test-path": { body: { ok: true } } });
  try {
    await apiFetch("/test-path", REQ);
    assertEquals(mock.calls[0].headers["cookie"], "session=abc123");
  } finally { mock.restore(); }
});

Deno.test("apiFetch sets content-type to application/json", async () => {
  const mock = mockFetch({ "/test-path": { body: { ok: true } } });
  try {
    await apiFetch("/test-path", REQ);
    assertEquals(mock.calls[0].headers["content-type"], "application/json");
  } finally { mock.restore(); }
});

Deno.test("apiFetch uses API_URL env var when set", async () => {
  const prev = Deno.env.get("API_URL");
  Deno.env.set("API_URL", "http://custom:9999");
  const mock = mockFetch({ "/test-path": { body: {} } });
  try {
    await apiFetch("/test-path", REQ);
    assertEquals(mock.calls[0].url.startsWith("http://custom:9999"), true);
  } finally { mock.restore(); if (prev) Deno.env.set("API_URL", prev); else Deno.env.delete("API_URL"); }
});

Deno.test("apiFetch defaults to localhost:3000", async () => {
  const prev = Deno.env.get("API_URL");
  Deno.env.delete("API_URL");
  const mock = mockFetch({ "/test-path": { body: {} } });
  try {
    await apiFetch("/test-path", REQ);
    assertEquals(mock.calls[0].url.startsWith("http://localhost:3000"), true);
  } finally { mock.restore(); if (prev) Deno.env.set("API_URL", prev); }
});

Deno.test("apiFetch throws ApiError on non-ok response", async () => {
  const mock = mockFetch({ "/fail": { status: 404, body: { error: "not found" } } });
  try {
    await assertRejects(
      () => apiFetch("/fail", REQ),
      ApiError,
    );
  } finally { mock.restore(); }
});

Deno.test("apiFetch returns parsed JSON on success", async () => {
  const mock = mockFetch({ "/data": { body: { count: 42, items: ["a"] } } });
  try {
    const result = await apiFetch<{ count: number }>("/data", REQ);
    assertEquals(result.count, 42);
  } finally { mock.restore(); }
});

Deno.test("fetchJudgeStats returns parsed stats on success", async () => {
  const mock = mockFetch({ "/judge/api/stats": { body: { pending: 14, pendingAudits: 10, decided: 244 } } });
  try {
    const stats = await fetchJudgeStats(REQ);
    assertEquals(stats.pending, 14);
    assertEquals(stats.pendingAudits, 10);
    assertEquals(stats.decided, 244);
  } finally { mock.restore(); }
});

// Pins the degraded path: a stats-endpoint failure must resolve (never reject)
// to undefined questions/audits so the verdict panel falls back to per-audit
// remaining instead of rendering a misleading "0 / 0".
Deno.test("fetchJudgeStats resolves to undefined-fields default on failure", async () => {
  const mock = mockFetch({ "/judge/api/stats": { status: 500, body: { error: "boom" } } });
  try {
    const stats = await fetchJudgeStats(REQ);
    assertEquals(stats.pending, undefined);
    assertEquals(stats.pendingAudits, undefined);
    assertEquals(stats.decided, 0);
  } finally { mock.restore(); }
});

Deno.test("apiPost sends POST with JSON-stringified body", async () => {
  const mock = mockFetch({ "/submit": { body: { ok: true } } });
  try {
    await apiPost("/submit", REQ, { name: "test", value: 123 });
    assertEquals(mock.calls[0].method, "POST");
    const parsed = JSON.parse(mock.calls[0].body!);
    assertEquals(parsed.name, "test");
    assertEquals(parsed.value, 123);
  } finally { mock.restore(); }
});
