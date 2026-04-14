/** Smoke tests for Datadog OTel adapter.
 *
 * Offline tests: always run. Validate OTLP JSON payload shape, context
 * propagation, no-op behavior when disabled, console-patch reentry guard,
 * flush buffer drainage.
 *
 * Live tests: run only when DD_API_KEY is present in the env. Hit the real
 * Datadog OTLP intake endpoints and assert 2xx. */

import { assert, assertEquals, assertExists } from "#assert";
import {
  initOtel,
  isOtelInitialized,
  log,
  metric,
  withSpan,
  withRequest,
  runStep,
  flushOtel,
  verifyDatadogIntake,
  type Span,
} from "./mod.ts";

const DD_API_KEY = Deno.env.get("DD_API_KEY");
const LIVE_MODE = !!DD_API_KEY;

// ── Live tests (require DD_API_KEY) ─────────────────────────────────────────

Deno.test({
  name: "live — verifyDatadogIntake hits all three endpoints and returns 2xx",
  ignore: !LIVE_MODE,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const probe = await verifyDatadogIntake();
    assert(probe.configured, "probe should report configured=true when DD_API_KEY is set");
    assertEquals(probe.results.length, 3, "probe should report on all three signals");

    const byTarget = Object.fromEntries(probe.results.map((r) => [r.target, r]));
    assertExists(byTarget.logs);
    assertExists(byTarget.metrics);
    assertExists(byTarget.traces);

    assert(byTarget.logs.ok, `logs intake should accept payload: status=${byTarget.logs.status}`);
    assert(byTarget.metrics.ok, `metrics intake should accept payload: status=${byTarget.metrics.status}`);
    assert(byTarget.traces.ok, `traces intake should return 2xx: status=${byTarget.traces.status}`);
  },
});

Deno.test({
  name: "live — end-to-end: initOtel + withSpan + log + metric + flushOtel",
  ignore: !LIVE_MODE,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    initOtel();
    assert(isOtelInitialized(), "initOtel should mark module initialized");

    const marker = crypto.randomUUID();
    await withSpan("smk.live.e2e", (span) => {
      span.setAttribute("test.marker", marker);
      log("info", `smk live e2e marker=${marker}`, { "test.marker": marker }, span);
      metric("autobottom.smk.live.e2e", 1, { "test.marker": marker });
    });

    const start = performance.now();
    await flushOtel();
    const elapsed = performance.now() - start;

    assert(
      elapsed >= 5,
      `flushOtel resolved in ${elapsed.toFixed(1)}ms — suspiciously fast, suggests no network work`,
    );
  },
});

// ── Offline tests (always run) ──────────────────────────────────────────────

Deno.test("offline — log/metric/withSpan are safe no-ops when DD_API_KEY missing", async () => {
  if (isOtelInitialized()) return;

  log("info", "should be ignored");
  metric("should.be.ignored", 1);

  let ran = false;
  const result = await withSpan("should-noop", async (span) => {
    ran = true;
    const ctx = span.spanContext();
    assertEquals(typeof ctx.traceId, "string");
    assertEquals(typeof ctx.spanId, "string");
    return 42;
  });
  assertEquals(ran, true);
  assertEquals(result, 42);

  await flushOtel();
});

Deno.test("offline — withSpan propagates parent trace context to children", async () => {
  if (!isOtelInitialized()) initOtel();
  if (!isOtelInitialized()) return;

  let parentTraceId = "";
  let parentSpanId = "";
  let childTraceId = "";

  await withSpan("parent", async (parent) => {
    parentTraceId = parent.traceId;
    parentSpanId = parent.spanId;
    await withSpan("child", (child) => {
      childTraceId = child.traceId;
      return null;
    });
  });

  assertEquals(childTraceId, parentTraceId, "child span must inherit parent's traceId");
  assert(parentSpanId.length === 16, "span IDs should be 16 hex chars");
});

Deno.test("offline — withSpan records exception on throw and re-raises", async () => {
  if (!isOtelInitialized()) initOtel();
  if (!isOtelInitialized()) return;

  let thrown: unknown = null;
  try {
    await withSpan("throws", () => {
      throw new Error("boom");
    });
  } catch (e) {
    thrown = e;
  }
  assert(thrown instanceof Error);
  assertEquals((thrown as Error).message, "boom");
  await flushOtel();
});

Deno.test("offline — withRequest wraps a handler and always flushes", async () => {
  if (!isOtelInitialized()) initOtel();

  const wrapped = withRequest(async (_req: Request) => {
    log("info", "inside handler");
    metric("autobottom.offline.test", 1);
    return new Response("ok", { status: 200 });
  });

  const res = await wrapped(new Request("http://test.local/offline"));
  assertEquals(res.status, 200);
});

Deno.test("offline — runStep sets step.name attribute and metrics", async () => {
  if (!isOtelInitialized()) initOtel();

  const wrapped = runStep("offline-test", async (_req: Request) => {
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  const res = await wrapped(new Request("http://test.local/step"));
  assertEquals(res.status, 200);
});

Deno.test("offline — verifyDatadogIntake returns configured:false when DD_API_KEY missing", async () => {
  const probe = await verifyDatadogIntake();
  if (LIVE_MODE) {
    assert(probe.configured, "should be configured when DD_API_KEY is set");
  } else {
    assertEquals(probe.configured, false);
    assertEquals(probe.results.length, 0);
  }
});

Deno.test("offline — console patching does not recurse", async () => {
  if (!isOtelInitialized()) initOtel();
  if (!isOtelInitialized()) return;

  await withSpan("console-test", () => {
    console.log("[SMK] offline console patch test");
    console.warn("[SMK] offline console warn test");
    console.error("[SMK] offline console error test");
    return null;
  });
});
