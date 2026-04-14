import { Module } from "@danet/core";
import { JudgeController } from "@judge/entrypoints/judge/mod.ts";

@Module({
  controllers: [JudgeController],
  injectables: [],
})
export class JudgeModule {}
