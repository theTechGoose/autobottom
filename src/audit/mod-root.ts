import { Module } from "@danet/core";
import { AuditController } from "@audit/entrypoints/audit/mod.ts";
import { StepController } from "@audit/entrypoints/step/mod.ts";

// Re-export business logic for consumers
export { applyBonusFlips, calculateScore, getAutoCompleteReason } from "@audit/domain/business/scoring/mod.ts";
export type { ScoringQuestion, BonusFlipResult } from "@audit/domain/business/scoring/mod.ts";
export {
  CHARGEBACK_QUESTIONS, computeFailedQuestions, splitHeaders,
  buildChargebackEntry, buildWireDeductionEntry, classifyChargebacks, isOfficeBypassed,
} from "@audit/domain/business/chargeback-engine/mod.ts";
export type { FailedQuestion } from "@audit/domain/business/chargeback-engine/mod.ts";

@Module({
  controllers: [AuditController, StepController],
  injectables: [],
})
export class AuditModule {}
/** Pipeline step barrel — re-exports all 12 step handlers. */
export { stepInit } from "@audit/domain/business/step-init/mod.ts";
export { stepTranscribe } from "@audit/domain/business/step-transcribe/mod.ts";
export { stepTranscribeCb } from "@audit/domain/business/step-transcribe-cb/mod.ts";
export { stepPollTranscript } from "@audit/domain/business/step-poll-transcript/mod.ts";
export { stepDiarizeAsync } from "@audit/domain/business/step-diarize-async/mod.ts";
export { stepPineconeAsync } from "@audit/domain/business/step-pinecone-async/mod.ts";
export { stepPrepare } from "@audit/domain/business/step-prepare/mod.ts";
export { stepAskBatch } from "@audit/domain/business/step-ask-batch/mod.ts";
export { stepAskAll } from "@audit/domain/business/step-ask-all/mod.ts";
export { stepFinalize } from "@audit/domain/business/step-finalize/mod.ts";
export { stepCleanup } from "@audit/domain/business/step-cleanup/mod.ts";
export { stepBadWordCheck } from "@audit/domain/business/step-bad-word-check/mod.ts";
