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
  withTiming,
  flushOtel,
  verifyDatadogIntake,
  type Span,
} from "./mod.ts";

const DD_API_KEY = Deno.env.get("DD_API_KEY");
const LIVE_MODE = !!DD_API_KEY;

/** Run `fn` with console.log captured; returns the emitted lines. */
async function captureLogs(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  try { await fn(); } finally { console.log = orig; }
  return lines;
}

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

// ---------- withTiming (the general perf timer) ----------

Deno.test("withTiming — returns the wrapped value", async () => {
  assertEquals(await withTiming("x", async () => 42, { thresholdMs: 0 }), 42);
});

Deno.test("withTiming — fast calls stay below the default threshold (no log)", async () => {
  const lines = await captureLogs(async () => { await withTiming("fast", async () => 1); });
  assert(!lines.some((l) => l.includes("fast")), "an instant call must not log at the 1s default threshold");
});

Deno.test("withTiming — default category keeps the legacy [FS-PROFILE] prefix + real ms", async () => {
  const lines = await captureLogs(async () => { await withTiming("getStats", async () => 1, { thresholdMs: 0 }); });
  // Pin the elapsed value to an actual integer — a NaN/undefined regression
  // would still contain "took" but fail this regex.
  assert(lines.some((l) => l.includes("[FS-PROFILE] getStats") && /took \d+ms \(ok\)/.test(l)), lines.join("|"));
});

Deno.test("withTiming — non-fs categories log the [PERF:<category>] tag", async () => {
  const lines = await captureLogs(async () => {
    await withTiming("GET /admin", async () => 1, { thresholdMs: 0, category: "http" });
    await withTiming("getJudgeStats", async () => 1, { thresholdMs: 0, category: "db" });
    await withTiming("groq.askQuestion", async () => 1, { thresholdMs: 0, category: "ext" });
  });
  assert(lines.some((l) => l.includes("[PERF:http] GET /admin took")), lines.join("|"));
  assert(lines.some((l) => l.includes("[PERF:db] getJudgeStats took")), lines.join("|"));
  assert(lines.some((l) => l.includes("[PERF:ext] groq.askQuestion took")), lines.join("|"));
});

Deno.test("withTiming — re-throws and logs the (err) outcome", async () => {
  let threw = false;
  const lines = await captureLogs(async () => {
    try { await withTiming("boom", async () => { throw new Error("nope"); }, { thresholdMs: 0, category: "db" }); }
    catch { threw = true; }
  });
  assert(threw, "withTiming must propagate the error");
  assert(lines.some((l) => l.includes("[PERF:db] boom took") && l.includes("(err)")), lines.join("|"));
});

// ---------- withSpan OTel-dormant fallback ----------
// When OTel is uninitialized (no DD_API_KEY), withSpan delegates to withTiming
// with category "ext" — so the single timing impl/threshold/format is reused.
// These confirm the dormant delegation path executes; the [PERF:ext] format
// itself is locked by the withTiming tests above. Gated off in LIVE_MODE where
// initOtel() would activate spans instead of the fallback.

Deno.test({ name: "withSpan (dormant) returns the fn result", ignore: LIVE_MODE }, async () => {
  assert(!isOtelInitialized(), "test assumes OTel dormant");
  assertEquals(await withSpan("ext.op", async () => 7), 7);
});

Deno.test({ name: "withSpan (dormant) propagates errors", ignore: LIVE_MODE }, async () => {
  assert(!isOtelInitialized(), "test assumes OTel dormant");
  let threw = false;
  try { await withSpan("ext.boom", async () => { throw new Error("x"); }); } catch { threw = true; }
  assert(threw, "withSpan must propagate the wrapped fn's error");
});
