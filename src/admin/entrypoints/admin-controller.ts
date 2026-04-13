/** Admin config + pipeline management controller. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body, Query } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";

@SwaggerDescription("Admin — pipeline config, settings, queue management, backfills")
@Controller("admin")
export class AdminConfigController {

  // -- Pipeline config --
  @Get("pipeline-config")
  async getPipelineConfig() { return { maxRetries: 5, retryDelaySeconds: 10, parallelism: 20 }; }

  @Post("pipeline-config")
  async setPipelineConfig(@Body() body: Record<string, any>) { return { ok: true }; }

  @Get("parallelism")
  async getParallelism() { return { parallelism: 20 }; }

  @Post("parallelism")
  async setParallelism(@Body() body: { parallelism: number }) { return { ok: true }; }

  // -- Webhook settings (7 kinds) --
  @Get("settings/terminate")
  async getTerminateSettings() { return {}; }
  @Post("settings/terminate")
  async saveTerminateSettings(@Body() body: Record<string, any>) { return { ok: true }; }

  @Get("settings/appeal")
  async getAppealSettings() { return {}; }
  @Post("settings/appeal")
  async saveAppealSettings(@Body() body: Record<string, any>) { return { ok: true }; }

  @Get("settings/manager")
  async getManagerSettings() { return {}; }
  @Post("settings/manager")
  async saveManagerSettings(@Body() body: Record<string, any>) { return { ok: true }; }

  @Get("settings/review")
  async getReviewSettings() { return {}; }
  @Post("settings/review")
  async saveReviewSettings(@Body() body: Record<string, any>) { return { ok: true }; }

  @Get("settings/judge")
  async getJudgeSettings() { return {}; }
  @Post("settings/judge")
  async saveJudgeSettings(@Body() body: Record<string, any>) { return { ok: true }; }

  @Get("settings/judge-finish")
  async getJudgeFinishSettings() { return {}; }
  @Post("settings/judge-finish")
  async saveJudgeFinishSettings(@Body() body: Record<string, any>) { return { ok: true }; }

  @Get("settings/re-audit-receipt")
  async getReAuditReceiptSettings() { return {}; }
  @Post("settings/re-audit-receipt")
  async saveReAuditReceiptSettings(@Body() body: Record<string, any>) { return { ok: true }; }

  @Get("settings/gamification")
  async getGamificationSettings() { return {}; }
  @Post("settings/gamification")
  async saveGamificationSettings(@Body() body: Record<string, any>) { return { ok: true }; }

  // -- Bad words / bonus / bypass --
  @Get("bad-word-config")
  async getBadWordConfig() { return { enabled: false, emails: [], words: [] }; }
  @Post("bad-word-config")
  async saveBadWordConfig(@Body() body: Record<string, any>) { return { ok: true }; }

  @Get("bonus-points-config")
  async getBonusPointsConfig() { return { internalBonusPoints: 0, partnerBonusPoints: 0 }; }
  @Post("bonus-points-config")
  async saveBonusPointsConfig(@Body() body: Record<string, any>) { return { ok: true }; }

  @Get("office-bypass")
  async getOfficeBypass() { return { patterns: [] }; }
  @Post("office-bypass")
  async saveOfficeBypass(@Body() body: Record<string, any>) { return { ok: true }; }

  // -- Dimensions --
  @Get("audit-dimensions")
  async getAuditDimensions() { return { departments: [], shifts: [] }; }
  @Post("audit-dimensions")
  async saveAuditDimensions(@Body() body: Record<string, any>) { return { ok: true }; }

  @Get("partner-dimensions")
  async getPartnerDimensions() { return { offices: {} }; }

  // -- Manager scopes --
  @Get("manager-scopes")
  async getManagerScopes() { return {}; }
  @Post("manager-scopes")
  async saveManagerScope(@Body() body: Record<string, any>) { return { ok: true }; }

  // -- Queue management --
  @Get("queues")
  async getQueues() { return {}; }
  @Post("queues")
  async setQueue(@Body() body: Record<string, any>) { return { ok: true }; }

  @Post("pause-queues")
  async pauseQueues() { return { ok: true }; }
  @Post("resume-queues")
  async resumeQueues() { return { ok: true }; }

  @Post("clear-review-queue")
  async clearReviewQueue() { return { ok: true }; }
  @Post("clear-errors")
  async clearErrors() { return { ok: true }; }

  // -- Pipeline operations --
  @Post("retry-finding")
  async retryFinding(@Body() body: { findingId: string }) { return { ok: true }; }
  @Get("retry-finding")
  async retryFindingGet(@Query("findingId") findingId: string) { return { ok: true }; }

  @Post("terminate-finding")
  async terminateFinding(@Body() body: { findingId: string }) { return { ok: true }; }
  @Post("terminate-all")
  async terminateAll() { return { ok: true }; }

  @Post("reset-finding")
  async resetFinding(@Body() body: Record<string, any>) { return { ok: true }; }
  @Post("flip-answer")
  async flipAnswer(@Body() body: Record<string, any>) { return { ok: true }; }
  @Post("bulk-flip")
  async bulkFlip(@Body() body: Record<string, any>) { return { ok: true }; }

  // -- Backfills --
  @Post("backfill-review-scores")
  async backfillReviewScores(@Body() body: Record<string, any>) { return { ok: true }; }
  @Post("backfill-chargeback-entries")
  async backfillChargebackEntries(@Body() body: Record<string, any>) { return { ok: true }; }
  @Post("backfill-partner-dimensions")
  async backfillPartnerDimensions(@Body() body: Record<string, any>) { return { ok: true }; }
  @Post("backfill-audit-index")
  async backfillAuditIndex(@Body() body: Record<string, any>) { return { ok: true }; }
  @Post("backfill-stale-scores")
  async backfillStaleScores(@Body() body: Record<string, any>) { return { ok: true }; }
  @Post("deduplicate-findings")
  async deduplicateFindings(@Body() body: Record<string, any>) { return { ok: true }; }

  // -- Purge --
  @Post("purge-old-audits")
  async purgeOldAudits(@Body() body: Record<string, any>) { return { ok: true }; }
  @Post("purge-bypassed-wire-deductions")
  async purgeBypassedWireDeductions() { return { ok: true }; }

  // -- State management --
  @Post("wipe-kv")
  async wipeKv() { return { ok: true, message: "wipe-kv pending port" }; }
  @Post("seed")
  async seed(@Body() body: Record<string, any>) { return { ok: true }; }
  @Get("seed")
  async seedDryRun() { return { message: "seed dry run pending port" }; }
  @Post("init-org")
  async initOrg(@Body() body: Record<string, any>) { return { ok: true }; }
  @Post("force-nos")
  async forceNos(@Body() body: Record<string, any>) { return { ok: true }; }
  @Post("dump-state")
  async dumpState() { return { ok: true }; }
  @Post("import-state")
  async importState(@Body() body: Record<string, any>) { return { ok: true }; }
  @Post("pull-state")
  async pullState(@Body() body: Record<string, any>) { return { ok: true }; }

  // -- Token usage --
  @Get("token-usage")
  async tokenUsage() { return { total_tokens: 0, calls: 0 }; }

  // -- Unreviewed --
  @Get("unreviewed-audits")
  async getUnreviewedAudits() { return { audits: [] }; }
}
