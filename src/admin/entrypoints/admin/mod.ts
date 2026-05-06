/** Admin config + pipeline management controller — wired to real repositories. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body, Query } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import * as cfg from "@admin/domain/data/admin-repository/mod.ts";
import * as stats from "@audit/domain/data/stats-repository/mod.ts";
import { pauseAllQueues, resumeAllQueues, getQueueCounts } from "@core/data/qstash/mod.ts";
import { publishStep } from "@core/data/qstash/mod.ts";
import { clearReviewQueue } from "@review/domain/business/review-queue/mod.ts";
import { getTokenUsage } from "@audit/domain/data/groq/mod.ts";
import { ReturnedType, Description, BodyType } from "#danet/swagger-decorators";
import { PipelineConfigResponse, ParallelismResponse, WebhookConfigResponse, BadWordConfigResponse, BypassConfigResponse, BonusConfigResponse, DimensionsResponse, PartnerDimensionsResponse, QueueCountsResponse, OkResponse, OkMessageResponse, ClearedResponse, TerminatedResponse, TokenUsageResponse, MessageResponse } from "@core/dto/responses.ts";
import { GenericBodyRequest } from "@core/dto/requests.ts";
import { defaultOrgId } from "@core/business/auth/mod.ts";
const ORG = defaultOrgId;

@SwaggerDescription("Admin — pipeline config, settings, queue management, backfills")
@Controller("admin")
export class AdminConfigController {

  // -- Pipeline config --
  @Get("pipeline-config") @ReturnedType(PipelineConfigResponse)
  async getPipelineConfig() { return cfg.getPipelineConfig(ORG()); }

  @Post("pipeline-config") @ReturnedType(PipelineConfigResponse) @BodyType(GenericBodyRequest)
  async setPipelineConfig(@Body() body: GenericBodyRequest) { return cfg.setPipelineConfig(ORG(), body as any); }

  @Get("parallelism") @ReturnedType(ParallelismResponse)
  async getParallelism() { const c = await cfg.getPipelineConfig(ORG()); return { parallelism: c.parallelism }; }

  @Post("parallelism") @ReturnedType(PipelineConfigResponse) @BodyType(GenericBodyRequest)
  async setParallelism(@Body() body: { parallelism: number }) { return cfg.setPipelineConfig(ORG(), { parallelism: body.parallelism }); }

  // -- Webhook settings --
  @Get("settings/terminate") @ReturnedType(WebhookConfigResponse)
  async getTerminateSettings() { return (await cfg.getWebhookConfig(ORG(), "terminate")) ?? {}; }
  @Post("settings/terminate") @ReturnedType(OkResponse) @BodyType(GenericBodyRequest)
  async saveTerminateSettings(@Body() body: GenericBodyRequest) { await cfg.saveWebhookConfig(ORG(), "terminate", body as any); return { ok: true }; }

  @Get("settings/appeal") @ReturnedType(WebhookConfigResponse)
  async getAppealSettings() { return (await cfg.getWebhookConfig(ORG(), "appeal")) ?? {}; }
  @Post("settings/appeal") @ReturnedType(OkResponse) @BodyType(GenericBodyRequest)
  async saveAppealSettings(@Body() body: GenericBodyRequest) { await cfg.saveWebhookConfig(ORG(), "appeal", body as any); return { ok: true }; }

  @Get("settings/manager") @ReturnedType(WebhookConfigResponse)
  async getManagerSettings() { return (await cfg.getWebhookConfig(ORG(), "manager")) ?? {}; }
  @Post("settings/manager") @ReturnedType(OkResponse) @BodyType(GenericBodyRequest)
  async saveManagerSettings(@Body() body: GenericBodyRequest) { await cfg.saveWebhookConfig(ORG(), "manager", body as any); return { ok: true }; }

  @Get("settings/review") @ReturnedType(WebhookConfigResponse)
  async getReviewSettings() { return (await cfg.getWebhookConfig(ORG(), "review")) ?? {}; }
  @Post("settings/review") @ReturnedType(OkResponse) @BodyType(GenericBodyRequest)
  async saveReviewSettings(@Body() body: GenericBodyRequest) { await cfg.saveWebhookConfig(ORG(), "review", body as any); return { ok: true }; }

  @Get("settings/judge") @ReturnedType(WebhookConfigResponse)
  async getJudgeSettings() { return (await cfg.getWebhookConfig(ORG(), "judge")) ?? {}; }
  @Post("settings/judge") @ReturnedType(OkResponse) @BodyType(GenericBodyRequest)
  async saveJudgeSettings(@Body() body: GenericBodyRequest) { await cfg.saveWebhookConfig(ORG(), "judge", body as any); return { ok: true }; }

  @Get("settings/judge-finish") @ReturnedType(WebhookConfigResponse)
  async getJudgeFinishSettings() { return (await cfg.getWebhookConfig(ORG(), "judge-finish")) ?? {}; }
  @Post("settings/judge-finish") @ReturnedType(OkResponse) @BodyType(GenericBodyRequest)
  async saveJudgeFinishSettings(@Body() body: GenericBodyRequest) { await cfg.saveWebhookConfig(ORG(), "judge-finish", body as any); return { ok: true }; }

  @Get("settings/re-audit-receipt") @ReturnedType(WebhookConfigResponse)
  async getReAuditReceiptSettings() { return (await cfg.getWebhookConfig(ORG(), "re-audit-receipt")) ?? {}; }
  @Post("settings/re-audit-receipt") @ReturnedType(OkResponse) @BodyType(GenericBodyRequest)
  async saveReAuditReceiptSettings(@Body() body: GenericBodyRequest) { await cfg.saveWebhookConfig(ORG(), "re-audit-receipt", body as any); return { ok: true }; }

  // Org-default gamification settings — delegates to the gamification repo
  // so this admin endpoint and /gamification/api/settings agree on the same
  // KV record (legacy frontend code may still hit either path).
  @Get("settings/gamification") @ReturnedType(OkResponse)
  async getGamificationSettings() {
    const { getGamificationSettings } = await import("@gamification/domain/data/gamification-repository/mod.ts");
    return (await getGamificationSettings(ORG())) ?? {};
  }
  @Post("settings/gamification") @ReturnedType(OkResponse) @BodyType(GenericBodyRequest)
  async saveGamificationSettings(@Body() body: GenericBodyRequest) {
    const { saveGamificationSettings } = await import("@gamification/domain/data/gamification-repository/mod.ts");
    await saveGamificationSettings(ORG(), body as any);
    return { ok: true };
  }

  // -- Bad words / bonus / bypass --
  @Get("bad-word-config") @ReturnedType(BadWordConfigResponse)
  async getBadWordConfig() { return cfg.getBadWordConfig(ORG()); }
  @Post("bad-word-config") @ReturnedType(OkResponse) @BodyType(GenericBodyRequest)
  async saveBadWordConfig(@Body() body: GenericBodyRequest) { await cfg.saveBadWordConfig(ORG(), body as any); return { ok: true }; }

  @Get("bonus-points-config") @ReturnedType(BonusConfigResponse)
  async getBonusPointsConfig() { return cfg.getBonusPointsConfig(ORG()); }
  @Post("bonus-points-config") @ReturnedType(OkResponse) @BodyType(GenericBodyRequest)
  async saveBonusPointsConfig(@Body() body: GenericBodyRequest) { await cfg.saveBonusPointsConfig(ORG(), body as any); return { ok: true }; }

  @Get("office-bypass") @ReturnedType(BypassConfigResponse)
  async getOfficeBypass() { return cfg.getOfficeBypassConfig(ORG()); }
  @Post("office-bypass") @ReturnedType(OkResponse) @BodyType(GenericBodyRequest)
  async saveOfficeBypass(@Body() body: GenericBodyRequest) { await cfg.saveOfficeBypassConfig(ORG(), body as any); return { ok: true }; }

  // -- Dimensions --
  @Get("audit-dimensions") @ReturnedType(DimensionsResponse)
  async getAuditDimensions() { return cfg.getAuditDimensions(ORG()); }
  @Post("audit-dimensions") @ReturnedType(OkResponse) @BodyType(GenericBodyRequest)
  async saveAuditDimensions(@Body() body: GenericBodyRequest) { await cfg.saveAuditDimensions(ORG(), body as any); return { ok: true }; }

  @Get("partner-dimensions") @ReturnedType(PartnerDimensionsResponse)
  async getPartnerDimensions() { return cfg.getPartnerDimensions(ORG()); }

  // -- Manager scopes --
  @Get("manager-scopes") @ReturnedType(OkResponse)
  async getManagerScopes() { return cfg.listManagerScopes(ORG()); }
  @Post("manager-scopes") @ReturnedType(OkResponse) @BodyType(GenericBodyRequest)
  async saveManagerScope(@Body() body: { email: string; scope: { departments: string[]; shifts: string[] } }) {
    await cfg.saveManagerScope(ORG(), body.email, body.scope);
    return { ok: true };
  }

  // -- Queue management --
  @Get("queues") @ReturnedType(QueueCountsResponse)
  async getQueues() { return getQueueCounts(); }
  @Post("queues") @ReturnedType(OkResponse) @BodyType(GenericBodyRequest)
  async setQueue(@Body() body: GenericBodyRequest) {
    const b = body as { queueName?: string; parallelism?: number };
    if (!b.queueName) return { error: "queueName required" };
    const { getStored, setStored } = await import("@core/data/firestore/mod.ts");
    const existing = (await getStored<Record<string, unknown>>("queue-config", ORG(), b.queueName)) ?? {};
    await setStored("queue-config", ORG(), [b.queueName], { ...existing, ...(b.parallelism != null ? { parallelism: b.parallelism } : {}) });
    return { ok: true, queueName: b.queueName };
  }

  @Post("pause-queues") @ReturnedType(OkResponse)
  async pauseQueues() {
    await pauseAllQueues();
    await cfg.setPipelinePaused(ORG(), true);
    return { ok: true, paused: true };
  }
  @Post("resume-queues") @ReturnedType(OkResponse)
  async resumeQueues() {
    await resumeAllQueues();
    await cfg.setPipelinePaused(ORG(), false);
    return { ok: true, paused: false };
  }

  @Post("clear-review-queue") @ReturnedType(ClearedResponse)
  async doClearReviewQueue() { return clearReviewQueue(ORG()); }
  @Post("clear-errors") @ReturnedType(ClearedResponse)
  async clearErrors() { const count = await stats.clearErrors(ORG()); return { ok: true, cleared: count }; }

  // -- Pipeline operations --
  @Post("retry-finding") @ReturnedType(OkResponse) @BodyType(GenericBodyRequest)
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

  @Post("terminate-finding") @ReturnedType(OkResponse) @BodyType(GenericBodyRequest)
  async terminateFinding(@Body() body: { findingId: string }) {
    const orgId = ORG();
    console.log(`🛑 [ADMIN] terminate-finding orgId=${orgId} fid=${body.findingId}`);
    await stats.terminateFinding(orgId, body.findingId);
    return { ok: true };
  }
  @Post("terminate-all") @ReturnedType(TerminatedResponse)
  async terminateAll() {
    const orgId = ORG();
    console.log(`🛑 [ADMIN] terminate-all orgId=${orgId}`);
    const count = await stats.terminateAllActive(orgId);
    return { ok: true, terminated: count };
  }

  @Post("reset-finding") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  async resetFinding(@Body() body: GenericBodyRequest) {
    const b = body as any;
    if (!b.findingId) return { error: "findingId required" };
    const { publishStep: pub } = await import("@core/data/qstash/mod.ts");
    await pub("init", { findingId: b.findingId, orgId: ORG() });
    return { ok: true, message: "Finding re-queued for re-audit" };
  }
  @Post("flip-answer") @ReturnedType(OkResponse) @BodyType(GenericBodyRequest)
  async flipAnswer(@Body() body: GenericBodyRequest) {
    const b = body as any;
    if (!b.findingId) return { error: "findingId required" };
    // If questionIndex provided, flip that single question; otherwise flip all No→Yes (legacy).
    if (typeof b.questionIndex === "number" && Number.isInteger(b.questionIndex)) {
      const { adminFlipQuestion } = await import("@review/domain/business/review-queue/mod.ts");
      const result = await adminFlipQuestion(ORG(), b.findingId, b.questionIndex);
      return { ok: result.success, score: result.score, answer: result.answer };
    }
    const { adminFlipFindingLegacy } = await import("@review/domain/business/review-queue/mod.ts");
    const result = await adminFlipFindingLegacy(ORG(), b.findingId);
    return { ok: result.success, score: result.score };
  }
  @Post("bulk-flip") @ReturnedType(OkResponse) @BodyType(GenericBodyRequest)
  async bulkFlip(@Body() body: GenericBodyRequest) {
    const b = body as any;
    const findingIds: string[] = b.findingIds ?? [];
    if (!findingIds.length) return { error: "findingIds array required" };
    const { adminFlipFindingLegacy } = await import("@review/domain/business/review-queue/mod.ts");
    let flipped = 0;
    for (const fid of findingIds) {
      const r = await adminFlipFindingLegacy(ORG(), fid);
      if (r.success) flipped++;
    }
    return { ok: true, flipped, total: findingIds.length };
  }

  // -- Backfills --
  @Post("backfill-review-scores") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  async backfillReviewScores(@Body() body: GenericBodyRequest) {
    const { since, until } = body as any;
    if (!since || !until) return { error: "since and until required" };
    const { backfillReviewScores } = await import("@audit/domain/business/admin-backfills/mod.ts");
    return { ok: true, ...(await backfillReviewScores(ORG(), since, until)) };
  }
  @Post("backfill-chargeback-entries") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  async backfillChargebackEntries(@Body() body: GenericBodyRequest) {
    const { since, until } = body as any;
    if (!since || !until) return { error: "since and until required" };
    const { backfillChargebackEntriesLegacy: backfill } = await import("@judge/domain/data/judge-repository/mod.ts");
    return backfill(ORG(), since, until);
  }
  @Post("backfill-partner-dimensions") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  async backfillPartnerDimensions(@Body() body: GenericBodyRequest) {
    const { cursor } = body as any;
    const { backfillPartnerDimensions } = await import("@audit/domain/business/admin-backfills/mod.ts");
    return { ok: true, ...(await backfillPartnerDimensions(ORG(), cursor)) };
  }
  @Post("backfill-audit-index") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  async backfillAuditIndex(@Body() body: GenericBodyRequest) {
    const { cursor } = body as any;
    const { backfillAuditDoneIndex } = await import("@audit/domain/business/admin-backfills/mod.ts");
    return { ok: true, ...(await backfillAuditDoneIndex(ORG(), cursor)) };
  }
  @Post("backfill-stale-scores") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  async backfillStaleScores(@Body() body: GenericBodyRequest) {
    const { cursor } = body as any;
    const { backfillStaleScores } = await import("@audit/domain/business/admin-backfills/mod.ts");
    return { ok: true, ...(await backfillStaleScores(ORG(), cursor)) };
  }
  @Post("deduplicate-findings") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  async deduplicateFindings(@Body() body: GenericBodyRequest) {
    const b = body as any;
    const since = parseDateOrMs(b.since, false);
    const until = parseDateOrMs(b.until, true);
    if (since == null || until == null) return { error: "since and until required (date YYYY-MM-DD or ms)" };
    const { findDuplicatesLegacy, deleteDuplicatesLegacy } = await import("@judge/domain/data/judge-repository/mod.ts");
    const plan = await findDuplicatesLegacy(ORG(), since, until);
    if (b.execute) {
      const result = await deleteDuplicatesLegacy(ORG(), plan as any, () => {});
      return { ok: true, ...result };
    }
    return { ok: true, plan, message: "Dry run — send execute: true to apply" };
  }

  // -- Purge --
  @Post("purge-old-audits") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  async purgeOldAudits(@Body() body: GenericBodyRequest) {
    const b = body as any;
    const since = parseDateOrMs(b.since, false) ?? 0;
    const before = parseDateOrMs(b.before, true);
    if (before == null) return { error: "before required (date YYYY-MM-DD or ms)" };
    const { purgeOldEntries } = await import("@audit/domain/business/admin-backfills/mod.ts");
    return { ok: true, ...(await purgeOldEntries(ORG(), since, before)) };
  }
  @Post("purge-bypassed-wire-deductions") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  async purgeBypassedWireDeductions(@Body() body: GenericBodyRequest) {
    const { purgeBypassedWireDeductions } = await import("@audit/domain/business/admin-backfills/mod.ts");
    const bypassCfg = await cfg.getOfficeBypassConfig(ORG());
    const patterns = ((body as any)?.patterns as string[]) ?? bypassCfg.patterns ?? [];
    return { ok: true, ...(await purgeBypassedWireDeductions(ORG(), patterns)) };
  }

  // -- State management --
  // DESTRUCTIVE — requires body { confirm: "YES" } to proceed.
  @Post("wipe-kv") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  async wipeKv(@Body() body: GenericBodyRequest) {
    const confirm = (body as any)?.confirm as string | undefined;
    const { wipeKv } = await import("@audit/domain/business/admin-backfills/mod.ts");
    const result = await wipeKv(ORG(), confirm ?? "");
    if (!result.ok) return { ok: false, message: result.error ?? "refused" };
    return { ok: true, message: `wiped ${result.deleted} keys` };
  }
  @Post("seed") @ReturnedType(OkResponse) @BodyType(GenericBodyRequest)
  async seed(@Body() body: GenericBodyRequest) {
    const { seedOrgData } = await import("@core/business/seed/mod.ts");
    const orgId = ORG();
    const result = await seedOrgData(orgId);
    return { ok: true, orgId, ...result };
  }
  @Get("seed") @ReturnedType(MessageResponse)
  async seedDryRun() { return { message: "POST /admin/seed creates 6 test users in the current org with password 0000." }; }
  @Post("init-org") @ReturnedType(OkResponse) @BodyType(GenericBodyRequest)
  async initOrg(@Body() body: GenericBodyRequest) {
    const b = body as any;
    if (!b.name) return { error: "name required" };
    const { createOrg, createUser } = await import("@core/business/auth/mod.ts");
    const orgId = await createOrg(b.name, b.name);
    if (b.email && b.password) {
      try { await createUser(orgId, b.email, b.password, "admin"); } catch { /* exists */ }
    }
    return { ok: true, orgId };
  }
  @Post("force-nos") @ReturnedType(OkResponse) @BodyType(GenericBodyRequest)
  async forceNos(@Body() body: GenericBodyRequest) {
    const b = body as any;
    if (!b.findingId) return { error: "findingId required" };
    const { getFinding, saveFinding } = await import("@audit/domain/data/audit-repository/mod.ts");
    const finding = await getFinding(ORG(), b.findingId);
    if (!finding) return { error: "finding not found" };
    let flipped = 0;
    for (const q of (finding.answeredQuestions ?? [])) {
      if (q.answer === "Yes") { q.answer = "No"; q.thinking = "[FORCED NO] " + (q.thinking || ""); flipped++; }
    }
    await saveFinding(ORG(), finding);
    return { ok: true, flipped };
  }
  @Post("dump-state") @ReturnedType(OkMessageResponse)
  async dumpState() {
    const { dumpKv } = await import("@audit/domain/business/admin-backfills/mod.ts");
    const result = await dumpKv(ORG());
    return { ok: true, message: `Dumped ${result.count} keys`, entries: result.entries };
  }
  @Post("import-state") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  async importState(@Body() body: GenericBodyRequest) {
    const b = body as { confirm?: string; entries?: unknown[] };
    if (b.confirm !== "YES") return { ok: false, message: "import-state requires { confirm: \"YES\" }" };
    const { importKv } = await import("@audit/domain/business/admin-backfills/mod.ts");
    const result = await importKv(ORG(), "YES", (b.entries ?? []) as Array<{ type: string; org: string; key: string[]; value: unknown }>);
    if (!result.ok) return { ok: false, message: result.error ?? "import failed" };
    return { ok: true, message: `Wrote ${result.written ?? 0} keys, skipped ${result.skipped ?? 0}` };
  }
  @Post("pull-state") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  async pullState(@Body() body: GenericBodyRequest) {
    const b = body as { confirm?: string };
    if (b.confirm !== "YES") return { ok: false, message: "pull-state requires { confirm: \"YES\" }" };
    const url = Deno.env.get("KV_REPORT_URL") ?? "";
    if (!url) return { ok: false, message: "pull-state requires KV_REPORT_URL env — sister read endpoint not configured" };
    // Best-effort: try fetching <url>/dump?org=<orgId>. If the sister service
    // doesn't expose a /dump route, surface the error verbatim.
    try {
      const res = await fetch(`${url}/dump?org=${encodeURIComponent(String(ORG()))}`);
      if (!res.ok) return { ok: false, message: `pull-state: HTTP ${res.status}` };
      const data = await res.json().catch(() => ({})) as { entries?: Array<{ type: string; org: string; key: string[]; value: unknown }> };
      const { importKv } = await import("@audit/domain/business/admin-backfills/mod.ts");
      const result = await importKv(ORG(), "YES", data.entries ?? []);
      return { ok: true, message: `Pulled + wrote ${result.written ?? 0} keys` };
    } catch (e) {
      return { ok: false, message: `pull-state failed: ${(e as Error).message}` };
    }
  }

  // -- Super Admin — org management. Gated at the Fresh layer by email check;
  // these backend endpoints trust proxies to have authenticated.
  @Get("super-admin/orgs") @ReturnedType(MessageResponse)
  async listOrgsWithCounts() {
    const { listOrgs, listUsers } = await import("@core/business/auth/mod.ts");
    const { listStoredWithKeys } = await import("@core/data/firestore/mod.ts");
    const orgs = await listOrgs();
    const results = [] as Array<{ id: string; name: string; slug: string; createdAt: number; users: number; findings: number }>;
    for (const o of orgs) {
      const users = await listUsers(o.id).catch(() => []);
      // Count distinct finding header docs (key.length===1, no chunk suffix)
      const findingDocs = await listStoredWithKeys("audit-finding", o.id);
      const findingIds = new Set<string>();
      for (const { key } of findingDocs) {
        if (key.length === 1) findingIds.add(String(key[0]));
      }
      results.push({ id: String(o.id), name: o.name, slug: o.slug, createdAt: o.createdAt, users: users.length, findings: findingIds.size });
    }
    return { orgs: results };
  }

  @Post("super-admin/org-create") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  async createOrgSuper(@Body() body: GenericBodyRequest) {
    const b = body as { name?: string; adminEmail?: string; adminPassword?: string };
    if (!b.name) return { error: "name required" };
    const { createOrg, createUser } = await import("@core/business/auth/mod.ts");
    const orgId = await createOrg(b.name, b.adminEmail ?? "admin@autobot.dev");
    if (b.adminEmail && b.adminPassword) {
      try { await createUser(orgId as any, b.adminEmail, b.adminPassword, "admin"); } catch { /* exists */ }
    }
    return { ok: true, orgId: String(orgId), message: `Created org ${b.name}` };
  }

  @Post("super-admin/org-seed") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  async seedOrg(@Body() body: GenericBodyRequest) {
    const b = body as { orgId?: string };
    if (!b.orgId) return { error: "orgId required" };
    const { seedOrgData } = await import("@core/business/seed/mod.ts");
    const result = await seedOrgData(b.orgId as any);
    return { ok: true, orgId: b.orgId, message: `Seeded ${result.created.length} users` };
  }

  @Post("super-admin/org-wipe") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  async wipeOrg(@Body() body: GenericBodyRequest) {
    const b = body as { orgId?: string; confirm?: string };
    if (!b.orgId) return { error: "orgId required" };
    if (b.confirm !== "YES") return { error: "confirm:YES required" };
    const { wipeKv } = await import("@audit/domain/business/admin-backfills/mod.ts");
    const result = await wipeKv(b.orgId as any, "YES");
    if (!result.ok) return { error: result.error ?? "refused" };
    return { ok: true, message: `Wiped ${result.deleted} keys for org ${b.orgId}` };
  }

  @Post("super-admin/org-delete") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  async deleteOrgSuper(@Body() body: GenericBodyRequest) {
    const b = body as { orgId?: string; confirm?: string };
    if (!b.orgId) return { error: "orgId required" };
    if (b.confirm !== "DELETE") return { error: "confirm:DELETE required" };
    const { wipeKv } = await import("@audit/domain/business/admin-backfills/mod.ts");
    const { deleteOrg, listUsers, deleteUser } = await import("@core/business/auth/mod.ts");
    const users = await listUsers(b.orgId as any).catch(() => []);
    for (const u of users) await deleteUser(b.orgId as any, u.email).catch(() => {});
    const wipe = await wipeKv(b.orgId as any, "YES");
    await deleteOrg(b.orgId as any);
    return { ok: true, message: `Deleted org ${b.orgId} — removed ${users.length} users + ${wipe.deleted ?? 0} KV keys` };
  }

  // -- Token usage --
  @Get("token-usage") @ReturnedType(TokenUsageResponse)
  async tokenUsage(@Query("hours") hours: string) { return getTokenUsage(parseInt(hours || "1")); }

  // -- Unreviewed --
  @Get("unreviewed-audits") @ReturnedType(MessageResponse)
  async getUnreviewedAudits(
    @Query("since") sinceQ: string,
    @Query("until") untilQ: string,
    @Query("type") typeQ: string,
    @Query("owner") ownerQ: string,
    @Query("department") departmentQ: string,
    @Query("shift") shiftQ: string,
    @Query("scoreMin") scoreMinQ: string,
    @Query("scoreMax") scoreMaxQ: string,
  ) {
    const now = Date.now();
    const since = parseDateOrMs(sinceQ, false) ?? (now - 7 * 24 * 3600 * 1000);
    const until = parseDateOrMs(untilQ, true) ?? now;
    const type = typeQ || "all";
    const owner = ownerQ || "";
    const department = departmentQ || "";
    const shift = shiftQ || "";
    const scoreMin = scoreMinQ ? parseInt(scoreMinQ, 10) : 0;
    const scoreMax = scoreMaxQ ? parseInt(scoreMaxQ, 10) : 100;

    const { queryAuditDoneIndex } = stats;
    const { getReviewedFindingIds } = await import("@review/domain/business/review-queue/mod.ts");
    const { getFinding } = await import("@audit/domain/data/audit-repository/mod.ts");

    const [indexEntries, reviewedIds, bypassCfg] = await Promise.all([
      queryAuditDoneIndex(ORG(), since, until),
      getReviewedFindingIds(ORG()),
      cfg.getOfficeBypassConfig(ORG()),
    ]);
    const bypassPatterns = (bypassCfg.patterns ?? []).map((p: string) => p.toLowerCase());
    const isBypassed = (dept: string) =>
      bypassPatterns.length > 0 && bypassPatterns.some((p: string) => dept.toLowerCase().includes(p));

    const unreviewed = indexEntries.filter((e: any) => {
      if (reviewedIds.has(e.findingId)) return false;
      if (e.reason === "perfect_score" || e.reason === "invalid_genie") return false;
      if (isBypassed(e.department ?? "")) return false;
      if (type === "date-leg" && e.isPackage) return false;
      if (type === "package" && !e.isPackage) return false;
      if (owner && (e.voName || e.owner) !== owner) return false;
      if (department && e.department !== department) return false;
      if (shift && e.shift !== shift) return false;
      if (e.score != null && (e.score < scoreMin || e.score > scoreMax)) return false;
      return true;
    });

    const items = await Promise.all(unreviewed.slice(0, 500).map(async (e: any) => {
      if (e.voName !== undefined || e.owner !== undefined) {
        return { findingId: e.findingId, recordId: e.recordId, voName: e.voName, owner: e.owner, department: e.department, shift: e.shift, score: e.score, isPackage: e.isPackage, ts: e.completedAt };
      }
      const finding = await getFinding(ORG(), e.findingId);
      if (!finding) return { findingId: e.findingId, recordId: e.recordId, score: e.score, ts: e.completedAt };
      const rec = (finding as Record<string, unknown>).record as Record<string, unknown> | undefined;
      const isPkg = (finding as any).recordingIdField === "GenieNumber";
      const rawVo = String(rec?.VoName ?? "");
      const vo = rawVo.includes(" - ") ? rawVo.split(" - ").slice(1).join(" - ").trim() : rawVo.trim();
      return {
        findingId: e.findingId,
        recordId: e.recordId ?? String(rec?.RecordId ?? ""),
        voName: vo || undefined,
        owner: (finding as any).owner as string | undefined,
        department: String(isPkg ? (rec?.OfficeName ?? "") : (rec?.ActivatingOffice ?? "")) || undefined,
        shift: isPkg ? undefined : String(rec?.Shift ?? "") || undefined,
        score: e.score,
        isPackage: isPkg,
        ts: e.completedAt,
      };
    }));

    const owners = [...new Set(items.map((i: any) => i.voName || i.owner).filter(Boolean))].sort();
    const departments = [...new Set(items.map((i: any) => i.department).filter(Boolean))].sort();
    const shifts = [...new Set(items.map((i: any) => i.shift).filter(Boolean))].sort();
    return { items, total: unreviewed.length, owners, departments, shifts };
  }
}

/** Accept either a YYYY-MM-DD date string or a ms-since-epoch number; return ms.
 *  endOfDay=true rounds the date string up to the last ms of that day. */
function parseDateOrMs(v: unknown, endOfDay: boolean): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00` : s);
  if (Number.isNaN(ms)) return null;
  return endOfDay ? ms + 24 * 60 * 60 * 1000 - 1 : ms;
}
