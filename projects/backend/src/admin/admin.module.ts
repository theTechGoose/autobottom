import "reflect-metadata";
import { Module } from "@danet/core";
import { CoreModule } from "../core/core.module.ts";
import { AuthModule } from "../auth/auth.module.ts";
import { AdminController } from "./entrypoints/admin/mod.ts";
import { SuperAdminController } from "./entrypoints/super-admin/mod.ts";

@Module({
  imports: [CoreModule, AuthModule],
  controllers: [
    AdminController,
    SuperAdminController,
  ],
})
export class AdminModule {}
