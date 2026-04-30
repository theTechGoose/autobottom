import { Module } from "@danet/core";
import { AdminConfigController } from "@admin/entrypoints/admin/mod.ts";
import { UserController } from "@admin/entrypoints/user/mod.ts";
import { WebhookController } from "@admin/entrypoints/webhook/mod.ts";
import { DashboardController } from "@admin/entrypoints/dashboard/mod.ts";
import { MigrationController } from "@admin/entrypoints/migration/mod.ts";

@Module({
  controllers: [AdminConfigController, UserController, WebhookController, DashboardController, MigrationController],
  injectables: [],
})
export class AdminModule {}
