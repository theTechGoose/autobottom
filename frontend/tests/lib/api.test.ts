import { assertEquals, assertRejects } from "@std/assert";
import { mockFetch } from "../helpers/mock-fetch.ts";
import { apiFetch, apiPost, ApiError } from "../../lib/api.ts";

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
