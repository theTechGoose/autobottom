import { Module } from "@danet/core";
import { QuestionLabController } from "@question-lab/entrypoints/question-lab/mod.ts";

@Module({
  controllers: [QuestionLabController],
  injectables: [],
})
export class QuestionLabModule {}
