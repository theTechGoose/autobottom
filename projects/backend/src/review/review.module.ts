import "reflect-metadata";
import { Module } from "@danet/core";
import { CoreModule } from "../core/core.module.ts";
import { AuthModule } from "../auth/auth.module.ts";
import { ReviewCoordinator } from "./domain/coordinators/review/mod.ts";
import { ReviewController } from "./entrypoints/review/mod.ts";

@Module({
  imports: [CoreModule, AuthModule],
  injectables: [ReviewCoordinator],
  controllers: [ReviewController],
})
export class ReviewModule {}
