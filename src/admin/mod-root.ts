import { Module } from "@danet/core";
import { AdminConfigController } from "@admin/entrypoints/admin-controller.ts";
import { UserController } from "@admin/entrypoints/user-controller.ts";
import { WebhookController } from "@admin/entrypoints/webhook-controller.ts";
import { DashboardController } from "@admin/entrypoints/dashboard-controller.ts";

@Module({
  controllers: [AdminConfigController, UserController, WebhookController, DashboardController],
  injectables: [],
})
export class AdminModule {}
