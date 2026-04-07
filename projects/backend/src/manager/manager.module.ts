import "reflect-metadata";
import { Module } from "@danet/core";
import { CoreModule } from "../core/core.module.ts";
import { AuthModule } from "../auth/auth.module.ts";
import { ManagerCoordinator } from "./domain/coordinators/manager/mod.ts";
import { ManagerController } from "./entrypoints/manager/mod.ts";

@Module({
  imports: [CoreModule, AuthModule],
  injectables: [ManagerCoordinator],
  controllers: [ManagerController],
})
export class ManagerModule {}
