import "reflect-metadata";
import { Module } from "@danet/core";
import { CoreModule } from "../core/core.module.ts";
import { AuthModule } from "../auth/auth.module.ts";
import { QuestionLabCoordinator } from "./domain/coordinators/question-lab/mod.ts";
import { QuestionLabController } from "./entrypoints/question-lab/mod.ts";

@Module({
  imports: [CoreModule, AuthModule],
  injectables: [QuestionLabCoordinator],
  controllers: [QuestionLabController],
})
export class QuestionLabModule {}
