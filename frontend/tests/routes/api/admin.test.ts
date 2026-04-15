import { assertEquals } from "@std/assert";
import { mockFetch, createCtx } from "../../helpers/mock-fetch.ts";

import { handler as statsHandler } from "../../../routes/api/admin/stats.tsx";
import { handler as queueActionHandler } from "../../../routes/api/admin/queue-action.ts";
import { handler as retryHandler } from "../../../routes/api/admin/retry.ts";

// === STATS ===

Deno.test("stats — returns stat-grid HTML on success", async () => {
  const mock = mockFetch({
    "/admin/dashboard/data": { body: { pipeline: { inPipe: 5, completed24h: 20, errors24h: 1, retries24h: 3, active: [{ findingId: "a" }], errors: [{ findingId: "b" }] }, review: { pending: 10, decided: 50, pendingAuditCount: 4 } } },
  });
  try {
    const ctx = createCtx("/api/admin/stats", { cookie: "session=abc" });
    const res = await (statsHandler as any).GET(ctx);
    const html = await res.text();
    assertEquals(html.includes("stat-grid"), true);
    assertEquals(html.includes("In Pipe"), true);
    assertEquals(html.includes("5"), true);
  } finally { mock.restore(); }
});

Deno.test("stats — returns fallback on error", async () => {
  const mock = mockFetch({ "/admin/dashboard/data": { status: 500, body: {} } });
  try {
    const ctx = createCtx("/api/admin/stats", { cookie: "session=abc" });
    const res = await (statsHandler as any).GET(ctx);
    const html = await res.text();
    assertEquals(html.includes("Failed to load stats"), true);
  } finally { mock.restore(); }
});

// === QUEUE ACTION ===

Deno.test("queue-action — pause maps to /admin/pause-queues", async () => {
  const mock = mockFetch({ "/admin/pause-queues": { body: { ok: true } } });
  try {
    const req = new Request("http://localhost/api/admin/queue-action", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "pause" }),
    });
    const res = await (queueActionHandler as any).POST({ req, state: {} });
    assertEquals(res.status, 204);
    assertEquals(mock.calls[0].url.includes("/admin/pause-queues"), true);
  } finally { mock.restore(); }
});

Deno.test("queue-action — resume maps to /admin/resume-queues", async () => {
  const mock = mockFetch({ "/admin/resume-queues": { body: { ok: true } } });
  try {
    const req = new Request("http://localhost/api/admin/queue-action", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "resume" }),
    });
    const res = await (queueActionHandler as any).POST({ req, state: {} });
    assertEquals(res.status, 204);
    assertEquals(mock.calls[0].url.includes("/admin/resume-queues"), true);
  } finally { mock.restore(); }
});

Deno.test("queue-action — unknown action returns 400", async () => {
  const req = new Request("http://localhost/api/admin/queue-action", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "bogus" }),
  });
  const res = await (queueActionHandler as any).POST({ req, state: {} });
  assertEquals(res.status, 400);
});

// === RETRY ===

Deno.test("retry — forwards findingId and step as query params", async () => {
  const mock = mockFetch({ "/admin/retry-finding": { body: { ok: true } } });
  try {
    const ctx = createCtx("/api/admin/retry?findingId=abc123&step=transcribe", { cookie: "session=abc" });
    const res = await (retryHandler as any).GET(ctx);
    assertEquals(res.status, 204);
    assertEquals(mock.calls[0].url.includes("findingId=abc123"), true);
    assertEquals(mock.calls[0].url.includes("step=transcribe"), true);
  } finally { mock.restore(); }
});

Deno.test("retry — returns error HTML on failure", async () => {
  const mock = mockFetch({ "/admin/retry-finding": { status: 500, body: { error: "not found" } } });
  try {
    const ctx = createCtx("/api/admin/retry?findingId=bad", { cookie: "session=abc" });
    const res = await (retryHandler as any).GET(ctx);
    const html = await res.text();
    assertEquals(html.includes("error-text"), true);
  } finally { mock.restore(); }
});

// Users validation is tested via admin/users.ts form handler
Deno.test("queue-action — clear-review maps correctly", async () => {
  const mock = mockFetch({ "/admin/clear-review-queue": { body: { ok: true } } });
  try {
    const req = new Request("http://localhost/api/admin/queue-action", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "clear-review" }),
    });
    const res = await (queueActionHandler as any).POST({ req, state: {} });
    assertEquals(res.status, 204);
  } finally { mock.restore(); }
});
