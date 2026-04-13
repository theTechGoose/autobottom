/**
 * OpenTelemetry → Datadog (Option A: programmatic, no OTEL_* env vars).
 *
 * Why programmatic instead of env-var-driven:
 * Deno Deploy blocks every env var starting with OTEL_ (and most DENO_),
 * so the standard SDK bootstrap that reads OTEL_EXPORTER_OTLP_* is unusable.
 * We build TracerProvider / MeterProvider / LoggerProvider by hand and read
 * config from DD_* vars that Deno Deploy does allow.
 *
 * Datadog direct OTLP intake:
 *   traces  → https://otlp.<site>/v1/traces   (Preview — may 404 until CSM enables)
 *   metrics → https://otlp.<site>/v1/metrics  (GA, requires DELTA temporality)
 *   logs    → https://otlp.<site>/v1/logs     (GA, protobuf only)
 * Header: dd-api-key: <key>
 */

import {
  trace,
  metrics,
  SpanStatusCode,
  diag,
  DiagConsoleLogger,
  DiagLogLevel,
  type Span,
  type Tracer,
} from "npm:@opentelemetry/api@^1.9.0";
import { logs } from "npm:@opentelemetry/api-logs@^0.57.0";
import { Resource } from "npm:@opentelemetry/resources@^1.30.0";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
} from "npm:@opentelemetry/sdk-trace-base@^1.30.0";
import { OTLPTraceExporter } from "npm:@opentelemetry/exporter-trace-otlp-proto@^0.57.0";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  AggregationTemporality,
} from "npm:@opentelemetry/sdk-metrics@^1.30.0";
import { OTLPMetricExporter } from "npm:@opentelemetry/exporter-metrics-otlp-proto@^0.57.0";
import {
  LoggerProvider,
  BatchLogRecordProcessor,
} from "npm:@opentelemetry/sdk-logs@^0.57.0";
import { OTLPLogExporter } from "npm:@opentelemetry/exporter-logs-otlp-proto@^0.57.0";

import { env } from "../env.ts";

const SERVICE_NAME = "autobottom";

let _tracer: Tracer | null = null;
let _shutdown: (() => Promise<void>) | null = null;

export function initOtel(): void {
  if (_tracer) return;
  if (!env.ddApiKey) {
    console.warn("⚠️  OTel disabled: DD_API_KEY not set");
    return;
  }

  // Diagnostic logger — surface exporter errors (HTTP status, protobuf errors,
  // network failures) to Deno Deploy logs. Without this the SDK swallows them.
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);

  const base = `https://otlp.${env.ddSite}`;
  const headers = { "dd-api-key": env.ddApiKey };

  const resource = new Resource({
    "service.name": SERVICE_NAME,
    "deployment.environment": env.appEnv,
  });

  // ---- Traces ----
  const traceExporter = new OTLPTraceExporter({
    url: `${base}/v1/traces`,
    headers,
  });
  const tracerProvider = new BasicTracerProvider({ resource });
  tracerProvider.addSpanProcessor(
    new BatchSpanProcessor(traceExporter, {
      scheduledDelayMillis: 1000,
      maxExportBatchSize: 128,
    }),
  );
  tracerProvider.register();

  // ---- Metrics (DELTA temporality — Datadog rejects cumulative) ----
  const metricExporter = new OTLPMetricExporter({
    url: `${base}/v1/metrics`,
    headers,
    temporalityPreference: AggregationTemporality.DELTA,
  });
  const meterProvider = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: 10_000,
      }),
    ],
  });
  metrics.setGlobalMeterProvider(meterProvider);

  // ---- Logs ----
  const logExporter = new OTLPLogExporter({
    url: `${base}/v1/logs`,
    headers,
  });
  const loggerProvider = new LoggerProvider({ resource });
  loggerProvider.addLogRecordProcessor(
    new BatchLogRecordProcessor(logExporter, { scheduledDelayMillis: 1000 }),
  );
  logs.setGlobalLoggerProvider(loggerProvider);

  _tracer = trace.getTracer(SERVICE_NAME);
  _shutdown = async () => {
    await Promise.allSettled([
      tracerProvider.shutdown(),
      meterProvider.shutdown(),
      loggerProvider.shutdown(),
    ]);
  };

  console.log(`🚀 OTel initialized → ${base}`);
}

/**
 * Wrap an async function in a span. If OTel is disabled, runs the function
 * directly with a no-op span so call sites never need to branch on enabled state.
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T> | T,
  attrs?: Record<string, string | number | boolean>,
): Promise<T> {
  if (!_tracer) return await fn(NOOP_SPAN);
  return await _tracer.startActiveSpan(
    name,
    { attributes: attrs },
    async (span) => {
      try {
        const out = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return out;
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: (err as Error)?.message ?? String(err),
        });
        throw err;
      } finally {
        span.end();
      }
    },
  );
}

export function getTracer(): Tracer | null {
  return _tracer;
}

export async function shutdownOtel(): Promise<void> {
  if (_shutdown) await _shutdown();
}

const NOOP_SPAN: Span = {
  spanContext: () => ({
    traceId: "00000000000000000000000000000000",
    spanId: "0000000000000000",
    traceFlags: 0,
  }),
  setAttribute: () => NOOP_SPAN,
  setAttributes: () => NOOP_SPAN,
  addEvent: () => NOOP_SPAN,
  addLink: () => NOOP_SPAN,
  addLinks: () => NOOP_SPAN,
  setStatus: () => NOOP_SPAN,
  updateName: () => NOOP_SPAN,
  end: () => {},
  isRecording: () => false,
  recordException: () => {},
} as unknown as Span;
