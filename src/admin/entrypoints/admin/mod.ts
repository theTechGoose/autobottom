/** Admin config + pipeline management controller — wired to real repositories. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body, Query } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import * as cfg from "@admin/domain/data/admin-repository/mod.ts";
import * as stats from "@audit/domain/data/stats-repository/mod.ts";
import { pauseAllQueues, resumeAllQueues, purgeAllQueues, getQueueCounts, getQueueInfo, setQstashQueueParallelism } from "@core/data/qstash/mod.ts";
import { publishStep } from "@core/data/qstash/mod.ts";
import { clearReviewQueue } from "@review/domain/business/review-queue/mod.ts";
import { getTokenUsage } from "@audit/domain/data/groq/mod.ts";
import { ReturnedType, Description, BodyType } from "#danet/swagger-decorators";
import { PipelineConfigResponse, ParallelismResponse, WebhookConfigResponse, BadWordConfigResponse, BypassConfigResponse, BonusConfigResponse, DimensionsResponse, PartnerDimensionsResponse, QueueCountsResponse, OkResponse, OkMessageResponse, ClearedResponse, TerminatedResponse, TokenUsageResponse, MessageResponse } from "@core/dto/responses.ts";
import { GenericBodyRequest } from "@core/dto/requests.ts";
import { defaultOrgId } from "@core/business/auth/mod.ts";
import { runInBackgroundLane } from "@core/data/firestore/mod.ts";
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
  async getBadWordConfig() {
    try { return await cfg.getBadWordConfig(ORG()); }
    catch (err) {
      console.warn(`⚠️ [BAD-WORD-CONFIG] failed — soft fallback:`, err);
      return { enabled: false, emails: [], words: [], allOffices: false, officePatterns: [], retry: true };
    }
  }
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

  /** NUKE every queued message from QStash for all three audit queues.
   *  Use when n8n bulk-fired more than the system can handle and you need
   *  to start over rather than wait the backlog out. Caller is responsible
   *  for also clearing active-tracking via /admin/terminate-all-active or
   *  letting the watchdog sweep stale entries. Returns the count purged. */
  @Post("purge-queues") @ReturnedType(OkMessageResponse)
  async purgeQueues() {
    const purged = await purgeAllQueues();
    console.log(`💣 [ADMIN] Purged ${purged} messages from all QStash queues`);
    return { ok: true, message: `purged ${purged} messages` };
  }

  /** Read QStash's CURRENT queue settings — the source of truth for
   *  whether our parallelism push actually applied. Returns parallelism +
   *  messageCount + paused state for each of the three audit queues. */
  @Get("queue-info") @ReturnedType(MessageResponse)
  async queueInfo() {
    const info = await getQueueInfo();
    return { ok: true, queues: info };
  }

  /** Push parallelism to a specific QStash queue. Body OR query:
   *  { queueName: "audit-transcribe" | "audit-questions" | "audit-cleanup",
   *    parallelism: <integer> }
   *  Returns the new queue-info after the push so the caller can verify
   *  it landed. QStash enforces parallelism server-side — once set, no
   *  more than that many messages of that queue can be in-flight. */
  @Post("set-queue-parallelism") @ReturnedType(MessageResponse) @BodyType(GenericBodyRequest)
  async setQueueParallelism(@Body() body: GenericBodyRequest, @Query("queueName") queueQ: string, @Query("parallelism") parallelismQ: string) {
    const b = (body ?? {}) as { queueName?: string; parallelism?: number };
    const queueName = (b.queueName ?? queueQ ?? "").trim();
    const parallelism = b.parallelism ?? parseInt(parallelismQ || "0", 10);
    if (!queueName) return { error: "queueName required" };
    if (!Number.isFinite(parallelism) || parallelism < 1) return { error: "parallelism must be a positive integer" };
    const result = await setQstashQueueParallelism(queueName, parallelism);
    if (!result.ok) return { ok: false, error: result.error };
    const info = await getQueueInfo();
    return { ok: true, set: { queueName, parallelism }, queues: info };
  }

  /** FAST bulk-delete of active-tracking + watchdog entries via Firestore's
   *  `:commit` batch endpoint — up to 500 deletes per HTTP call. Per-row
   *  parallel deletes (the previous approach) consistently blew the 60s
   *  isolate timeout once there were ~700 rows because each delete is its
   *  own round-trip. The batch-commit path completes hundreds of rows in
   *  one or two HTTP calls and finishes in seconds even under Firestore
   *  load. Use this whenever the dashboard shows stale tracking from
   *  crashed step runs. */
  @Post("nuke-tracking") @ReturnedType(OkMessageResponse)
  async nukeTracking() {
    const orgId = ORG();
    const { purgeByTypeAndOrg } = await import("@core/data/firestore/mod.ts");
    const [activeCleared, watchdogCleared] = await Promise.all([
      purgeByTypeAndOrg("active-tracking", orgId),
      purgeByTypeAndOrg("watchdog-active", ""),
    ]);
    const cleared = activeCleared + watchdogCleared;
    console.log(`💣 [ADMIN] Nuked ${cleared} tracking entries (active=${activeCleared} watchdog=${watchdogCleared})`);
    return { ok: true, message: `nuked ${cleared} entries (${activeCleared} active + ${watchdogCleared} watchdog)` };
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
    // Hard cap at 50 per request. Sequential bulk-flip with 500 IDs took
    // ~4 minutes and 503'd at the edge timeout. The frontend now chunks
    // into batches of 50 and sends sequential POSTs via the flip-start
    // /flip-tick worker pattern; rejecting >50 here is defense in depth
    // against any caller (including a misbehaving client) that bypasses
    // chunking.
    const MAX_PER_CALL = 50;
    if (findingIds.length > MAX_PER_CALL) {
      return { error: `batch too large (max ${MAX_PER_CALL}, got ${findingIds.length})`, retry: false };
    }
    const { adminFlipFindingLegacy } = await import("@review/domain/business/review-queue/mod.ts");

    // Parallelize within the batch — 10 in flight. 50 sequential × ~500ms
    // = 25s (right at edge timeout). Parallel-10: ~2-3s per batch.
    const PARALLEL = 10;
    const results: Array<{ id: string; ok: boolean }> = [];
    for (let i = 0; i < findingIds.length; i += PARALLEL) {
      const chunk = findingIds.slice(i, i + PARALLEL);
      const r = await Promise.all(chunk.map(async (fid) => {
        try {
          const res = await adminFlipFindingLegacy(ORG(), fid);
          return { id: fid, ok: res.success };
        } catch (err) {
          console.warn(`⚠️ [BULK-FLIP] ${fid} failed:`, err);
          return { id: fid, ok: false };
        }
      }));
      results.push(...r);
    }
    const flipped = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok).map((r) => r.id);
    return { ok: failed.length === 0, flipped, total: findingIds.length, failed, ...(failed.length ? { retry: true } : {}) };
  }

  /** Debug helper for inspecting suspected migration-orphan audits.
   *
   *  Reads ONLY the audit-finding header doc (no chunked read) + a couple
   *  of cross-references. Designed to NOT wedge: every call is a 1-doc
   *  getDoc + 1-doc getStored. Lets the admin paste a finding id from the
   *  bulk-flip table and get an immediate yes/no on whether the audit is
   *  populated normally or looks like migration debris. */
  @Get("debug/orphan-inspect") @ReturnedType(MessageResponse)
  async orphanInspect(@Query("id") id: string) {
    if (!id) return { error: "id required" };
    const orgId = ORG();
    try {
      const { getDoc, getStored, encodeDocId } = await import("@core/data/firestore/mod.ts");
      const docId = encodeDocId("audit-finding", orgId, id);
      const headerDoc = await getDoc(docId) as Record<string, unknown> | null;
      if (!headerDoc) {
        return { findingId: id, headerExists: false, verdict: "MISSING (no audit-finding doc)" };
      }

      const record = headerDoc.record as Record<string, unknown> | undefined;
      const answeredQuestions = Array.isArray(headerDoc.answeredQuestions) ? headerDoc.answeredQuestions : [];
      const recordFieldCount = record ? Object.keys(record).length : 0;
      const hasRecordIdentity = !!(record?.RecordId || record?.VoName || record?.ActivatingOffice);
      const transcriptInline = typeof headerDoc.rawTranscript === "string" && (headerDoc.rawTranscript as string).length > 0;
      const transcriptChunked = headerDoc.transcriptChunked === true || (headerDoc as Record<string, unknown>).transcriptChunkCount != null;

      // Migration-casualty heuristics: a properly-completed audit has a
      // record block with identity, a transcript reference, AND answered
      // questions. Anything missing two-of-three is highly likely a casualty.
      const flags: string[] = [];
      if (!hasRecordIdentity) flags.push("no record identity (RecordId/VoName/ActivatingOffice all missing)");
      if (!transcriptInline && !transcriptChunked) flags.push("no transcript reference");
      if (answeredQuestions.length === 0) flags.push("no answered questions");
      if (recordFieldCount < 3) flags.push(`record has only ${recordFieldCount} fields`);
      if (!headerDoc.completedAt) flags.push("no completedAt timestamp");

      const verdict = flags.length === 0
        ? "LOOKS NORMAL"
        : flags.length >= 2
          ? "LIKELY MIGRATION CASUALTY"
          : "PARTIAL — review manually";

      const reviewDone = await getStored("review-done", orgId, id) as Record<string, unknown> | null;

      return {
        findingId: id,
        headerExists: true,
        verdict,
        flags,
        findingStatus: headerDoc.findingStatus,
        completedAt: headerDoc.completedAt,
        completedAtIso: typeof headerDoc.completedAt === "number" ? new Date(headerDoc.completedAt as number).toISOString() : null,
        reviewedAt: headerDoc.reviewedAt,
        reviewScore: headerDoc.reviewScore,
        owner: headerDoc.owner,
        recordFieldCount,
        answeredQuestionsCount: answeredQuestions.length,
        transcriptInline,
        transcriptChunked,
        recordSample: record ? {
          RecordId: record.RecordId,
          VoName: record.VoName,
          ActivatingOffice: record.ActivatingOffice,
          OfficeName: record.OfficeName,
          VoEmail: record.VoEmail,
        } : null,
        inReviewDone: !!reviewDone,
        reviewDoneAt: reviewDone ? (reviewDone as { reviewedAt?: string }).reviewedAt : null,
      };
    } catch (err) {
      console.warn(`⚠️ [ORPHAN-INSPECT] ${id} failed:`, err);
      return { findingId: id, error: "inspect failed", detail: err instanceof Error ? err.message : String(err) };
    }
  }

  // -- Backfills --
  // All backfill / purge / dedup ops run inside runInBackgroundLane so
  // their FS pressure is capped at 5 slots and can never starve foreground
  // (login, dashboard, audit-step). See firestore/mod.ts for lane sizing.
  @Post("backfill-review-scores") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  async backfillReviewScores(@Body() body: GenericBodyRequest) {
    const { since, until } = body as any;
    if (!since || !until) return { error: "since and until required" };
    const { backfillReviewScores } = await import("@audit/domain/business/admin-backfills/mod.ts");
    return runInBackgroundLane(async () => ({ ok: true, ...(await backfillReviewScores(ORG(), since, until)) }));
  }
  @Post("backfill-chargeback-entries") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  async backfillChargebackEntries(@Body() body: GenericBodyRequest) {
    const { since, until } = body as any;
    if (!since || !until) return { error: "since and until required" };
    const { backfillChargebackEntriesLegacy: backfill } = await import("@judge/domain/data/judge-repository/mod.ts");
    return runInBackgroundLane(() => backfill(ORG(), since, until));
  }
  @Post("backfill-partner-dimensions") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  async backfillPartnerDimensions(@Body() body: GenericBodyRequest) {
    const { cursor } = body as any;
    const { backfillPartnerDimensions } = await import("@audit/domain/business/admin-backfills/mod.ts");
    return runInBackgroundLane(async () => ({ ok: true, ...(await backfillPartnerDimensions(ORG(), cursor)) }));
  }
  @Post("backfill-audit-index") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  async backfillAuditIndex(@Body() body: GenericBodyRequest) {
    const { cursor } = body as any;
    const { backfillAuditDoneIndex } = await import("@audit/domain/business/admin-backfills/mod.ts");
    return runInBackgroundLane(async () => ({ ok: true, ...(await backfillAuditDoneIndex(ORG(), cursor)) }));
  }
  @Post("backfill-stale-scores") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  async backfillStaleScores(@Body() body: GenericBodyRequest) {
    const { cursor } = body as any;
    const { backfillStaleScores } = await import("@audit/domain/business/admin-backfills/mod.ts");
    return runInBackgroundLane(async () => ({ ok: true, ...(await backfillStaleScores(ORG(), cursor)) }));
  }
  // ── Dedup job state (per-isolate, in-memory) ────────────────────────────
  // Holds in-flight + recently-completed dedup runs so the maintenance
  // modal can show a progress bar instead of hanging the HTTP request
  // for the entire 5-10 minute dedup duration. Jobs auto-evict after
  // 10 minutes; we never accumulate more than a handful at a time.
  private static _dedupJobs = new Map<string, {
    phase: "scanning" | "deleting" | "done" | "error";
    total: number;
    deleted: number;
    startedAt: number;
    finishedAt?: number;
    error?: string;
    dryRun: boolean;
    plan?: { scanned: number; groups: number; orphaned: number };
  }>();

  private static _evictOldDedupJobs() {
    const cutoff = Date.now() - 10 * 60_000;
    for (const [id, job] of AdminConfigController._dedupJobs) {
      if ((job.finishedAt ?? job.startedAt) < cutoff) {
        AdminConfigController._dedupJobs.delete(id);
      }
    }
  }

  /** Kick off a dedup job. Returns immediately with a jobId; the actual
   *  scan + delete runs fire-and-forget in the background lane so the
   *  HTTP request doesn't sit open for 5-10 minutes. The maintenance
   *  modal polls /admin/deduplicate-status?jobId=… for progress. */
  @Post("deduplicate-findings") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  async deduplicateFindings(@Body() body: GenericBodyRequest) {
    const b = body as any;
    const since = parseDateOrMs(b.since, false);
    const until = parseDateOrMs(b.until, true);
    if (since == null || until == null) return { error: "since and until required (date YYYY-MM-DD or ms)" };
    AdminConfigController._evictOldDedupJobs();
    const jobId = `dedup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    AdminConfigController._dedupJobs.set(jobId, {
      phase: "scanning",
      total: 0,
      deleted: 0,
      startedAt: Date.now(),
      dryRun: !b.execute,
    });

    // Fire-and-forget. .catch is mandatory — an unhandled rejection here
    // would crash the isolate (Deno Deploy semantics, see commit 6fc28ee
    // for the dashboard SWR variant of this same trap).
    (async () => {
      try {
        const { findDuplicatesLegacy, deleteDuplicatesLegacy } = await import("@judge/domain/data/judge-repository/mod.ts");
        const plan = await runInBackgroundLane(() => findDuplicatesLegacy(ORG(), since, until));
        const losers = (plan.toDelete as Array<{ keep?: boolean }> ?? []).filter((d) => !d.keep).length;
        const job = AdminConfigController._dedupJobs.get(jobId);
        if (job) {
          job.plan = { scanned: plan.scanned, groups: plan.groups, orphaned: plan.orphaned };
          job.total = losers;
          job.phase = b.execute ? "deleting" : "done";
        }
        if (b.execute) {
          await runInBackgroundLane(() =>
            deleteDuplicatesLegacy(ORG(), plan as any, (deleted, total) => {
              const j = AdminConfigController._dedupJobs.get(jobId);
              if (j) { j.deleted = deleted; j.total = total; }
            })
          );
          const j = AdminConfigController._dedupJobs.get(jobId);
          if (j) { j.phase = "done"; j.finishedAt = Date.now(); }
        } else {
          const j = AdminConfigController._dedupJobs.get(jobId);
          if (j) { j.finishedAt = Date.now(); }
        }
      } catch (err) {
        console.error(`[DEDUP:${jobId}] ❌ async run threw:`, err);
        const j = AdminConfigController._dedupJobs.get(jobId);
        if (j) {
          j.phase = "error";
          j.error = (err as Error).message;
          j.finishedAt = Date.now();
        }
      }
    })().catch((err) => {
      // Defense-in-depth: the inner try/catch should already catch
      // everything, but never let an unhandled rejection escape.
      console.error(`[DEDUP:${jobId}] ❌ outer guard:`, err);
    });

    return { ok: true, jobId, message: b.execute ? "Dedup started" : "Dry-run started" };
  }

  /** Poll dedup job state. Called every 2s by the maintenance modal's
   *  progress fragment until phase = done | error. */
  @Get("deduplicate-status") @ReturnedType(MessageResponse)
  deduplicateStatus(@Query("jobId") jobId: string) {
    if (!jobId) return { ok: false, error: "jobId required" };
    const job = AdminConfigController._dedupJobs.get(jobId);
    if (!job) return { ok: false, error: `job ${jobId} not found (may have expired)` };
    return { ok: true, jobId, ...job };
  }

  // -- Purge --
  @Post("purge-old-audits") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  async purgeOldAudits(@Body() body: GenericBodyRequest) {
    const b = body as any;
    const since = parseDateOrMs(b.since, false) ?? 0;
    const before = parseDateOrMs(b.before, true);
    if (before == null) return { error: "before required (date YYYY-MM-DD or ms)" };
    const { purgeOldEntries } = await import("@audit/domain/business/admin-backfills/mod.ts");
    return runInBackgroundLane(async () => ({ ok: true, ...(await purgeOldEntries(ORG(), since, before)) }));
  }
  @Post("purge-bypassed-wire-deductions") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  async purgeBypassedWireDeductions(@Body() body: GenericBodyRequest) {
    const { purgeBypassedWireDeductions } = await import("@audit/domain/business/admin-backfills/mod.ts");
    const bypassCfg = await cfg.getOfficeBypassConfig(ORG());
    const patterns = ((body as any)?.patterns as string[]) ?? bypassCfg.patterns ?? [];
    return runInBackgroundLane(async () => ({ ok: true, ...(await purgeBypassedWireDeductions(ORG(), patterns)) }));
  }

  // -- State management --
  // DESTRUCTIVE — requires body { confirm: "YES" } to proceed.
  @Post("wipe-kv") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  async wipeKv(@Body() body: GenericBodyRequest) {
    const confirm = (body as any)?.confirm as string | undefined;
    const { wipeKv } = await import("@audit/domain/business/admin-backfills/mod.ts");
    return runInBackgroundLane(async () => {
      const result = await wipeKv(ORG(), confirm ?? "");
      if (!result.ok) return { ok: false, message: result.error ?? "refused" };
      return { ok: true, message: `wiped ${result.deleted} keys` };
    });
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
    return runInBackgroundLane(async () => {
      const result = await importKv(ORG(), "YES", (b.entries ?? []) as Array<{ type: string; org: string; key: string[]; value: unknown }>);
      if (!result.ok) return { ok: false, message: result.error ?? "import failed" };
      return { ok: true, message: `Wrote ${result.written ?? 0} keys, skipped ${result.skipped ?? 0}` };
    });
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
   try {
    const now = Date.now();
    const since = parseDateOrMs(sinceQ, false) ?? (now - 7 * 24 * 3600 * 1000);
    const until = parseDateOrMs(untilQ, true) ?? now;
    const type = typeQ || "all";
    const owner = ownerQ || "";
    const department = departmentQ || "";
    const shift = shiftQ || "";
    const scoreMin = scoreMinQ ? parseInt(scoreMinQ, 10) : 0;
    const scoreMax = scoreMaxQ ? parseInt(scoreMaxQ, 10) : 100;

    const { getPendingReviewFindings } = await import("@review/domain/business/review-queue/mod.ts");
    const { getFinding } = await import("@audit/domain/data/audit-repository/mod.ts");

    // Drive the list from review-pending — that store IS the review queue.
    // Previously we drove from audit-done-idx and filtered, which fought the
    // data shape: 22k+ index entries, ~98% noise (orphans, drift, pencil-
    // flipped-not-finalized 100%-ers), <2% survival into the bulk-flip list.
    // review-pending is authoritative and bounded by what reviewers actually
    // need to act on, so the list now reflects the real queue.
    const [pending, bypassCfg] = await Promise.all([
      getPendingReviewFindings(ORG()),
      cfg.getOfficeBypassConfig(ORG()),
    ]);
    const bypassPatterns = (bypassCfg.patterns ?? []).map((p: string) => p.toLowerCase());
    const isBypassed = (dept: string) =>
      bypassPatterns.length > 0 && bypassPatterns.some((p: string) => dept.toLowerCase().includes(p));

    // Enrich each pending finding with its finding-doc metadata + apply
    // facet/date/score filters using the LIVE finding data. Capped at 500
    // for response-size sanity; total reflects raw pending count so the UI
    // hint "showing first 500 of N" stays meaningful.
    const pendingIds = [...pending.keys()];
    const enriched = await Promise.all(pendingIds.slice(0, 500).map(async (fid) => {
      const finding = await getFinding(ORG(), fid);
      if (!finding) return null; // shouldn't normally happen — pending without a finding doc is broken state
      const sample = pending.get(fid);
      const completedAt = ((finding as any).completedAt as number | undefined)
        ?? (sample?.completedAt as number | undefined)
        ?? 0;
      // Date range filter against the finding's completedAt (authoritative).
      if (completedAt && (completedAt < since || completedAt > until)) return null;
      const liveScore = typeof (finding as any).reviewScore === "number"
        ? (finding as any).reviewScore
        : (typeof (finding as any).score === "number" ? (finding as any).score : 0);
      if (liveScore < scoreMin || liveScore > scoreMax) return null;
      const rec = (finding as Record<string, unknown>).record as Record<string, unknown> | undefined;
      const isPkg = (finding as any).recordingIdField === "GenieNumber";
      if (type === "date-leg" && isPkg) return null;
      if (type === "package" && !isPkg) return null;
      const dept = String(isPkg ? (rec?.OfficeName ?? "") : (rec?.ActivatingOffice ?? ""));
      if (isBypassed(dept)) return null;
      const rawVo = String(rec?.VoName ?? "");
      const vo = rawVo.includes(" - ") ? rawVo.split(" - ").slice(1).join(" - ").trim() : rawVo.trim();
      const findingOwner = (finding as any).owner as string | undefined;
      const shiftVal = isPkg ? undefined : (String(rec?.Shift ?? "") || undefined);
      if (owner && (vo || findingOwner) !== owner) return null;
      if (department && dept !== department) return null;
      if (shift && shiftVal !== shift) return null;
      return {
        findingId: fid,
        recordId: String(rec?.RecordId ?? "") || sample?.recordId || "",
        voName: vo || undefined,
        owner: findingOwner,
        department: dept || undefined,
        shift: shiftVal,
        score: liveScore,
        isPackage: isPkg,
        ts: completedAt || undefined,
      };
    }));
    const items = enriched.filter((x): x is NonNullable<typeof x> => x !== null);

    const owners = [...new Set(items.map((i: any) => i.voName || i.owner).filter(Boolean))].sort();
    const departments = [...new Set(items.map((i: any) => i.department).filter(Boolean))].sort();
    const shifts = [...new Set(items.map((i: any) => i.shift).filter(Boolean))].sort();
    return { items, total: pending.size, owners, departments, shifts };
   } catch (err) {
     // Soft-fallback: this endpoint is heavy (Promise.all over 3 FS scans
     // + per-row getFinding fan-out). Any chunk wedge under load aborts
     // the whole thing. Empty-result shape matches a legitimate no-match
     // response so the frontend renders gracefully.
     console.warn(`⚠️ [UNREVIEWED-AUDITS] failed — soft fallback:`, err);
     return { items: [], total: 0, owners: [], departments: [], shifts: [], retry: true };
   }
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
