/** Admin config + pipeline management controller — wired to real repositories. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body, Query } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import * as cfg from "@admin/domain/data/admin-repository/mod.ts";
import * as stats from "@audit/domain/data/stats-repository/mod.ts";
import { pauseAllQueues, resumeAllQueues, getQueueCounts } from "@core/domain/data/qstash/mod.ts";
import { publishStep } from "@core/domain/data/qstash/mod.ts";
import { clearReviewQueue } from "@review/domain/business/review-queue/mod.ts";
import { getTokenUsage } from "@audit/domain/data/groq/mod.ts";

// TODO: orgId should come from auth middleware. Using hardcoded default for now.
const ORG = () => "default";

@SwaggerDescription("Admin — pipeline config, settings, queue management, backfills")
@Controller("admin")
export class AdminConfigController {

  // -- Pipeline config --
  @Get("pipeline-config")
  async getPipelineConfig() { return cfg.getPipelineConfig(ORG()); }

  @Post("pipeline-config")
  async setPipelineConfig(@Body() body: Record<string, any>) { return cfg.setPipelineConfig(ORG(), body); }

  @Get("parallelism")
  async getParallelism() { const c = await cfg.getPipelineConfig(ORG()); return { parallelism: c.parallelism }; }

  @Post("parallelism")
  async setParallelism(@Body() body: { parallelism: number }) { return cfg.setPipelineConfig(ORG(), { parallelism: body.parallelism }); }

  // -- Webhook settings --
  @Get("settings/terminate")
  async getTerminateSettings() { return (await cfg.getWebhookConfig(ORG(), "terminate")) ?? {}; }
  @Post("settings/terminate")
  async saveTerminateSettings(@Body() body: Record<string, any>) { await cfg.saveWebhookConfig(ORG(), "terminate", body as any); return { ok: true }; }

  @Get("settings/appeal")
  async getAppealSettings() { return (await cfg.getWebhookConfig(ORG(), "appeal")) ?? {}; }
  @Post("settings/appeal")
  async saveAppealSettings(@Body() body: Record<string, any>) { await cfg.saveWebhookConfig(ORG(), "appeal", body as any); return { ok: true }; }

  @Get("settings/manager")
  async getManagerSettings() { return (await cfg.getWebhookConfig(ORG(), "manager")) ?? {}; }
  @Post("settings/manager")
  async saveManagerSettings(@Body() body: Record<string, any>) { await cfg.saveWebhookConfig(ORG(), "manager", body as any); return { ok: true }; }

  @Get("settings/review")
  async getReviewSettings() { return (await cfg.getWebhookConfig(ORG(), "review")) ?? {}; }
  @Post("settings/review")
  async saveReviewSettings(@Body() body: Record<string, any>) { await cfg.saveWebhookConfig(ORG(), "review", body as any); return { ok: true }; }

  @Get("settings/judge")
  async getJudgeSettings() { return (await cfg.getWebhookConfig(ORG(), "judge")) ?? {}; }
  @Post("settings/judge")
  async saveJudgeSettings(@Body() body: Record<string, any>) { await cfg.saveWebhookConfig(ORG(), "judge", body as any); return { ok: true }; }

  @Get("settings/judge-finish")
  async getJudgeFinishSettings() { return (await cfg.getWebhookConfig(ORG(), "judge-finish")) ?? {}; }
  @Post("settings/judge-finish")
  async saveJudgeFinishSettings(@Body() body: Record<string, any>) { await cfg.saveWebhookConfig(ORG(), "judge-finish", body as any); return { ok: true }; }

  @Get("settings/re-audit-receipt")
  async getReAuditReceiptSettings() { return (await cfg.getWebhookConfig(ORG(), "re-audit-receipt")) ?? {}; }
  @Post("settings/re-audit-receipt")
  async saveReAuditReceiptSettings(@Body() body: Record<string, any>) { await cfg.saveWebhookConfig(ORG(), "re-audit-receipt", body as any); return { ok: true }; }

  @Get("settings/gamification")
  async getGamificationSettings() { return {}; } // gamification settings in own module
  @Post("settings/gamification")
  async saveGamificationSettings(@Body() body: Record<string, any>) { return { ok: true }; }

  // -- Bad words / bonus / bypass --
  @Get("bad-word-config")
  async getBadWordConfig() { return cfg.getBadWordConfig(ORG()); }
  @Post("bad-word-config")
  async saveBadWordConfig(@Body() body: Record<string, any>) { await cfg.saveBadWordConfig(ORG(), body as any); return { ok: true }; }

  @Get("bonus-points-config")
  async getBonusPointsConfig() { return cfg.getBonusPointsConfig(ORG()); }
  @Post("bonus-points-config")
  async saveBonusPointsConfig(@Body() body: Record<string, any>) { await cfg.saveBonusPointsConfig(ORG(), body as any); return { ok: true }; }

  @Get("office-bypass")
  async getOfficeBypass() { return cfg.getOfficeBypassConfig(ORG()); }
  @Post("office-bypass")
  async saveOfficeBypass(@Body() body: Record<string, any>) { await cfg.saveOfficeBypassConfig(ORG(), body as any); return { ok: true }; }

  // -- Dimensions --
  @Get("audit-dimensions")
  async getAuditDimensions() { return cfg.getAuditDimensions(ORG()); }
  @Post("audit-dimensions")
  async saveAuditDimensions(@Body() body: Record<string, any>) { await cfg.saveAuditDimensions(ORG(), body as any); return { ok: true }; }

  @Get("partner-dimensions")
  async getPartnerDimensions() { return cfg.getPartnerDimensions(ORG()); }

  // -- Manager scopes --
  @Get("manager-scopes")
  async getManagerScopes() { return cfg.listManagerScopes(ORG()); }
  @Post("manager-scopes")
  async saveManagerScope(@Body() body: { email: string; scope: { departments: string[]; shifts: string[] } }) {
    await cfg.saveManagerScope(ORG(), body.email, body.scope);
    return { ok: true };
  }

  // -- Queue management --
  @Get("queues")
  async getQueues() { return getQueueCounts(); }
  @Post("queues")
  async setQueue(@Body() body: Record<string, any>) { return { ok: true }; }

  @Post("pause-queues")
  async pauseQueues() { await pauseAllQueues(); return { ok: true }; }
  @Post("resume-queues")
  async resumeQueues() { await resumeAllQueues(); return { ok: true }; }

  @Post("clear-review-queue")
  async doClearReviewQueue() { return clearReviewQueue(ORG()); }
  @Post("clear-errors")
  async clearErrors() { const count = await stats.clearErrors(ORG()); return { ok: true, cleared: count }; }

  // -- Pipeline operations --
  @Post("retry-finding")
  async retryFinding(@Body() body: { findingId: string; step?: string }) {
    const step = body.step ?? "init";
    await publishStep(step, { findingId: body.findingId, orgId: ORG() });
    return { ok: true, step };
  }
  @Get("retry-finding")
  async retryFindingGet(@Query("findingId") findingId: string, @Query("step") step: string) {
    await publishStep(step || "init", { findingId, orgId: ORG() });
    return { ok: true };
  }

  @Post("terminate-finding")
  async terminateFinding(@Body() body: { findingId: string }) {
    await stats.terminateFinding(ORG(), body.findingId);
    return { ok: true };
  }
  @Post("terminate-all")
  async terminateAll() { const count = await stats.terminateAllActive(ORG()); return { ok: true, terminated: count }; }

  @Post("reset-finding")
  async resetFinding(@Body() body: Record<string, any>) { return { ok: true, message: "reset-finding — complex logic pending full port" }; }
  @Post("flip-answer")
  async flipAnswer(@Body() body: Record<string, any>) { return { ok: true, message: "flip-answer — complex logic pending full port" }; }
  @Post("bulk-flip")
  async bulkFlip(@Body() body: Record<string, any>) { return { ok: true, message: "bulk-flip — complex logic pending full port" }; }

  // -- Backfills --
  @Post("backfill-review-scores")
  async backfillReviewScores(@Body() body: Record<string, any>) { return { ok: true, message: "backfill pending full port" }; }
  @Post("backfill-chargeback-entries")
  async backfillChargebackEntries(@Body() body: Record<string, any>) { return { ok: true, message: "backfill pending full port" }; }
  @Post("backfill-partner-dimensions")
  async backfillPartnerDimensions(@Body() body: Record<string, any>) { return { ok: true, message: "backfill pending full port" }; }
  @Post("backfill-audit-index")
  async backfillAuditIndex(@Body() body: Record<string, any>) { return { ok: true, message: "backfill pending full port" }; }
  @Post("backfill-stale-scores")
  async backfillStaleScores(@Body() body: Record<string, any>) { return { ok: true, message: "backfill pending full port" }; }
  @Post("deduplicate-findings")
  async deduplicateFindings(@Body() body: Record<string, any>) { return { ok: true, message: "dedup pending full port" }; }

  // -- Purge --
  @Post("purge-old-audits")
  async purgeOldAudits(@Body() body: Record<string, any>) { return { ok: true, message: "purge pending full port" }; }
  @Post("purge-bypassed-wire-deductions")
  async purgeBypassedWireDeductions() { return { ok: true, message: "purge pending full port" }; }

  // -- State management --
  @Post("wipe-kv")
  async wipeKv() { return { ok: true, message: "wipe-kv — destructive, pending safe implementation" }; }
  @Post("seed")
  async seed(@Body() body: Record<string, any>) { return { ok: true, message: "seed pending full port" }; }
  @Get("seed")
  async seedDryRun() { return { message: "seed dry run pending full port" }; }
  @Post("init-org")
  async initOrg(@Body() body: Record<string, any>) { return { ok: true, message: "init-org pending full port" }; }
  @Post("force-nos")
  async forceNos(@Body() body: Record<string, any>) { return { ok: true, message: "force-nos pending full port" }; }
  @Post("dump-state")
  async dumpState() { return { ok: true, message: "dump-state pending full port" }; }
  @Post("import-state")
  async importState(@Body() body: Record<string, any>) { return { ok: true, message: "import-state pending full port" }; }
  @Post("pull-state")
  async pullState(@Body() body: Record<string, any>) { return { ok: true, message: "pull-state pending full port" }; }

  // -- Token usage --
  @Get("token-usage")
  async tokenUsage(@Query("hours") hours: string) { return getTokenUsage(parseInt(hours || "1")); }

  // -- Unreviewed --
  @Get("unreviewed-audits")
  async getUnreviewedAudits() { return { audits: [], message: "pending full port with auth-scoped query" }; }
}
