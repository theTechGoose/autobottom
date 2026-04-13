import { Module } from "@danet/core";
import { QuestionLabController } from "@question-lab/entrypoints/question-lab-controller.ts";

@Module({
  controllers: [QuestionLabController],
  injectables: [],
})
export class QuestionLabModule {}
