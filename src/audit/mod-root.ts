import { Module } from "@danet/core";
import { AuditController } from "@audit/entrypoints/audit-controller.ts";
import { StepController } from "@audit/entrypoints/step-controller.ts";

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
