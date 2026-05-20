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
  // Both retry-finding entry points drain the prior run's derived state
  // (review-queue rows, audit-done-idx, completed-audit-stat, chargeback /
  // wire entries) BEFORE re-publishing the step. Without this drain, retrying
  // a finding that already finalized once left orphans: the dashboard kept
  // showing it in "Recently Completed" (stale completed-audit-stat row) and
  // the review queue kept un-decided rows pointing at a finding whose
  // answeredQuestions had been wiped by step-prepare. Drain-then-re-publish
  // guarantees the next run rebuilds derived state from clean inputs.
  @Post("retry-finding") @ReturnedType(OkResponse) @BodyType(GenericBodyRequest)
  async retryFinding(@Body() body: { findingId: string; step?: string }) {
    const step = body.step ?? "init";
    const { resetFindingDerivedState } = await import("@review/domain/business/review-queue/mod.ts");
    await resetFindingDerivedState(ORG(), body.findingId);
    await publishStep(step, { findingId: body.findingId, orgId: ORG() });
    return { ok: true, step };
  }
  @Get("retry-finding") @ReturnedType(OkResponse)
  async retryFindingGet(@Query("findingId") findingId: string, @Query("step") step: string) {
    const { resetFindingDerivedState } = await import("@review/domain/business/review-queue/mod.ts");
    await resetFindingDerivedState(ORG(), findingId);
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
    const { resetFindingDerivedState } = await import("@review/domain/business/review-queue/mod.ts");
    await resetFindingDerivedState(ORG(), b.findingId);
    const { publishStep: pub } = await import("@core/data/qstash/mod.ts");
    await pub("init", { findingId: b.findingId, orgId: ORG() });
    return { ok: true, message: "Finding re-queued for re-audit" };
  }
  @Post("flip-answer") @ReturnedType(OkResponse) @BodyType(GenericBodyRequest)
  async flipAnswer(@Body() body: GenericBodyRequest) {
    const b = body as any;
    if (!b.findingId) return { error: "findingId required" };
    // `flippedBy` is the admin's email, threaded through from the frontend
    // (which reads ctx.state.user.email). Stamps onto review-done.reviewedBy
    // + per-question reviewedBy so the judge view shows who flipped the
    // audit when an agent later appeals it. Falls back to "admin" if not
    // supplied (older clients / direct curl).
    const flippedBy = (typeof b.flippedBy === "string" && b.flippedBy.trim()) ? String(b.flippedBy).trim() : "admin";
    // If questionIndex provided, flip that single question; otherwise flip all No→Yes (legacy).
    if (typeof b.questionIndex === "number" && Number.isInteger(b.questionIndex)) {
      const { adminFlipQuestion } = await import("@review/domain/business/review-queue/mod.ts");
      const result = await adminFlipQuestion(ORG(), b.findingId, b.questionIndex, flippedBy);
      return { ok: result.success, score: result.score, answer: result.answer };
    }
    const { adminFlipFindingLegacy } = await import("@review/domain/business/review-queue/mod.ts");
    const result = await adminFlipFindingLegacy(ORG(), b.findingId, flippedBy);
    return { ok: result.success, score: result.score };
  }
  /** Count unique audited records across both Firestore (audit-done-idx)
   *  and legacy KV (audit-finding). Deduped by recordId — re-audits of the
   *  same record collapse to one. Split by package vs date-leg.
   *
   *  Source choice:
   *  - Firestore: audit-done-idx has recordId + isPackage as top-level
   *    fields; listStoredByCompletedAt uses the existing composite index
   *    on completedAt so a date range filter is fast (subsecond for a
   *    day, 5-15s for a year). No new index required.
   *  - KV: legacy findings predate audit-done-idx, so we walk
   *    `[orgId, "audit-finding", findingId, "0"]` chunk-0 docs and pull
   *    out record.RecordId + recordingIdField. Slower because each
   *    finding requires a body read; bounded by KV's typical drain
   *    state post-migration. Skippable via ?skipKv=true.
   *
   *  Both walks are wrapped in try/catch so a partial wedge in one store
   *  doesn't fail the whole report. Returns whatever counts were
   *  collectable plus per-source error fields if anything blew up. */
  @Get("audit-counts") @ReturnedType(MessageResponse)
  async auditCounts(
    @Query("since") since: string,
    @Query("until") until: string,
    @Query("skipKv") skipKv: string,
  ) {
    const orgId = ORG();
    const sinceMs = parseInt(since ?? "", 10);
    const untilMs = parseInt(until ?? "", 10);
    const from = Number.isFinite(sinceMs) && sinceMs > 0 ? sinceMs : 0;
    const to = Number.isFinite(untilMs) && untilMs > 0 ? untilMs : Date.now();
    const wantKv = skipKv !== "true" && skipKv !== "1";
    const tStart = Date.now();
    const fsResult: { packagesUnique: number; dateLegsUnique: number; recordsUnique: number; rowsScanned: number; error?: string; tookMs?: number } = {
      packagesUnique: 0, dateLegsUnique: 0, recordsUnique: 0, rowsScanned: 0,
    };
    const kvResult: { packagesUnique: number; dateLegsUnique: number; recordsUnique: number; rowsScanned: number; error?: string; tookMs?: number } = {
      packagesUnique: 0, dateLegsUnique: 0, recordsUnique: 0, rowsScanned: 0,
    };
    const combinedPackages = new Set<string>();
    const combinedDateLegs = new Set<string>();

    // ── Firestore via audit-done-idx ──
    try {
      const fsT0 = Date.now();
      const { listStoredByCompletedAt } = await import("@core/data/firestore/mod.ts");
      const entries = await listStoredByCompletedAt<{
        recordId?: string; isPackage?: boolean; findingId?: string;
      }>("audit-done-idx", orgId, from, to, { limit: 500_000 });
      const fsPackages = new Set<string>();
      const fsDateLegs = new Set<string>();
      for (const e of entries) {
        const rid = String(e.recordId ?? "").trim();
        if (!rid) continue;
        if (e.isPackage) { fsPackages.add(rid); combinedPackages.add(rid); }
        else { fsDateLegs.add(rid); combinedDateLegs.add(rid); }
      }
      fsResult.packagesUnique = fsPackages.size;
      fsResult.dateLegsUnique = fsDateLegs.size;
      fsResult.recordsUnique = fsPackages.size + fsDateLegs.size;
      fsResult.rowsScanned = entries.length;
      fsResult.tookMs = Date.now() - fsT0;
    } catch (err) {
      fsResult.error = (err as Error).message ?? String(err);
      console.error(`❌ [AUDIT-COUNTS] firestore walk failed:`, err);
    }

    // ── KV legacy via audit-finding ──
    if (wantKv) {
      try {
        const kvT0 = Date.now();
        const { getKv, orgKey } = await import("@core/data/deno-kv/mod.ts");
        const db = await getKv();
        const kvPackages = new Set<string>();
        const kvDateLegs = new Set<string>();
        let rows = 0;
        const seenFindingIds = new Set<string>();
        // Iterate every audit-finding key. The doc body lives at chunk-0
        // (legacy chunked layout: [..., "audit-finding", fid, "0"]). One
        // findingId can produce several rows in this scan (header + chunks);
        // we dedupe by findingId before reading the body, and skip findings
        // we've already counted.
        for await (const entry of db.list({ prefix: orgKey(orgId, "audit-finding") })) {
          rows++;
          const key = entry.key as Deno.KvKey;
          if (key.length < 3) continue;
          const fid = typeof key[2] === "string" ? key[2] as string : "";
          if (!fid || seenFindingIds.has(fid)) continue;
          seenFindingIds.add(fid);
          // Read the chunk-0 body to extract record.RecordId + recordingIdField.
          // If the legacy KV layout used a different chunk shape, the values
          // are simply missing and we skip this finding.
          const body = (entry.value as Record<string, unknown> | undefined) ?? undefined;
          if (!body) continue;
          const completedAt = Number((body as { completedAt?: number }).completedAt ?? 0);
          if (from > 0 && completedAt && completedAt < from) continue;
          if (to < Date.now() && completedAt && completedAt > to) continue;
          const record = (body as { record?: Record<string, unknown> }).record ?? {};
          const recRid = record.RecordId ?? record.GenieNumber ?? record.RelatedDestinationId;
          if (recRid == null || String(recRid).trim() === "") continue;
          const rid = String(recRid).trim();
          const isPackage = (body as { recordingIdField?: string }).recordingIdField === "GenieNumber";
          if (isPackage) { kvPackages.add(rid); combinedPackages.add(rid); }
          else { kvDateLegs.add(rid); combinedDateLegs.add(rid); }
        }
        kvResult.packagesUnique = kvPackages.size;
        kvResult.dateLegsUnique = kvDateLegs.size;
        kvResult.recordsUnique = kvPackages.size + kvDateLegs.size;
        kvResult.rowsScanned = rows;
        kvResult.tookMs = Date.now() - kvT0;
      } catch (err) {
        kvResult.error = (err as Error).message ?? String(err);
        console.error(`❌ [AUDIT-COUNTS] kv walk failed:`, err);
      }
    }

    return {
      ok: true,
      range: { sinceMs: from, untilMs: to, allTime: from === 0 && to >= Date.now() - 1000 },
      firestore: fsResult,
      kv: wantKv ? kvResult : { skipped: true },
      combined: {
        packagesUnique: combinedPackages.size,
        dateLegsUnique: combinedDateLegs.size,
        recordsUnique: combinedPackages.size + combinedDateLegs.size,
      },
      totalTookMs: Date.now() - tStart,
    };
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
    // `flippedBy` — see flip-answer comment above. Same pattern.
    const flippedBy = (typeof b.flippedBy === "string" && b.flippedBy.trim()) ? String(b.flippedBy).trim() : "admin";
    const { adminFlipFindingLegacy } = await import("@review/domain/business/review-queue/mod.ts");

    // Parallelize within the batch — 10 in flight. 50 sequential × ~500ms
    // = 25s (right at edge timeout). Parallel-10: ~2-3s per batch.
    const PARALLEL = 10;
    const results: Array<{ id: string; ok: boolean }> = [];
    for (let i = 0; i < findingIds.length; i += PARALLEL) {
      const chunk = findingIds.slice(i, i + PARALLEL);
      const r = await Promise.all(chunk.map(async (fid) => {
        try {
          const res = await adminFlipFindingLegacy(ORG(), fid, flippedBy);
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

  // -- Index test harness ---------------------------------------------------
  // Fires a minimal-scope listStoredByCompletedAt query for the named
  // (type, fieldName) pair. Used by the Data Maintenance → Index Tests tab
  // during the index-rollout branch to verify that the Firestore composite
  // index `(_org, _type, <fieldName>, __name__)` exists before swapping
  // production callsites to the indexed path. On FAILED_PRECONDITION
  // (missing index) Firestore returns an error message containing a
  // https://console.firebase.google.com/... URL — we extract that and
  // surface it to the operator so they can one-click create the index.
  //
  // Limit is intentionally tiny (1 row) so the test stays cheap even on
  // large stores. We only care whether the index exists, not the data.
  @Post("index-test") @ReturnedType(MessageResponse)
  async indexTest(@Query("name") name: string) {
    const orgId = ORG();
    const { listStoredByCompletedAt } = await import("@core/data/firestore/mod.ts");

    const TESTS: Record<string, { type: string; fieldName: string }> = {
      "review-active-claimedAt": { type: "review-active", fieldName: "claimedAt" },
      "review-pending-completedAt": { type: "review-pending", fieldName: "completedAt" },
      "review-active-completedAt": { type: "review-active", fieldName: "completedAt" },
      "completed-audit-stat-ts": { type: "completed-audit-stat", fieldName: "ts" },
      "chargeback-entry-ts": { type: "chargeback-entry", fieldName: "ts" },
      "wire-deduction-entry-ts": { type: "wire-deduction-entry", fieldName: "ts" },
      "audit-finding-startedAt": { type: "audit-finding", fieldName: "startedAt" },
    };

    const test = TESTS[name];
    if (!test) return { ok: false, error: `unknown test: ${name}` };

    const t0 = Date.now();
    try {
      const rows = await listStoredByCompletedAt<Record<string, unknown>>(
        test.type,
        orgId,
        0,
        Date.now(),
        { fieldName: test.fieldName, limit: 1 },
      );
      return { ok: true, type: test.type, fieldName: test.fieldName, rows: rows.length, tookMs: Date.now() - t0 };
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      // Firestore returns 'FAILED_PRECONDITION' with a console URL in the
      // error body when the composite index is missing. The URL is the
      // load-bearing piece — clicking it lets the operator create the
      // index in one round-trip.
      const urlMatch = msg.match(/https:\/\/console\.firebase\.google\.com\/[^\s"'`]+/);
      const missingIndex = msg.includes("FAILED_PRECONDITION") || msg.includes("requires an index");
      return {
        ok: false,
        type: test.type,
        fieldName: test.fieldName,
        tookMs: Date.now() - t0,
        error: msg,
        createIndexUrl: urlMatch?.[0],
        missingIndex,
      };
    }
  }

  // Count-comparison companion to /admin/index-test. Same (type, fieldName)
  // tests, but runs BOTH the indexed query and a brute-force scan on the
  // same window, then reports:
  //   - indexedCount: rows the field-filter query returned
  //   - legacyInWindow: rows the brute-force scan found that ARE in window
  //                     (per the in-JS filter)
  //   - legacyMissingField: rows in the store that don't have <fieldName>
  //                         at all (these would be silently excluded by the
  //                         indexed query — the smoking gun for legacy data)
  //   - delta: legacyInWindow - indexedCount (should be 0 if no exclusions)
  //
  // Window is fixed at 30 days for the smoke comparison; that's wide enough
  // to surface field-coverage gaps without scanning the whole history. The
  // brute-force step uses listStoredWithKeysAll, which pulls full bodies —
  // intentionally slow on big stores, but tolerable for an on-demand
  // one-off button. Skipped for audit-finding (chunked store; full body
  // pull is the exact wedge we built the index to avoid).
  @Post("index-test-compare") @ReturnedType(MessageResponse)
  async indexTestCompare(@Query("name") name: string) {
    const orgId = ORG();
    const { listStoredByCompletedAt, listStoredWithKeysAll } = await import("@core/data/firestore/mod.ts");

    const TESTS: Record<string, { type: string; fieldName: string; chunked?: boolean }> = {
      "review-active-claimedAt": { type: "review-active", fieldName: "claimedAt" },
      "review-pending-completedAt": { type: "review-pending", fieldName: "completedAt" },
      "review-active-completedAt": { type: "review-active", fieldName: "completedAt" },
      "completed-audit-stat-ts": { type: "completed-audit-stat", fieldName: "ts" },
      "chargeback-entry-ts": { type: "chargeback-entry", fieldName: "ts" },
      "wire-deduction-entry-ts": { type: "wire-deduction-entry", fieldName: "ts" },
      "audit-finding-startedAt": { type: "audit-finding", fieldName: "startedAt", chunked: true },
    };

    const test = TESTS[name];
    if (!test) return { ok: false, error: `unknown test: ${name}` };

    if (test.chunked) {
      return {
        ok: false,
        type: test.type,
        fieldName: test.fieldName,
        skipped: true,
        skipReason: "Chunked store — brute-force scan would wedge on full body pulls. The indexed path is the only viable read; chunked-finding gap is tracked separately.",
      };
    }

    const untilMs = Date.now();
    const sinceMs = untilMs - 30 * 24 * 60 * 60 * 1000;

    const t0 = Date.now();
    let indexedCount = 0;
    let indexedError: string | undefined;
    try {
      const indexed = await listStoredByCompletedAt<Record<string, unknown>>(
        test.type, orgId, sinceMs, untilMs,
        { fieldName: test.fieldName, limit: 10_000 },
      );
      indexedCount = indexed.length;
    } catch (err) {
      indexedError = String((err as Error)?.message ?? err);
    }

    const t1 = Date.now();
    const allRows = await listStoredWithKeysAll<Record<string, unknown>>(test.type, orgId);
    let legacyInWindow = 0;
    let legacyMissingField = 0;
    const missingSample: string[] = [];
    for (const { key, value } of allRows) {
      if (!value) continue;
      const fieldVal = (value as Record<string, unknown>)[test.fieldName];
      if (typeof fieldVal !== "number") {
        legacyMissingField++;
        if (missingSample.length < 5) missingSample.push(String(key[0] ?? ""));
        continue;
      }
      if (fieldVal >= sinceMs && fieldVal <= untilMs) legacyInWindow++;
    }
    const t2 = Date.now();

    return {
      ok: true,
      type: test.type,
      fieldName: test.fieldName,
      windowSinceMs: sinceMs,
      windowUntilMs: untilMs,
      indexedCount,
      indexedError,
      indexedTookMs: t1 - t0,
      legacyTotalScanned: allRows.length,
      legacyInWindow,
      legacyMissingField,
      missingSample,
      delta: legacyInWindow - indexedCount,
      legacyTookMs: t2 - t1,
      tookMs: t2 - t0,
    };
  }

  // -- Reconcile drift: finalize already-100% pending findings --
  // One-shot cleanup for the pencil-flip drift bug. Pencil-flips raised a
  // finding's score to 100 but never drained review-pending / review-active,
  // leaving the audit "pending" forever. This sweeps the current queue and
  // finalizes any finding whose live score is already 100, without touching
  // answeredQuestions or the score itself. adminFlipQuestion now auto-
  // finalizes at 100 so future drift is prevented.
  @Post("reconcile-perfect-pending") @ReturnedType(MessageResponse)
  async reconcilePerfectPending() {
    const { reconcilePerfectPending } = await import("@review/domain/business/review-queue/mod.ts");
    return reconcilePerfectPending(ORG(), "admin-sweep");
  }

  // Chunked sweep — kickoff. Lists every unique findingId in
  // completed-audit-stat and returns it as a flat array. The frontend
  // then iterates the list in 25-fid chunks via /sweep-orphaned-process.
  // This avoids the edge timeout that hit the single-call sweep when
  // completed-audit-stat grew past ~1k rows.
  @Post("sweep-orphaned-list-fids") @ReturnedType(MessageResponse)
  async sweepOrphanedListFids(@Body() body: GenericBodyRequest) {
    const orgId = ORG();
    const b = body as { sinceMs?: number; untilMs?: number };
    const sinceMs = Number(b?.sinceMs ?? 0);
    const untilMs = Number(b?.untilMs ?? 0);
    const useIndex = sinceMs > 0 && untilMs > 0 && untilMs >= sinceMs;
    const seen = new Set<string>();
    const fids: string[] = [];
    if (useIndex) {
      // Server-side ts-range filter on completed-audit-stat. Useful for
      // "sweep today" / "sweep this week" workflows — no full-store walk.
      // Compare verified equivalence on the 30-day window (9526/9526).
      const { listStoredByCompletedAt } = await import("@core/data/firestore/mod.ts");
      const rows = await listStoredByCompletedAt<{ findingId?: string }>(
        "completed-audit-stat", orgId, sinceMs, untilMs,
        { fieldName: "ts", limit: 100_000 },
      );
      for (const v of rows) {
        const fid = v?.findingId;
        if (fid && !seen.has(fid)) { seen.add(fid); fids.push(fid); }
      }
      console.log(`📋 [SWEEP-LIST-FIDS] mode=ts-range sinceMs=${sinceMs} untilMs=${untilMs} total=${fids.length}`);
    } else {
      const { listStoredWithKeysAll } = await import("@core/data/firestore/mod.ts");
      const rows = await listStoredWithKeysAll<{ findingId?: string }>("completed-audit-stat", orgId);
      for (const { value } of rows) {
        const fid = value?.findingId;
        if (fid && !seen.has(fid)) { seen.add(fid); fids.push(fid); }
      }
      console.log(`📋 [SWEEP-LIST-FIDS] mode=all total=${fids.length}`);
    }
    return { ok: true, fids };
  }

  // Chunked sweep — per-batch worker. Receives a batch of fids; for each one
  // bypasses the per-isolate finding cache (so isolates that cached a stale
  // "finished" value re-read fresh state from Firestore), checks whether
  // the finding is in a terminal state with answeredQuestions populated,
  // and drains derived state otherwise. Returns counts so the frontend can
  // update its progress fragment.
  @Post("sweep-orphaned-process") @ReturnedType(MessageResponse)
  async sweepOrphanedProcess(@Body() body: GenericBodyRequest) {
    const orgId = ORG();
    const b = body as { fids?: string[] };
    const fids = Array.isArray(b.fids) ? b.fids : [];
    if (fids.length === 0) return { ok: true, swept: 0, healthy: 0, missing: 0, drained: [] };
    const { getFinding, invalidateFindingCache } = await import("@audit/domain/data/audit-repository/mod.ts");
    const { resetFindingDerivedState } = await import("@review/domain/business/review-queue/mod.ts");
    let swept = 0, healthy = 0, missing = 0;
    const drained: string[] = [];
    for (const fid of fids) {
      invalidateFindingCache(orgId, fid);
      const finding = await getFinding(orgId, fid);
      if (!finding) {
        await resetFindingDerivedState(orgId, fid);
        missing++; swept++; drained.push(fid);
        continue;
      }
      const status = (finding as { findingStatus?: string }).findingStatus;
      const answered = (finding as { answeredQuestions?: unknown[] }).answeredQuestions;
      const hasAnswers = Array.isArray(answered) && answered.length > 0;
      if (status !== "finished" || !hasAnswers) {
        await resetFindingDerivedState(orgId, fid);
        swept++; drained.push(fid);
      } else {
        healthy++;
      }
    }
    return { ok: true, swept, healthy, missing, drained };
  }

  // List unique findingIds. Two modes:
  //  (a) If sinceMs/untilMs provided → uses listStoredByCompletedAt against
  //      audit-finding with fieldName="startedAt", which translates to a
  //      server-side Firestore field-filter query. Returns ONLY the docs
  //      whose startedAt falls in range — no broad scan, no chunked body
  //      pulls. This is the path the Re-trigger flow takes when the
  //      operator leaves the textarea empty and just picks today/today.
  //  (b) No dates → falls back to listStoredKeysAll (keys-only) for the
  //      full enumeration. Kept for any caller that legitimately wants
  //      every fid (currently unused but cheap to keep).
  // Note: the field filter only matches docs whose body has startedAt as
  // a top-level field. Un-chunked audit-finding docs (the common case;
  // most findings are < 700KB) qualify. Chunked findings whose header is
  // {totalChunks, totalBytes} would be missed — that's a known gap and
  // why the textarea-paste path still exists for one-offs.
  @Post("list-all-finding-ids") @ReturnedType(MessageResponse)
  async listAllFindingIds(@Body() body: GenericBodyRequest) {
    const orgId = ORG();
    const b = body as { sinceMs?: number; untilMs?: number };
    const sinceMs = Number(b?.sinceMs ?? 0);
    const untilMs = Number(b?.untilMs ?? 0);
    if (sinceMs > 0 && untilMs > 0 && untilMs >= sinceMs) {
      const { listStoredByCompletedAt } = await import("@core/data/firestore/mod.ts");
      const docs = await listStoredByCompletedAt<Record<string, unknown>>(
        "audit-finding",
        orgId,
        sinceMs,
        untilMs,
        { fieldName: "startedAt", limit: 10_000 },
      );
      const seen = new Set<string>();
      const fids: string[] = [];
      for (const doc of docs) {
        if (!doc) continue;
        const fid = String((doc as { id?: string }).id ?? "");
        if (!fid || seen.has(fid)) continue;
        seen.add(fid);
        fids.push(fid);
      }
      console.log(`📋 [LIST-FINDING-IDS] mode=startedAt-range sinceMs=${sinceMs} untilMs=${untilMs} returned=${fids.length}`);
      return { ok: true, fids };
    }

    const { listStoredKeysAll } = await import("@core/data/firestore/mod.ts");
    const rows = await listStoredKeysAll("audit-finding", orgId);
    const seen = new Set<string>();
    const fids: string[] = [];
    for (const { key } of rows) {
      const fid = String(key[0] ?? "");
      if (!fid || seen.has(fid)) continue;
      seen.add(fid);
      fids.push(fid);
    }
    console.log(`📋 [LIST-FINDING-IDS] mode=all-keys returned=${fids.length} totalKeys=${rows.length}`);
    return { ok: true, fids };
  }

  // Per-fid date+status check for the Re-trigger flow. Takes a batch of
  // fids (typically 25 at a time from the frontend tick loop) plus a
  // [sinceMs, untilMs] window. For each fid, does a single chunked
  // getFinding read and returns whether it matches: findingStatus !==
  // "finished" AND startedAt in range. Replaces the previous broad
  // audit-finding scan which 503'd because listStoredWithKeysAll pulls
  // full bodies — fine for tiny stores but multi-hundred-MB for chunked
  // audit-finding. The frontend gets the candidate fid list from
  // somewhere else (typically the Sweep result's drained-IDs disclosure
  // or operator paste).
  @Post("check-fids-for-retrigger") @ReturnedType(MessageResponse)
  async checkFidsForRetrigger(@Body() body: GenericBodyRequest) {
    const orgId = ORG();
    const b = body as { fids?: string[]; sinceMs?: number; untilMs?: number };
    const fids = Array.isArray(b.fids) ? b.fids : [];
    const since = Number(b.sinceMs ?? 0);
    const until = Number(b.untilMs ?? Date.now());
    if (fids.length === 0) return { ok: true, matches: [], outOfRange: 0, finished: 0, missing: 0 };
    const { getFinding } = await import("@audit/domain/data/audit-repository/mod.ts");
    const matches: string[] = [];
    let outOfRange = 0, finished = 0, missing = 0;
    for (const fid of fids) {
      const f = await getFinding(orgId, fid);
      if (!f) { missing++; continue; }
      const status = (f as { findingStatus?: string }).findingStatus;
      if (status === "finished") { finished++; continue; }
      const startedAt = Number((f as { startedAt?: number }).startedAt ?? 0);
      if (startedAt < since || startedAt > until) { outOfRange++; continue; }
      matches.push(fid);
    }
    return { ok: true, matches, outOfRange, finished, missing };
  }

  // Re-trigger a batch of fids by re-publishing step-init. Caller is
  // expected to have already swept these (so completed-audit-stat /
  // audit-done-idx / review-* are clean). QStash queue parallelism caps
  // (audit-transcribe=8, audit-questions=4) throttle the resulting load
  // naturally — we just enqueue; workers pull at their configured rate.
  @Post("retrigger-fids-batch") @ReturnedType(MessageResponse)
  async retriggerFidsBatch(@Body() body: GenericBodyRequest) {
    const orgId = ORG();
    const b = body as { fids?: string[] };
    const fids = Array.isArray(b.fids) ? b.fids : [];
    let requeued = 0;
    const failed: string[] = [];
    for (const fid of fids) {
      try {
        await publishStep("init", { findingId: fid, orgId });
        requeued++;
      } catch (err) {
        console.warn(`⚠️ [RETRIGGER] ${fid} publishStep failed:`, err);
        failed.push(fid);
      }
    }
    return { ok: true, requeued, failed };
  }

  // [DEPRECATED in favor of the chunked sweep-orphaned-list-fids /
  // sweep-orphaned-process pair above, but retained for any caller that
  // already wires to it.] Sweep findings that appear in "Recently Completed"
  // (completed-audit-stat) but whose finding doc is NOT in a finished state.
  @Post("sweep-orphaned-completed") @ReturnedType(MessageResponse)
  async sweepOrphanedCompleted() {
    const orgId = ORG();
    const { listStoredWithKeysAll } = await import("@core/data/firestore/mod.ts");
    const { getFinding, invalidateFindingCache } = await import("@audit/domain/data/audit-repository/mod.ts");
    const { resetFindingDerivedState } = await import("@review/domain/business/review-queue/mod.ts");
    // Use the paginated *All variant — listStoredWithKeys caps at 1000 rows.
    // Without this, completed-audit-stat rows past page 1 would be invisible
    // to the sweep. That cap was why NLbvBCPh-6cnm9RSB2ZLo stayed stuck even
    // after the first sweep reported swept=7.
    const rows = await listStoredWithKeysAll<{ findingId?: string }>("completed-audit-stat", orgId);
    const seen = new Set<string>();
    let scanned = 0, swept = 0, healthy = 0, missing = 0;
    for (const { value } of rows) {
      const fid = value?.findingId;
      if (!fid || seen.has(fid)) continue;
      seen.add(fid);
      scanned++;
      // Bypass the per-isolate getFinding cache — when a finding was reset
      // to populating-questions by another isolate, this isolate may still
      // have a cached "finished" value and would mis-classify the orphan
      // as healthy. Invalidating forces a fresh Firestore read.
      invalidateFindingCache(orgId, fid);
      const finding = await getFinding(orgId, fid);
      if (!finding) {
        await resetFindingDerivedState(orgId, fid);
        missing++; swept++;
        continue;
      }
      const status = (finding as { findingStatus?: string }).findingStatus;
      const answered = (finding as { answeredQuestions?: unknown[] }).answeredQuestions;
      const hasAnswers = Array.isArray(answered) && answered.length > 0;
      if (status !== "finished" || !hasAnswers) {
        await resetFindingDerivedState(orgId, fid);
        swept++;
      } else {
        healthy++;
      }
    }
    console.log(`🧹 [SWEEP-ORPHANED] scanned=${scanned} swept=${swept} healthy=${healthy} missing=${missing}`);
    return { ok: true, scanned, swept, healthy, missing };
  }

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
      // Server-side date filter on review-pending/active.completedAt —
      // returns only items whose completedAt is in the requested window
      // instead of the full queue. The downstream per-fid getFinding
      // loop still re-checks completedAt against the finding doc as
      // belt-and-suspenders (finding.completedAt is the authoritative
      // value; the queue entry's completedAt is a copy made at queue
      // time).
      getPendingReviewFindings(ORG(), { sinceMs: since, untilMs: until }),
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
      // Defense: invalid_genie (autofail) audits should never reach the
      // review queue per step-finalize's gating, but if one slips through
      // we must NOT allow bulk-flip to mark it 100%. Same detection logic
      // as step-finalize/mod.ts:64 — rawTranscript marker or no-recording
      // status.
      const rawTx = (finding as any).rawTranscript as string | undefined;
      const isInvalidGenie = (rawTx && (rawTx.includes("Invalid Genie") || rawTx.includes("Genie Invalid")))
        || (finding as any).findingStatus === "no recording";
      if (isInvalidGenie) return null;
      const sample = pending.get(fid);
      const completedAt = ((finding as any).completedAt as number | undefined)
        ?? (sample?.completedAt as number | undefined)
        ?? 0;
      // Date range filter against the finding's completedAt (authoritative).
      if (completedAt && (completedAt < since || completedAt > until)) return null;
      // Score derivation: prefer reviewScore (set by review/admin-flip),
      // else compute from answeredQuestions (the finding doc never stores
      // a precomputed audit score field — it's always derived from the
      // Yes/No tally, same way step-finalize/mod.ts and the audit-report
      // view compute it).
      let liveScore: number;
      if (typeof (finding as any).reviewScore === "number") {
        liveScore = (finding as any).reviewScore;
      } else {
        const answered = (finding as any).answeredQuestions as Array<{ answer?: string }> | undefined;
        if (Array.isArray(answered) && answered.length > 0) {
          const yeses = answered.filter((q) =>
            String(q?.answer ?? "").trim().toLowerCase().startsWith("y")
          ).length;
          liveScore = Math.round((yeses / answered.length) * 100);
        } else {
          liveScore = 0;
        }
      }
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
    // Total reflects post-filter count so the UI's "N found" matches what
    // the user actually sees. The pre-filter pending count is logged so
    // operators can spot when filters are aggressive.
    if (items.length < pending.size) {
      console.log(`📊 [UNREVIEWED] ${items.length} match of ${pending.size} pending (${pending.size - items.length} dropped by date/score/invalid-genie/facet filters)`);
    }
    return { items, total: items.length, owners, departments, shifts };
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
