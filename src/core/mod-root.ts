import { Module } from "@danet/core";

// Re-export core components for consumers
export { KvRepository } from "@core/domain/business/repository-base/mod.ts";
export type { OrgId, SetOptions } from "@core/domain/business/repository-base/mod.ts";
export { getKv, orgKey, resetKv } from "@core/domain/data/deno-kv/mod.ts";
export { S3Ref } from "@core/domain/data/s3/mod.ts";
export * from "@core/domain/business/auth/mod.ts";
export * from "@core/domain/data/qstash/mod.ts";
export * from "@core/dto/types.ts";

@Module({
  controllers: [],
  injectables: [],
})
export class CoreModule {}
