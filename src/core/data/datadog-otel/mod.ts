/**
 * Datadog OpenTelemetry adapter — hand-rolled OTLP/HTTP/JSON over native fetch.
 *
 * Why hand-rolled instead of the npm @opentelemetry SDK:
 *   1. Deno Deploy blocks every env var starting with OTEL_, so the SDK's
 *      env-var bootstrap path is unusable.
 *   2. The SDK's -proto exporters depend on protobufjs which requires a
 *      postinstall script Deno Deploy refuses to run.
 *   3. The SDK's -http exporters use browser-sniffing that routes through
 *      navigator.sendBeacon on Deno, which is fire-and-forget and silently
 *      drops data when the Deno Deploy isolate freezes.
 *
 * This module:
 *   - Reads config lazily from DD_API_KEY / DD_SITE / APP_ENV env vars
 *   - Builds OTLP/JSON payloads by hand and POSTs them via Deno's native fetch
 *   - Uses AsyncLocalStorage so nested withSpan() calls link as one trace
 *   - Patches console.* to mirror every console call into OTel logs (so
 *     existing [STEP-INIT] / [GENIE] / etc. logs flow to DD without edits)
 *   - Forces flush in the request middleware's finally so data leaves the
 *     isolate before Deno Deploy freezes it
 *   - Exposes verifyDatadogIntake() for runtime health-checking
 *
 * Datadog endpoints (US5):
 *   logs    — https://otlp.us5.datadoghq.com/v1/logs     [GA]
 *   metrics — https://otlp.us5.datadoghq.com/v1/metrics  [GA, requires DELTA temporality]
 *   traces  — https://otlp.us5.datadoghq.com/v1/traces   [Preview — 202s but
 *             does not index until DD CSM enables the preview flag on the org]
 *
 * Auth header: dd-api-key: <key>
 */

import { AsyncLocalStorage } from "node:async_hooks";

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
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: AttrMap;
  status: { code: number; message?: string };
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

export interface ProbeResult {
  configured: boolean;
  site: string;
  results: Array<{
    target: "logs" | "metrics" | "traces";
    url: string;
    status?: number;
    statusText?: string;
    body?: string;
    error?: string;
    ok: boolean;
  }>;
}

// ---------- Module state ----------

const _spanContext = new AsyncLocalStorage<Span>();

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
  const apiKey = Deno.env.get("DD_API_KEY") ?? "";
  if (!apiKey) {
    console.warn("⚠️  Datadog OTel disabled: DD_API_KEY not set");
    return;
  }
  const site = Deno.env.get("DD_SITE") ?? "us5.datadoghq.com";
  _base = `https://otlp.${site}`;
  _headers = {
    "Content-Type": "application/json",
    "dd-api-key": apiKey,
  };
  _appEnv = Deno.env.get("APP_ENV") ?? "prod";
  _initialized = true;
  patchConsoleForOtel();
  console.log(`🚀 Datadog OTel initialized → ${_base}`);
}

export function isOtelInitialized(): boolean {
  return _initialized;
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
  let status: SpanRecord["status"] = { code: 1 };

  const span: Span = {
    traceId,
    spanId,
    setAttribute(key, value) { spanAttrs[key] = value; return span; },
    setAttributes(more) { Object.assign(spanAttrs, more); return span; },
    addEvent(eventName, eventAttrs) {
      events.push({ name: eventName, timeUnixNano: nowNs(), attributes: eventAttrs ?? {} });
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
    spanContext() { return { traceId, spanId, traceFlags: 1 }; },
  };

  return await _spanContext.run(span, async () => {
    try {
      return await fn(span);
    } catch (err) {
      span.recordException(err);
      status = { code: 2, message: (err as Error)?.message ?? String(err) };
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
          metric("autobottom.http.requests", 1, { method, route, status: res.status });
          return res;
        },
        {},
        "server",
      );
    } finally {
      await flushOtel();
    }
  };
}

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
            metric("autobottom.step.failed", 1, { step: stepName, reason: "5xx" });
            span.setAttribute("error", true);
          } else {
            metric("autobottom.step.completed", 1, { step: stepName });
          }
          return res;
        } catch (err) {
          metric("autobottom.step.failed", 1, { step: stepName, reason: "thrown" });
          throw err;
        }
      },
      { "step.name": stepName },
      "internal",
    );
  };
}

// ---------- Flush ----------

export async function flushOtel(): Promise<void> {
  if (!_initialized) return;
  const logs = _logBuf.splice(0);
  const metrics = _metricBuf.splice(0);
  const spans = _spanBuf.splice(0);

  if (!logs.length && !metrics.length && !spans.length) return;

  const tasks: Promise<unknown>[] = [];
  if (logs.length) tasks.push(postJson("/v1/logs", buildLogsRequest(logs)));
  if (metrics.length) tasks.push(postJson("/v1/metrics", buildMetricsRequest(metrics)));
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

// ---------- Runtime verification ----------

export async function verifyDatadogIntake(): Promise<ProbeResult> {
  const apiKey = Deno.env.get("DD_API_KEY") ?? "";
  const site = Deno.env.get("DD_SITE") ?? "us5.datadoghq.com";
  if (!apiKey) {
    return { configured: false, site, results: [] };
  }
  const base = `https://otlp.${site}`;
  const headers = {
    "Content-Type": "application/json",
    "dd-api-key": apiKey,
  };

  const marker = crypto.randomUUID();
  const nowNsStr = nowNs();
  const startNsStr = (BigInt(nowNsStr) - 5_000_000n).toString();
  const resource = {
    attributes: toOtlpAttrs({
      "service.name": SERVICE_NAME,
      "deployment.environment": Deno.env.get("APP_ENV") ?? "prod",
      "test.marker": marker,
    }),
  };

  const logsPayload = {
    resourceLogs: [{
      resource,
      scopeLogs: [{
        scope: { name: SCOPE_NAME },
        logRecords: [{
          timeUnixNano: nowNsStr,
          observedTimeUnixNano: nowNsStr,
          severityNumber: 9,
          severityText: "INFO",
          body: { stringValue: `verifyDatadogIntake marker=${marker}` },
          attributes: toOtlpAttrs({ "test.marker": marker }),
        }],
      }],
    }],
  };

  const metricsPayload = {
    resourceMetrics: [{
      resource,
      scopeMetrics: [{
        scope: { name: SCOPE_NAME },
        metrics: [{
          name: "autobottom.verify.intake",
          unit: "1",
          sum: {
            aggregationTemporality: 1,
            isMonotonic: true,
            dataPoints: [{
              startTimeUnixNano: startNsStr,
              timeUnixNano: nowNsStr,
              asDouble: 1,
              attributes: toOtlpAttrs({ "test.marker": marker }),
            }],
          },
        }],
      }],
    }],
  };

  const tracesPayload = {
    resourceSpans: [{
      resource,
      scopeSpans: [{
        scope: { name: SCOPE_NAME },
        spans: [{
          traceId: hex(16),
          spanId: hex(8),
          name: "verifyDatadogIntake",
          kind: 2,
          startTimeUnixNano: startNsStr,
          endTimeUnixNano: nowNsStr,
          attributes: toOtlpAttrs({ "test.marker": marker }),
          status: { code: 1 },
        }],
      }],
    }],
  };

  const targets: Array<{ target: "logs" | "metrics" | "traces"; path: string; body: unknown }> = [
    { target: "logs",    path: "/v1/logs",    body: logsPayload },
    { target: "metrics", path: "/v1/metrics", body: metricsPayload },
    { target: "traces",  path: "/v1/traces",  body: tracesPayload },
  ];

  const results: ProbeResult["results"] = [];
  for (const t of targets) {
    try {
      const res = await fetch(`${base}${t.path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(t.body),
      });
      const body = await res.text();
      results.push({
        target: t.target,
        url: `${base}${t.path}`,
        status: res.status,
        statusText: res.statusText,
        body: body.slice(0, 500),
        ok: res.ok,
      });
    } catch (err) {
      results.push({
        target: t.target,
        url: `${base}${t.path}`,
        error: (err as Error)?.message ?? String(err),
        ok: false,
      });
    }
  }

  return { configured: true, site, results };
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
  return {
    resourceMetrics: [{
      resource: buildResource(),
      scopeMetrics: [{
        scope: { name: SCOPE_NAME },
        metrics: metrics.map((m) => ({
          name: m.name,
          unit: "1",
          sum: {
            aggregationTemporality: 1,
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
      } catch { /* never let logging break the app */ }
      finally { _inCapture = false; }
    };
  }
}

function formatConsoleArg(a: unknown): string {
  if (typeof a === "string") return a;
  if (a instanceof Error) return `${a.name}: ${a.message}${a.stack ? "\n" + a.stack : ""}`;
  if (typeof a === "undefined") return "undefined";
  if (a === null) return "null";
  try { return JSON.stringify(a); }
  catch { return String(a); }
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
