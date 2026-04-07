import "reflect-metadata";
import { Module } from "@danet/core";
import { CoreModule } from "../core/core.module.ts";
import { AuthModule } from "../auth/auth.module.ts";
import { JudgeCoordinator } from "./domain/coordinators/judge/mod.ts";
import { JudgeController } from "./entrypoints/judge/mod.ts";

@Module({
  imports: [CoreModule, AuthModule],
  injectables: [JudgeCoordinator],
  controllers: [JudgeController],
})
export class JudgeModule {}
