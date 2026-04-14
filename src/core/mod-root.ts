import { Module } from "@danet/core";
import { AuthController } from "@core/business/auth/controller.ts";

// Re-export core components for consumers
export { KvRepository } from "@core/business/repository-base/mod.ts";
export type { OrgId, SetOptions } from "@core/business/repository-base/mod.ts";
export { getKv, orgKey, resetKv } from "@core/data/deno-kv/mod.ts";
export { S3Ref } from "@core/data/s3/mod.ts";
export * from "@core/business/auth/mod.ts";
export { AuthGuard, getAuthFromContext, resolveOrgId } from "@core/business/auth/guard.ts";
export * from "@core/data/qstash/mod.ts";
export * from "@core/dto/types.ts";

@Module({
  controllers: [AuthController],
  injectables: [],
})
export class CoreModule {}
