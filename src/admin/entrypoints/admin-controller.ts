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
import { ReturnedType, Description, BodyType } from "jsr:@danet/swagger@2/decorators";
import { PipelineConfigResponse, ParallelismResponse, WebhookConfigResponse, BadWordConfigResponse, BypassConfigResponse, BonusConfigResponse, DimensionsResponse, PartnerDimensionsResponse, QueueCountsResponse, OkResponse, OkMessageResponse, ClearedResponse, TerminatedResponse, TokenUsageResponse, MessageResponse } from "@core/dto/responses.ts";
import { GenericBodyRequest } from "@core/dto/requests.ts";
import { defaultOrgId } from "@core/domain/business/auth/org-resolver.ts";
const ORG = defaultOrgId;

@SwaggerDescription("Admin — pipeline config, settings, queue management, backfills")
@Controller("admin")
export class AdminConfigController {

  // -- Pipeline config --
  @Get("pipeline-config") @ReturnedType(PipelineConfigResponse)
  async getPipelineConfig() { return cfg.getPipelineConfig(ORG()); }

  @Post("pipeline-config") @ReturnedType(PipelineConfigResponse)
  async setPipelineConfig(@Body() body: GenericBodyRequest) { return cfg.setPipelineConfig(ORG(), body as any); }

  @Get("parallelism") @ReturnedType(ParallelismResponse)
  async getParallelism() { const c = await cfg.getPipelineConfig(ORG()); return { parallelism: c.parallelism }; }

  @Post("parallelism") @ReturnedType(PipelineConfigResponse)
  async setParallelism(@Body() body: { parallelism: number }) { return cfg.setPipelineConfig(ORG(), { parallelism: body.parallelism }); }

  // -- Webhook settings --
  @Get("settings/terminate") @ReturnedType(WebhookConfigResponse)
  async getTerminateSettings() { return (await cfg.getWebhookConfig(ORG(), "terminate")) ?? {}; }
  @Post("settings/terminate") @ReturnedType(OkResponse)
  async saveTerminateSettings(@Body() body: GenericBodyRequest) { await cfg.saveWebhookConfig(ORG(), "terminate", body as any); return { ok: true }; }

  @Get("settings/appeal") @ReturnedType(WebhookConfigResponse)
  async getAppealSettings() { return (await cfg.getWebhookConfig(ORG(), "appeal")) ?? {}; }
  @Post("settings/appeal") @ReturnedType(OkResponse)
  async saveAppealSettings(@Body() body: GenericBodyRequest) { await cfg.saveWebhookConfig(ORG(), "appeal", body as any); return { ok: true }; }

  @Get("settings/manager") @ReturnedType(WebhookConfigResponse)
  async getManagerSettings() { return (await cfg.getWebhookConfig(ORG(), "manager")) ?? {}; }
  @Post("settings/manager") @ReturnedType(OkResponse)
  async saveManagerSettings(@Body() body: GenericBodyRequest) { await cfg.saveWebhookConfig(ORG(), "manager", body as any); return { ok: true }; }

  @Get("settings/review") @ReturnedType(WebhookConfigResponse)
  async getReviewSettings() { return (await cfg.getWebhookConfig(ORG(), "review")) ?? {}; }
  @Post("settings/review") @ReturnedType(OkResponse)
  async saveReviewSettings(@Body() body: GenericBodyRequest) { await cfg.saveWebhookConfig(ORG(), "review", body as any); return { ok: true }; }

  @Get("settings/judge") @ReturnedType(WebhookConfigResponse)
  async getJudgeSettings() { return (await cfg.getWebhookConfig(ORG(), "judge")) ?? {}; }
  @Post("settings/judge") @ReturnedType(OkResponse)
  async saveJudgeSettings(@Body() body: GenericBodyRequest) { await cfg.saveWebhookConfig(ORG(), "judge", body as any); return { ok: true }; }

  @Get("settings/judge-finish") @ReturnedType(WebhookConfigResponse)
  async getJudgeFinishSettings() { return (await cfg.getWebhookConfig(ORG(), "judge-finish")) ?? {}; }
  @Post("settings/judge-finish") @ReturnedType(OkResponse)
  async saveJudgeFinishSettings(@Body() body: GenericBodyRequest) { await cfg.saveWebhookConfig(ORG(), "judge-finish", body as any); return { ok: true }; }

  @Get("settings/re-audit-receipt") @ReturnedType(WebhookConfigResponse)
  async getReAuditReceiptSettings() { return (await cfg.getWebhookConfig(ORG(), "re-audit-receipt")) ?? {}; }
  @Post("settings/re-audit-receipt") @ReturnedType(OkResponse)
  async saveReAuditReceiptSettings(@Body() body: GenericBodyRequest) { await cfg.saveWebhookConfig(ORG(), "re-audit-receipt", body as any); return { ok: true }; }

  @Get("settings/gamification") @ReturnedType(OkResponse)
  async getGamificationSettings() { return {}; } // gamification settings in own module
  @Post("settings/gamification") @ReturnedType(OkResponse)
  async saveGamificationSettings(@Body() body: GenericBodyRequest) { return { ok: true }; }

  // -- Bad words / bonus / bypass --
  @Get("bad-word-config") @ReturnedType(BadWordConfigResponse)
  async getBadWordConfig() { return cfg.getBadWordConfig(ORG()); }
  @Post("bad-word-config") @ReturnedType(OkResponse)
  async saveBadWordConfig(@Body() body: GenericBodyRequest) { await cfg.saveBadWordConfig(ORG(), body as any); return { ok: true }; }

  @Get("bonus-points-config") @ReturnedType(BonusConfigResponse)
  async getBonusPointsConfig() { return cfg.getBonusPointsConfig(ORG()); }
  @Post("bonus-points-config") @ReturnedType(OkResponse)
  async saveBonusPointsConfig(@Body() body: GenericBodyRequest) { await cfg.saveBonusPointsConfig(ORG(), body as any); return { ok: true }; }

  @Get("office-bypass") @ReturnedType(BypassConfigResponse)
  async getOfficeBypass() { return cfg.getOfficeBypassConfig(ORG()); }
  @Post("office-bypass") @ReturnedType(OkResponse)
  async saveOfficeBypass(@Body() body: GenericBodyRequest) { await cfg.saveOfficeBypassConfig(ORG(), body as any); return { ok: true }; }

  // -- Dimensions --
  @Get("audit-dimensions") @ReturnedType(DimensionsResponse)
  async getAuditDimensions() { return cfg.getAuditDimensions(ORG()); }
  @Post("audit-dimensions") @ReturnedType(OkResponse)
  async saveAuditDimensions(@Body() body: GenericBodyRequest) { await cfg.saveAuditDimensions(ORG(), body as any); return { ok: true }; }

  @Get("partner-dimensions") @ReturnedType(PartnerDimensionsResponse)
  async getPartnerDimensions() { return cfg.getPartnerDimensions(ORG()); }

  // -- Manager scopes --
  @Get("manager-scopes") @ReturnedType(OkResponse)
  async getManagerScopes() { return cfg.listManagerScopes(ORG()); }
  @Post("manager-scopes") @ReturnedType(OkResponse)
  async saveManagerScope(@Body() body: { email: string; scope: { departments: string[]; shifts: string[] } }) {
    await cfg.saveManagerScope(ORG(), body.email, body.scope);
    return { ok: true };
  }

  // -- Queue management --
  @Get("queues") @ReturnedType(QueueCountsResponse)
  async getQueues() { return getQueueCounts(); }
  @Post("queues") @ReturnedType(OkResponse)
  async setQueue(@Body() body: GenericBodyRequest) { return { ok: true }; }

  @Post("pause-queues") @ReturnedType(OkResponse)
  async pauseQueues() { await pauseAllQueues(); return { ok: true }; }
  @Post("resume-queues") @ReturnedType(OkResponse)
  async resumeQueues() { await resumeAllQueues(); return { ok: true }; }

  @Post("clear-review-queue") @ReturnedType(ClearedResponse)
  async doClearReviewQueue() { return clearReviewQueue(ORG()); }
  @Post("clear-errors") @ReturnedType(ClearedResponse)
  async clearErrors() { const count = await stats.clearErrors(ORG()); return { ok: true, cleared: count }; }

  // -- Pipeline operations --
  @Post("retry-finding") @ReturnedType(OkResponse)
  async retryFinding(@Body() body: { findingId: string; step?: string }) {
    const step = body.step ?? "init";
    await publishStep(step, { findingId: body.findingId, orgId: ORG() });
    return { ok: true, step };
  }
  @Get("retry-finding") @ReturnedType(OkResponse)
  async retryFindingGet(@Query("findingId") findingId: string, @Query("step") step: string) {
    await publishStep(step || "init", { findingId, orgId: ORG() });
    return { ok: true };
  }

  @Post("terminate-finding") @ReturnedType(OkResponse)
  async terminateFinding(@Body() body: { findingId: string }) {
    await stats.terminateFinding(ORG(), body.findingId);
    return { ok: true };
  }
  @Post("terminate-all") @ReturnedType(TerminatedResponse)
  async terminateAll() { const count = await stats.terminateAllActive(ORG()); return { ok: true, terminated: count }; }

  @Post("reset-finding") @ReturnedType(OkMessageResponse)
  async resetFinding(@Body() body: GenericBodyRequest) {
    const b = body as any;
    if (!b.findingId) return { error: "findingId required" };
    const { publishStep: pub } = await import("../../core/domain/data/qstash/mod.ts");
    await pub("init", { findingId: b.findingId, orgId: ORG() });
    return { ok: true, message: "Finding re-queued for re-audit" };
  }
  @Post("flip-answer") @ReturnedType(OkResponse)
  async flipAnswer(@Body() body: GenericBodyRequest) {
    const b = body as any;
    if (!b.findingId) return { error: "findingId required" };
    const { adminFlipFinding } = await import("../../../review/kv.ts");
    const result = await adminFlipFinding(ORG(), b.findingId);
    return { ok: result.success, score: result.score };
  }
  @Post("bulk-flip") @ReturnedType(OkResponse)
  async bulkFlip(@Body() body: GenericBodyRequest) {
    const b = body as any;
    const findingIds: string[] = b.findingIds ?? [];
    if (!findingIds.length) return { error: "findingIds array required" };
    const { adminFlipFinding } = await import("../../../review/kv.ts");
    let flipped = 0;
    for (const fid of findingIds) {
      const r = await adminFlipFinding(ORG(), fid);
      if (r.success) flipped++;
    }
    return { ok: true, flipped, total: findingIds.length };
  }

  // -- Backfills --
  @Post("backfill-review-scores") @ReturnedType(OkMessageResponse)
  async backfillReviewScores(@Body() body: GenericBodyRequest) {
    const { since, until } = body as any;
    if (!since || !until) return { error: "since and until required" };
    const { backfillReviewScores: backfill } = await import("../../../lib/kv.ts");
    return backfill(ORG(), since, until);
  }
  @Post("backfill-chargeback-entries") @ReturnedType(OkMessageResponse)
  async backfillChargebackEntries(@Body() body: GenericBodyRequest) {
    const { since, until } = body as any;
    if (!since || !until) return { error: "since and until required" };
    const { backfillChargebackEntries: backfill } = await import("../../../judge/kv.ts");
    return backfill(ORG(), since, until);
  }
  @Post("backfill-partner-dimensions") @ReturnedType(OkMessageResponse)
  async backfillPartnerDimensions(@Body() body: GenericBodyRequest) {
    const { cursor } = body as any;
    const { backfillPartnerDimensions: backfill } = await import("../../../lib/kv.ts");
    return backfill(ORG(), cursor);
  }
  @Post("backfill-audit-index") @ReturnedType(OkMessageResponse)
  async backfillAuditIndex(@Body() body: GenericBodyRequest) {
    const { cursor } = body as any;
    const { backfillAuditDoneIndex: backfill } = await import("../../../lib/kv.ts");
    return backfill(ORG(), cursor);
  }
  @Post("backfill-stale-scores") @ReturnedType(OkMessageResponse)
  async backfillStaleScores(@Body() body: GenericBodyRequest) {
    const { cursor } = body as any;
    const { backfillStaleScores: backfill } = await import("../../../lib/kv.ts");
    return backfill(ORG(), cursor);
  }
  @Post("deduplicate-findings") @ReturnedType(OkMessageResponse)
  async deduplicateFindings(@Body() body: GenericBodyRequest) {
    const { since, until } = body as any;
    if (!since || !until) return { error: "since and until required" };
    const { findDuplicates, deleteDuplicates } = await import("../../../judge/kv.ts");
    const plan = await findDuplicates(ORG(), since, until);
    if ((body as any).execute) {
      const result = await deleteDuplicates(ORG(), plan as any, () => {});
      return { ok: true, ...result };
    }
    return { ok: true, plan, message: "Dry run — send execute: true to apply" };
  }

  // -- Purge --
  @Post("purge-old-audits") @ReturnedType(OkMessageResponse)
  async purgeOldAudits(@Body() body: GenericBodyRequest) {
    const { since, before } = body as any;
    if (!before) return { error: "before required" };
    const { purgeOldEntries } = await import("../../../lib/kv.ts");
    const result = await purgeOldEntries(ORG(), since ?? 0, before);
    return { ok: true, ...result };
  }
  @Post("purge-bypassed-wire-deductions") @ReturnedType(OkMessageResponse)
  async purgeBypassedWireDeductions() {
    const { purgeBypassedWireDeductions: purge } = await import("../../../lib/kv.ts");
    const bypassCfg = await cfg.getOfficeBypassConfig(ORG());
    const result = await purge(ORG(), bypassCfg.patterns);
    return { ok: true, ...result };
  }

  // -- State management --
  @Post("wipe-kv") @ReturnedType(OkMessageResponse)
  async wipeKv() { return { ok: true, message: "wipe-kv — destructive, pending safe implementation" }; }
  @Post("seed") @ReturnedType(OkMessageResponse)
  async seed(@Body() body: GenericBodyRequest) { return { ok: true, message: "Not yet implemented" }; }
  @Get("seed") @ReturnedType(MessageResponse)
  async seedDryRun() { return { message: "Not yet implemented" }; }
  @Post("init-org") @ReturnedType(OkMessageResponse)
  async initOrg(@Body() body: GenericBodyRequest) { return { ok: true, message: "Not yet implemented" }; }
  @Post("force-nos") @ReturnedType(OkMessageResponse)
  async forceNos(@Body() body: GenericBodyRequest) { return { ok: true, message: "Not yet implemented" }; }
  @Post("dump-state") @ReturnedType(OkMessageResponse)
  async dumpState() { return { ok: true, message: "Not yet implemented" }; }
  @Post("import-state") @ReturnedType(OkMessageResponse)
  async importState(@Body() body: GenericBodyRequest) { return { ok: true, message: "Not yet implemented" }; }
  @Post("pull-state") @ReturnedType(OkMessageResponse)
  async pullState(@Body() body: GenericBodyRequest) { return { ok: true, message: "Not yet implemented" }; }

  // -- Token usage --
  @Get("token-usage") @ReturnedType(TokenUsageResponse)
  async tokenUsage(@Query("hours") hours: string) { return getTokenUsage(parseInt(hours || "1")); }

  // -- Unreviewed --
  @Get("unreviewed-audits") @ReturnedType(MessageResponse)
  async getUnreviewedAudits() {
    const now = Date.now();
    const since = now - 7 * 24 * 3600 * 1000; // last 7 days
    const entries = await stats.queryAuditDoneIndex(ORG(), since, now);
    const unreviewed = entries.filter((e: any) => !e.completed && e.score != null && e.score < 100);
    return { audits: unreviewed };
  }
}
