import "reflect-metadata";
import { Module } from "@danet/core";
import { CoreModule } from "../core/core.module.ts";
import { AuthModule } from "../auth/auth.module.ts";
import { AgentCoordinator } from "./domain/coordinators/agent/mod.ts";
import { AgentController } from "./entrypoints/agent/mod.ts";

@Module({
  imports: [CoreModule, AuthModule],
  injectables: [AgentCoordinator],
  controllers: [AgentController],
})
export class AgentModule {}
