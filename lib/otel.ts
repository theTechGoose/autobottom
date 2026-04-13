/**
 * OpenTelemetry → Datadog, hand-rolled edition.
 *
 * Background: we started with the official OTel npm SDK, but on Deno Deploy
 * it silently drops data — the SDK's "http" exporter picks a browser-flavored
 * sender that uses sendBeacon/fire-and-forget, and Deno Deploy freezes the
 * isolate before the request actually leaves. Plus Deno Deploy refuses to run
 * protobufjs's postinstall, so the -proto exporters are out too.
 *
 * So this module ignores the SDK entirely and speaks OTLP/HTTP/JSON directly
 * via Deno's native fetch. That path is already proven against DD's direct
 * OTLP intake endpoints at https://otlp.<site>/v1/{traces,metrics,logs}.
 *
 * Datadog status as of 2026-04-13:
 *   - logs intake:    GA
 *   - metrics intake: GA (requires delta temporality, which we always send)
 *   - traces intake:  Preview — 202-accepts but does not index until DD CSM
 *     flips the preview flag on the org. Same code path will work once enabled.
 *
 * Usage:
 *   initOtel();                              // once at startup
 *   log("info", "hello", { user: "adam" }); // queue a log record
 *   metric("audit.started", 1);             // queue a counter increment
 *   await withSpan("step.init", async (span) => {
 *     span.setAttribute("rid", 123);
 *     // ...work...
 *   });
 *   await flushOtel();                       // drain all queues; call before
 *                                             // returning from request handlers
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { env } from "../env.ts";

const SERVICE_NAME = "autobottom";
const SCOPE_NAME = "autobottom";

/** Per-request/per-async-context storage so child spans find their parent. */
const _spanContext = new AsyncLocalStorage<Span>();

// ---------- Types ----------

type AttrVal = string | number | boolean;
type AttrMap = Record<string, AttrVal>;

interface OtlpAttr {
  key: string;
  value:
    | { stringValue: string }
    | { intValue: string }
    | { doubleValue: number }
    | { boolValue: boolean };
}

interface LogRecord {
  timeUnixNano: string;
  severityNumber: number;
  severityText: string;
  body: string;
  attributes: AttrMap;
  traceId?: string;
  spanId?: string;
}

interface MetricPoint {
  name: string;
  startTimeUnixNano: string;
  timeUnixNano: string;
  value: number;
  attributes: AttrMap;
}

interface SpanRecord {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number; // 1=INTERNAL 2=SERVER 3=CLIENT
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: AttrMap;
  status: { code: number; message?: string }; // 0=UNSET 1=OK 2=ERROR
  events: Array<{ name: string; timeUnixNano: string; attributes: AttrMap }>;
}

export interface Span {
  readonly traceId: string;
  readonly spanId: string;
  setAttribute(key: string, value: AttrVal): Span;
  setAttributes(attrs: AttrMap): Span;
  addEvent(name: string, attrs?: AttrMap): Span;
  recordException(err: unknown): Span;
  spanContext(): { traceId: string; spanId: string; traceFlags: number };
}

// ---------- Module state ----------

let _initialized = false;
let _base = "";
let _headers: Record<string, string> = {};
let _appEnv = "prod";

const _logBuf: LogRecord[] = [];
const _metricBuf: MetricPoint[] = [];
const _spanBuf: SpanRecord[] = [];

// ---------- Init ----------

export function initOtel(): void {
  if (_initialized) return;
  if (!env.ddApiKey) {
    console.warn("⚠️  OTel disabled: DD_API_KEY not set");
    return;
  }
  _base = `https://otlp.${env.ddSite}`;
  _headers = {
    "Content-Type": "application/json",
    "dd-api-key": env.ddApiKey,
  };
  _appEnv = env.appEnv;
  _initialized = true;
  // Mirror every console.* call to DD Logs. Preserves normal console output
  // to Deno Deploy's log stream while ALSO queuing an OTLP log record for
  // shipment to DD. This is what gives us zero-touch log coverage of all
  // existing `[STEP-INIT] ...` style messages without editing any call sites.
  patchConsoleForOtel();
  console.log(`🚀 OTel initialized → ${_base}`);
}

// ---------- Public emit API ----------

export function log(
  level: "debug" | "info" | "warn" | "error",
  message: string,
  attrs: AttrMap = {},
  span?: Span,
): void {
  if (!_initialized) return;
  _logBuf.push({
    timeUnixNano: nowNs(),
    severityNumber: LEVEL_TO_SEVERITY[level],
    severityText: level.toUpperCase(),
    body: message,
    attributes: attrs,
    traceId: span?.traceId,
    spanId: span?.spanId,
  });
}

/** Record a delta counter increment. For gauges/histograms, expand later. */
export function metric(name: string, value = 1, attrs: AttrMap = {}): void {
  if (!_initialized) return;
  const now = nowNs();
  _metricBuf.push({
    name,
    startTimeUnixNano: now,
    timeUnixNano: now,
    value,
    attributes: attrs,
  });
}

/**
 * Run `fn` wrapped in a span. If OTel is disabled, runs `fn` with a no-op
 * span so call sites never need to branch on enabled state. On throw, records
 * the exception and sets status=ERROR before re-raising.
 *
 * Context propagation: if called inside another `withSpan`, the new span
 * inherits the parent's traceId and sets parentSpanId so DD renders them as
 * a single linked trace.
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T> | T,
  attrs: AttrMap = {},
  kind: "internal" | "server" | "client" = "internal",
): Promise<T> {
  if (!_initialized) {
    return await fn(NOOP_SPAN);
  }
  const parent = _spanContext.getStore();
  const traceId = parent?.traceId ?? hex(16);
  const spanId = hex(8);
  const parentSpanId = parent?.spanId;
  const startNs = nowNs();
  const spanAttrs: AttrMap = { ...attrs };
  const events: SpanRecord["events"] = [];
  let status: SpanRecord["status"] = { code: 1 }; // OK

  const span: Span = {
    traceId,
    spanId,
    setAttribute(key, value) {
      spanAttrs[key] = value;
      return span;
    },
    setAttributes(more) {
      Object.assign(spanAttrs, more);
      return span;
    },
    addEvent(eventName, eventAttrs) {
      events.push({
        name: eventName,
        timeUnixNano: nowNs(),
        attributes: eventAttrs ?? {},
      });
      return span;
    },
    recordException(err) {
      const e = err as { message?: string; stack?: string; name?: string };
      events.push({
        name: "exception",
        timeUnixNano: nowNs(),
        attributes: {
          "exception.message": e?.message ?? String(err),
          "exception.stacktrace": e?.stack ?? "",
          "exception.type": e?.name ?? "Error",
        },
      });
      return span;
    },
    spanContext() {
      return { traceId, spanId, traceFlags: 1 };
    },
  };

  return await _spanContext.run(span, async () => {
    try {
      const result = await fn(span);
      return result;
    } catch (err) {
      span.recordException(err);
      status = {
        code: 2,
        message: (err as Error)?.message ?? String(err),
      };
      throw err;
    } finally {
      _spanBuf.push({
        traceId,
        spanId,
        parentSpanId,
        name,
        kind: KIND_TO_NUMBER[kind],
        startTimeUnixNano: startNs,
        endTimeUnixNano: nowNs(),
        attributes: spanAttrs,
        status,
        events,
      });
    }
  });
}

/**
 * Middleware that wraps a Deno.serve handler with a root server span and
 * guarantees telemetry is flushed before the isolate can freeze. Usage:
 *
 *   Deno.serve(withRequest(async (req) => { ... }));
 *
 * Contributes http.method / http.route / http.status_code to the span and
 * a `autobottom.http.requests` counter metric.
 */
export function withRequest(
  handler: (req: Request) => Promise<Response> | Response,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const u = new URL(req.url);
    const route = u.pathname;
    const method = req.method;
    try {
      return await withSpan(
        `${method} ${route}`,
        async (span) => {
          span.setAttributes({
            "http.method": method,
            "http.route": route,
            "http.url": req.url,
          });
          const res = await handler(req);
          span.setAttribute("http.status_code", res.status);
          metric("autobottom.http.requests", 1, {
            method,
            route,
            status: res.status,
          });
          return res;
        },
        {},
        "server",
      );
    } finally {
      // Always flush — even on thrown errors — before the isolate freezes.
      await flushOtel();
    }
  };
}

/**
 * Wrap a pipeline step handler with a child span + step metrics. Usage:
 *
 *   "/audit/step/init": runStep("init", stepInit),
 *
 * Keeps step instrumentation uniform and one-line at every dispatch site.
 */
export function runStep(
  stepName: string,
  handler: (req: Request) => Promise<Response> | Response,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    return await withSpan(
      `step.${stepName}`,
      async (span) => {
        span.setAttribute("step.name", stepName);
        metric("autobottom.step.started", 1, { step: stepName });
        try {
          const res = await handler(req);
          if (res.status >= 500) {
            metric("autobottom.step.failed", 1, {
              step: stepName,
              reason: "5xx",
            });
            span.setAttribute("error", true);
          } else {
            metric("autobottom.step.completed", 1, { step: stepName });
          }
          return res;
        } catch (err) {
          metric("autobottom.step.failed", 1, {
            step: stepName,
            reason: "thrown",
          });
          throw err;
        }
      },
      { "step.name": stepName },
      "internal",
    );
  };
}

// ---------- Flush ----------

/**
 * Drain all three queues and POST them to Datadog. Safe to call with empty
 * queues — it no-ops. Call this before returning from any request handler
 * that may have emitted telemetry, otherwise Deno Deploy will freeze the
 * isolate and in-flight records will be lost.
 */
export async function flushOtel(): Promise<void> {
  if (!_initialized) return;
  const logs = _logBuf.splice(0);
  const metrics = _metricBuf.splice(0);
  const spans = _spanBuf.splice(0);

  if (!logs.length && !metrics.length && !spans.length) return;

  const tasks: Promise<unknown>[] = [];
  if (logs.length) tasks.push(postJson("/v1/logs", buildLogsRequest(logs)));
  if (metrics.length) {
    tasks.push(postJson("/v1/metrics", buildMetricsRequest(metrics)));
  }
  if (spans.length) tasks.push(postJson("/v1/traces", buildTracesRequest(spans)));

  const results = await Promise.allSettled(tasks);
  for (const r of results) {
    if (r.status === "rejected") {
      console.error("❌ otel flush failure:", r.reason);
    }
  }
}

export async function shutdownOtel(): Promise<void> {
  await flushOtel();
}

// ---------- HTTP ----------

async function postJson(path: string, payload: unknown): Promise<void> {
  try {
    const res = await fetch(`${_base}${path}`, {
      method: "POST",
      headers: _headers,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(
        `❌ otel POST ${path} → ${res.status} ${res.statusText}: ${body.slice(0, 300)}`,
      );
    }
  } catch (err) {
    console.error(`❌ otel POST ${path} threw:`, err);
  }
}

// ---------- OTLP payload builders ----------

function buildResource(): { attributes: OtlpAttr[] } {
  return {
    attributes: toOtlpAttrs({
      "service.name": SERVICE_NAME,
      "deployment.environment": _appEnv,
    }),
  };
}

function buildTracesRequest(spans: SpanRecord[]) {
  return {
    resourceSpans: [{
      resource: buildResource(),
      scopeSpans: [{
        scope: { name: SCOPE_NAME },
        spans: spans.map((s) => ({
          traceId: s.traceId,
          spanId: s.spanId,
          parentSpanId: s.parentSpanId,
          name: s.name,
          kind: s.kind,
          startTimeUnixNano: s.startTimeUnixNano,
          endTimeUnixNano: s.endTimeUnixNano,
          attributes: toOtlpAttrs(s.attributes),
          events: s.events.map((e) => ({
            name: e.name,
            timeUnixNano: e.timeUnixNano,
            attributes: toOtlpAttrs(e.attributes),
          })),
          status: s.status,
        })),
      }],
    }],
  };
}

function buildLogsRequest(logs: LogRecord[]) {
  return {
    resourceLogs: [{
      resource: buildResource(),
      scopeLogs: [{
        scope: { name: SCOPE_NAME },
        logRecords: logs.map((l) => ({
          timeUnixNano: l.timeUnixNano,
          observedTimeUnixNano: l.timeUnixNano,
          severityNumber: l.severityNumber,
          severityText: l.severityText,
          body: { stringValue: l.body },
          attributes: toOtlpAttrs(l.attributes),
          traceId: l.traceId,
          spanId: l.spanId,
        })),
      }],
    }],
  };
}

function buildMetricsRequest(metrics: MetricPoint[]) {
  // One OTLP Metric per data point — simple but correct. Aggregation can
  // happen server-side. Switch to name-grouped dataPoints later if volume
  // becomes an issue.
  return {
    resourceMetrics: [{
      resource: buildResource(),
      scopeMetrics: [{
        scope: { name: SCOPE_NAME },
        metrics: metrics.map((m) => ({
          name: m.name,
          unit: "1",
          sum: {
            aggregationTemporality: 1, // DELTA (required by DD metrics intake)
            isMonotonic: true,
            dataPoints: [{
              startTimeUnixNano: m.startTimeUnixNano,
              timeUnixNano: m.timeUnixNano,
              asDouble: m.value,
              attributes: toOtlpAttrs(m.attributes),
            }],
          },
        })),
      }],
    }],
  };
}

// ---------- Console patching ----------

/**
 * Hooks console.log/info/warn/error so every call is:
 *  (a) printed to Deno Deploy's log stream as normal (via the original fn)
 *  (b) queued as an OTLP log record for shipment to DD
 *
 * Uses a reentry guard so the OTel module's own console.error calls (e.g. on
 * flush failure) cannot recurse into the capture path. Arg formatting handles
 * strings, Errors, and JSON-serializable objects; non-serializable values fall
 * back to String().
 */
let _inCapture = false;
function patchConsoleForOtel(): void {
  type Method = "log" | "info" | "warn" | "error" | "debug";
  const mapping: Array<{ method: Method; level: "debug" | "info" | "warn" | "error" }> = [
    { method: "debug", level: "debug" },
    { method: "log",   level: "info" },
    { method: "info",  level: "info" },
    { method: "warn",  level: "warn" },
    { method: "error", level: "error" },
  ];

  for (const { method, level } of mapping) {
    // deno-lint-ignore no-explicit-any
    const original = ((console as any)[method] as (...args: unknown[]) => void).bind(console);
    // deno-lint-ignore no-explicit-any
    (console as any)[method] = (...args: unknown[]): void => {
      original(...args);
      if (_inCapture) return;
      _inCapture = true;
      try {
        const parent = _spanContext.getStore();
        _logBuf.push({
          timeUnixNano: nowNs(),
          severityNumber: LEVEL_TO_SEVERITY[level],
          severityText: level.toUpperCase(),
          body: args.map(formatConsoleArg).join(" "),
          attributes: { "log.source": "console" },
          traceId: parent?.traceId,
          spanId: parent?.spanId,
        });
      } catch {
        /* never let logging break the app */
      } finally {
        _inCapture = false;
      }
    };
  }
}

function formatConsoleArg(a: unknown): string {
  if (typeof a === "string") return a;
  if (a instanceof Error) return `${a.name}: ${a.message}${a.stack ? "\n" + a.stack : ""}`;
  if (typeof a === "undefined") return "undefined";
  if (a === null) return "null";
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

// ---------- Primitives ----------

function toOtlpAttrs(attrs: AttrMap): OtlpAttr[] {
  return Object.entries(attrs).map(([key, value]) => ({ key, value: toOtlpValue(value) }));
}

function toOtlpValue(v: AttrVal): OtlpAttr["value"] {
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { boolValue: v };
  if (Number.isInteger(v)) return { intValue: v.toString() };
  return { doubleValue: v };
}

function nowNs(): string {
  return (BigInt(Date.now()) * 1_000_000n).toString();
}

function hex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

const LEVEL_TO_SEVERITY = {
  debug: 5,
  info: 9,
  warn: 13,
  error: 17,
} as const;

const KIND_TO_NUMBER = {
  internal: 1,
  server: 2,
  client: 3,
} as const;

const NOOP_SPAN: Span = {
  traceId: "00000000000000000000000000000000",
  spanId: "0000000000000000",
  setAttribute() { return NOOP_SPAN; },
  setAttributes() { return NOOP_SPAN; },
  addEvent() { return NOOP_SPAN; },
  recordException() { return NOOP_SPAN; },
  spanContext() {
    return {
      traceId: "00000000000000000000000000000000",
      spanId: "0000000000000000",
      traceFlags: 0,
    };
  },
};
