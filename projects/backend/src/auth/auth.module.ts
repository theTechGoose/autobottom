import "reflect-metadata";
import { Module } from "@danet/core";
import { CoreModule } from "../core/core.module.ts";
import { AuthCoordinator } from "./domain/coordinators/auth/mod.ts";
import { SessionGuard } from "./domain/business/session-guard/mod.ts";
import { AdminGuard } from "./domain/business/admin-guard/mod.ts";
import { SuperAdminGuard } from "./domain/business/super-admin-guard/mod.ts";
import { AuthController } from "./entrypoints/auth/mod.ts";

@Module({
  imports: [CoreModule],
  injectables: [AuthCoordinator, SessionGuard, AdminGuard, SuperAdminGuard],
  controllers: [AuthController],
})
export class AuthModule {}
