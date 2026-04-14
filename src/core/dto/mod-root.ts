
// Re-export core components for consumers
export { KvRepository } from "@core/business/repository-base/mod.ts";
export type { OrgId, SetOptions } from "@core/business/repository-base/mod.ts";
export { getKv, orgKey, resetKv } from "@core/data/deno-kv/mod.ts";
export { S3Ref } from "@core/data/s3/mod.ts";
export * from "@core/business/auth/mod.ts";
export { AuthGuard, getAuthFromContext, resolveOrgId } from "@core/business/auth/mod.ts";
export * from "@core/data/qstash/mod.ts";
export * from "@core/dto/types.ts";

// Datadog OTel
export {
  initOtel,
  isOtelInitialized,
  withSpan,
  withRequest,
  runStep,
  log as otelLog,
  metric,
  flushOtel,
  shutdownOtel,
  verifyDatadogIntake,
  type Span,
  type ProbeResult,
} from "@core/data/datadog-otel/mod.ts";

