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

import { env } from "../env.ts";

const SERVICE_NAME = "autobottom";
const SCOPE_NAME = "autobottom";

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
  const traceId = hex(16);
  const spanId = hex(8);
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
      name,
      kind: KIND_TO_NUMBER[kind],
      startTimeUnixNano: startNs,
      endTimeUnixNano: nowNs(),
      attributes: spanAttrs,
      status,
      events,
    });
  }
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
