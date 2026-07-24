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
import { defaultOrgId, listUsers } from "@core/business/auth/mod.ts";
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

  /** Reconcile manager-scope records against the live user list. A deleted
   *  user used to leave its scope doc behind, so the Weekly Builder kept
   *  listing — and emailing — dead addresses. Dry-run by default; pass
   *  { confirm: true } to actually delete the orphaned scope docs. Email
   *  membership is compared case-insensitively; deletes use the stored key. */
  @Post("cleanup-orphan-scopes") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  async cleanupOrphanScopes(@Body() body: { confirm?: boolean }) {
    const org = ORG();
    const [scopes, users] = await Promise.all([
      cfg.listManagerScopes(org),
      listUsers(org),
    ]);
    const liveEmails = new Set(users.map((u) => u.email.toLowerCase()));
    const orphans = Object.keys(scopes).filter((email) => !liveEmails.has(email.toLowerCase()));
    const list = orphans.join(", ") || "(none)";

    if (!body?.confirm) {
      return { ok: true, message: `DRY RUN — ${orphans.length} orphaned scope(s) (not deleted): ${list}` };
    }
    for (const email of orphans) await cfg.deleteManagerScope(org, email);
    console.log(`🧹 [ADMIN] Deleted ${orphans.length} orphaned manager-scope docs: ${list}`);
    return { ok: true, message: `Deleted ${orphans.length} orphaned scope(s): ${list}` };
  }

  // -- Queue management --
  @Get("queues") @ReturnedType(QueueCountsResponse)
  async getQueues() { return getQueueCounts(); }

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

  /** Re-sync every queue to its Firestore-persisted parallelism (or hard-coded
   *  default if no persisted value). Useful after manual changes in the QStash
   *  dashboard left the live caps diverged from what the operator set in the
   *  Pipeline modal. Same code path boot uses — exposed so ops can hit it
   *  without a redeploy. */
  @Post("apply-default-parallelism") @ReturnedType(MessageResponse)
  async applyDefaultParallelism() {
    const t0 = Date.now();
    try {
      const { applyDefaultQueueParallelism } = await import("@core/data/qstash/mod.ts");
      const results = await applyDefaultQueueParallelism();
      const failed = results.filter((r) => !r.ok).length;
      console.log(`🔧 [QSTASH] apply-default-parallelism done failed=${failed}/${results.length} tookMs=${Date.now() - t0}`);
      return { ok: failed === 0, results, tookMs: Date.now() - t0 };
    } catch (err) {
      console.error("❌ [QSTASH] apply-default-parallelism failed:", err);
      return { ok: false, error: (err as Error).message ?? String(err), tookMs: Date.now() - t0 };
    }
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
  // A full re-run (step === "init") ALSO clears the finding doc's own run
  // state. Restarting from a later step deliberately does not — resuming at
  // e.g. "finalize" needs the transcript and answers the earlier steps wrote.
  @Post("retry-finding") @ReturnedType(OkResponse) @BodyType(GenericBodyRequest)
  async retryFinding(@Body() body: { findingId: string; step?: string }) {
    const step = body.step ?? "init";
    const { resetFindingDerivedState } = await import("@review/domain/business/review-queue/mod.ts");
    await resetFindingDerivedState(ORG(), body.findingId);
    if (step === "init") {
      const { clearFindingRunState } = await import("@audit/domain/data/audit-repository/mod.ts");
      await clearFindingRunState(ORG(), body.findingId);
    }
    await publishStep(step, { findingId: body.findingId, orgId: ORG() });
    return { ok: true, step };
  }
  @Get("retry-finding") @ReturnedType(OkResponse)
  async retryFindingGet(@Query("findingId") findingId: string, @Query("step") step: string) {
    const { resetFindingDerivedState } = await import("@review/domain/business/review-queue/mod.ts");
    await resetFindingDerivedState(ORG(), findingId);
    if ((step || "init") === "init") {
      const { clearFindingRunState } = await import("@audit/domain/data/audit-repository/mod.ts");
      await clearFindingRunState(ORG(), findingId);
    }
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
    const { clearFindingRunState } = await import("@audit/domain/data/audit-repository/mod.ts");
    const existed = await clearFindingRunState(ORG(), b.findingId);
    if (!existed) return { error: `finding not found: ${b.findingId}` };
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

    // ── KV legacy via completed-audit-stat ──
    // The audit-finding bodies in legacy KV are stored as JSON string slices
    // across N chunks (lib/storage/chunked-kv.ts in pre-cutover prod). That
    // means iterating __audit-finding__ produces ~3-5 ~30KB rows per finding
    // whose values are partial JSON strings — too slow to walk at production
    // scale (45s timed out at 4k rows / 26k findings) and chunk-0 alone won't
    // JSON.parse for any finding whose serialized body exceeds 30KB (most
    // post-completion findings, since the transcript is embedded).
    //
    // completed-audit-stat is the right index: one small, unchunked entry
    // per finding with { findingId, ts, recordId, isPackage, startedAt, ... }
    // top-level. Same data Firestore's audit-done-idx mirrors. Per
    // KNOWN_TYPED_STORE_PREFIXES it's a TypedStore (`__completed-audit-stat__`)
    // and is NOT in CHUNKED_ONLY_TYPED_STORE_PREFIXES — so each entry is a
    // direct object, not chunked slices.
    //
    // 503-prevention rails:
    //  - HARD row cap (300k) so a runaway scan never blocks the request.
    //  - Time budget (45s) leaves 15s headroom under Deno Deploy's 60s budget.
    //  - try/catch converts any thrown error into kvResult.error — no path
    //    can bubble a 503 out of this endpoint.
    if (wantKv) {
      const KV_ROW_CAP = 300_000;
      const KV_TIME_BUDGET_MS = 45_000;
      try {
        const kvT0 = Date.now();
        const { getKv } = await import("@core/data/deno-kv/mod.ts");
        const db = await getKv();
        const kvPackages = new Set<string>();
        const kvDateLegs = new Set<string>();
        let rows = 0;
        let capped = false;
        let timedOut = false;
        for await (const entry of db.list({ prefix: ["__completed-audit-stat__", orgId] })) {
          rows++;
          if (rows >= KV_ROW_CAP) { capped = true; break; }
          if (Date.now() - kvT0 > KV_TIME_BUDGET_MS) { timedOut = true; break; }
          // Expected shape: ["__completed-audit-stat__", orgId, findingId].
          const body = entry.value as {
            recordId?: string; isPackage?: boolean; ts?: number; startedAt?: number;
          } | null;
          if (!body) continue;
          const ts = Number(body.ts ?? body.startedAt ?? 0);
          if (from > 0 && ts && ts < from) continue;
          if (to < Date.now() && ts && ts > to) continue;
          const rid = String(body.recordId ?? "").trim();
          if (!rid) continue;
          if (body.isPackage) { kvPackages.add(rid); combinedPackages.add(rid); }
          else { kvDateLegs.add(rid); combinedDateLegs.add(rid); }
        }
        kvResult.packagesUnique = kvPackages.size;
        kvResult.dateLegsUnique = kvDateLegs.size;
        kvResult.recordsUnique = kvPackages.size + kvDateLegs.size;
        kvResult.rowsScanned = rows;
        kvResult.tookMs = Date.now() - kvT0;
        if (capped) (kvResult as Record<string, unknown>).capped = `row-cap ${KV_ROW_CAP} reached — re-run with a tighter date range for full counts`;
        if (timedOut) (kvResult as Record<string, unknown>).capped = `time-budget ${KV_TIME_BUDGET_MS}ms reached — re-run with a tighter date range for full counts`;
      } catch (err) {
        kvResult.error = (err as Error).message ?? String(err);
        console.error(`❌ [AUDIT-COUNTS] kv walk failed:`, err);
      }
    }

    // ── KV total via __audit-job__ (exact count, fast) ──
    // AuditJob is a flat TypedStore — one tiny unchunked doc per saveJob call,
    // and saveJob fires exactly once per pipeline run. So this prefix walk
    // gives the authoritative finding count without depending on whether the
    // pipeline reached finalize (completed-audit-stat) or whether the body
    // is parseable from chunk-0 (audit-finding deep). Values are sub-1KB so
    // bandwidth is trivial.
    const kvFindingsResult: { count: number; rowsScanned: number; tookMs?: number; error?: string; capped?: string } = {
      count: 0, rowsScanned: 0,
    };
    if (wantKv) {
      const KV_JOB_ROW_CAP = 500_000;
      const KV_JOB_TIME_BUDGET_MS = 20_000;
      try {
        const t0 = Date.now();
        const { getKv } = await import("@core/data/deno-kv/mod.ts");
        const db = await getKv();
        const findingIds = new Set<string>();
        let rows = 0;
        let capped = false;
        let timedOut = false;
        for await (const entry of db.list({ prefix: ["__audit-job__", orgId] })) {
          rows++;
          if (rows >= KV_JOB_ROW_CAP) { capped = true; break; }
          if (Date.now() - t0 > KV_JOB_TIME_BUDGET_MS) { timedOut = true; break; }
          // Expected shape: ["__audit-job__", orgId, jobId]. jobId 1:1 with finding.
          const key = entry.key as Deno.KvKey;
          const jobId = typeof key[2] === "string" ? key[2] : "";
          if (jobId) findingIds.add(jobId);
        }
        kvFindingsResult.count = findingIds.size;
        kvFindingsResult.rowsScanned = rows;
        kvFindingsResult.tookMs = Date.now() - t0;
        if (capped) kvFindingsResult.capped = `row-cap ${KV_JOB_ROW_CAP} reached`;
        if (timedOut) kvFindingsResult.capped = `time-budget ${KV_JOB_TIME_BUDGET_MS}ms reached`;
      } catch (err) {
        kvFindingsResult.error = (err as Error).message ?? String(err);
        console.error(`❌ [AUDIT-COUNTS] audit-job walk failed:`, err);
      }
    }

    // ── KV deep via __audit-finding__ chunk-0 regex (best-effort split) ──
    // Legacy ChunkedKv serializes the finding as JSON then splits into 30KB
    // string slices keyed by numeric chunk index. Chunk-0 contains the start
    // of the JSON string — `recordingIdField` and `record.RecordId` are
    // assigned in startAudit early in the finding lifecycle, so they land
    // in the first ~1KB of the JSON and the regex catches them for nearly
    // every finding. The few outliers (unusual JSON layouts pushing the
    // fields past 30KB) just don't get categorized; they're still counted
    // in the audit-job walk above, so the gap is visible.
    //
    // Bandwidth: ~27k chunk-0 entries × 30KB ≈ 800MB at scale. Time budget
    // raised to 50s. Non-chunk-0 entries are still iterated (Deno KV has no
    // keysOnly mode) but processed as no-op so JS time is negligible.
    const kvDeepResult: {
      total: number; packagesUnique: number; dateLegsUnique: number;
      packageRids?: string[]; dateLegRids?: string[];
      rowsScanned: number; chunkZeroSeen: number;
      tookMs?: number; error?: string; capped?: string;
    } = {
      total: 0, packagesUnique: 0, dateLegsUnique: 0, rowsScanned: 0, chunkZeroSeen: 0,
    };
    if (wantKv) {
      const KV_DEEP_ROW_CAP = 500_000;
      const KV_DEEP_TIME_BUDGET_MS = 50_000;
      const RECORDING_FIELD_RE = /"recordingIdField"\s*:\s*"([^"]+)"/;
      const RECORD_ID_RE = /"RecordId"\s*:\s*(\d+)/;
      try {
        const t0 = Date.now();
        const { getKv } = await import("@core/data/deno-kv/mod.ts");
        const db = await getKv();
        const pkgRids = new Set<string>();
        const dlRids = new Set<string>();
        let rows = 0;
        let chunkZeroSeen = 0;
        let capped = false;
        let timedOut = false;
        for await (const entry of db.list({ prefix: ["__audit-finding__", orgId] })) {
          rows++;
          if (rows >= KV_DEEP_ROW_CAP) { capped = true; break; }
          if (Date.now() - t0 > KV_DEEP_TIME_BUDGET_MS) { timedOut = true; break; }
          const key = entry.key as Deno.KvKey;
          if (key.length < 4) continue;
          const tail = key[key.length - 1];
          if (tail !== 0 && tail !== "0") continue; // only chunk-0 carries the body head
          chunkZeroSeen++;
          const raw = entry.value;
          if (typeof raw !== "string") continue;
          const fieldMatch = raw.match(RECORDING_FIELD_RE);
          const ridMatch = raw.match(RECORD_ID_RE);
          if (!ridMatch) continue;
          const rid = ridMatch[1].trim();
          if (!rid) continue;
          if (fieldMatch && fieldMatch[1] === "GenieNumber") {
            pkgRids.add(rid); combinedPackages.add(rid);
          } else {
            dlRids.add(rid); combinedDateLegs.add(rid);
          }
        }
        kvDeepResult.total = chunkZeroSeen;
        kvDeepResult.packagesUnique = pkgRids.size;
        kvDeepResult.dateLegsUnique = dlRids.size;
        kvDeepResult.packageRids = [...pkgRids];
        kvDeepResult.dateLegRids = [...dlRids];
        kvDeepResult.rowsScanned = rows;
        kvDeepResult.chunkZeroSeen = chunkZeroSeen;
        kvDeepResult.tookMs = Date.now() - t0;
        if (capped) kvDeepResult.capped = `row-cap ${KV_DEEP_ROW_CAP} reached — partial counts`;
        if (timedOut) kvDeepResult.capped = `time-budget ${KV_DEEP_TIME_BUDGET_MS}ms reached — partial counts`;
      } catch (err) {
        kvDeepResult.error = (err as Error).message ?? String(err);
        console.error(`❌ [AUDIT-COUNTS] audit-finding deep walk failed:`, err);
      }
    }

    return {
      ok: true,
      range: { sinceMs: from, untilMs: to, allTime: from === 0 && to >= Date.now() - 1000 },
      firestore: fsResult,
      kv: wantKv ? kvResult : { skipped: true },
      kvFindings: wantKv ? kvFindingsResult : { skipped: true },
      kvDeep: wantKv ? kvDeepResult : { skipped: true },
      combined: {
        packagesUnique: combinedPackages.size,
        dateLegsUnique: combinedDateLegs.size,
        recordsUnique: combinedPackages.size + combinedDateLegs.size,
      },
      totalTookMs: Date.now() - tStart,
    };
  }

  /** Audit Counts background job — multi-tick deep scan with email delivery.
   *  See `src/admin/domain/business/audit-counts-job/mod.ts` for rationale.
   *  Operator workflow: fill in email + dates on the maintenance modal,
   *  click Count audits → this endpoint kicks off the job, returns jobId,
   *  schedules first tick. Operator gets emailed exact counts + CSV when done. */
  @Post("audit-counts/start") @ReturnedType(MessageResponse) @BodyType(GenericBodyRequest)
  async startAuditCountsJob(@Body() body: GenericBodyRequest) {
    const b = body as { email?: string; sinceMs?: number; untilMs?: number };
    const email = String(b.email ?? "").trim();
    if (!email || !email.includes("@")) return { error: "valid email required" };
    const sinceMs = Number.isFinite(b.sinceMs) && Number(b.sinceMs) > 0 ? Number(b.sinceMs) : 0;
    const untilMs = Number.isFinite(b.untilMs) && Number(b.untilMs) > 0 ? Number(b.untilMs) : Date.now();
    const { startAuditCountsJob } = await import("@admin/domain/business/audit-counts-job/mod.ts");
    const result = await startAuditCountsJob(ORG(), { email, sinceMs, untilMs });
    return { ok: true, ...result };
  }

  /** QStash callback for the audit-counts-job deep-scan tick. Self-schedules
   *  the next tick (or finalizes + emails) per the job's progress. */
  @Post("audit-counts/tick") @ReturnedType(OkResponse) @BodyType(GenericBodyRequest)
  async tickAuditCountsJob(@Body() body: GenericBodyRequest) {
    const b = body as { jobId?: string };
    const jobId = String(b.jobId ?? "").trim();
    if (!jobId) return { error: "jobId required" };
    const { tickAuditCountsJob } = await import("@admin/domain/business/audit-counts-job/mod.ts");
    await tickAuditCountsJob(ORG(), jobId);
    return { ok: true };
  }

  /** UI polling endpoint — returns the current state of a running or
   *  recently-completed audit-counts job. */
  @Get("audit-counts/status") @ReturnedType(MessageResponse)
  async statusAuditCountsJob(@Query("jobId") jobId: string) {
    if (!jobId) return { error: "jobId required" };
    const { getAuditCountsJob } = await import("@admin/domain/business/audit-counts-job/mod.ts");
    const job = await getAuditCountsJob(ORG(), jobId);
    if (!job) return { error: "job not found", jobId };
    // Strip the recordId arrays from the status response — they can be
    // 240KB+ once the deep scan accumulates and the UI doesn't need them.
    // Email + CSV deliver the full list separately.
    const { packageRids, dateLegRids, ...rest } = job;
    return {
      ok: true,
      ...rest,
      packagesUnique: packageRids.length,
      dateLegsUnique: dateLegRids.length,
    };
  }

  /** Per-question failure report. Reads pre-aggregated counter docs written
   *  by step-finalize + reviewer/admin/judge flip handlers (see
   *  @audit/domain/data/question-stats-repository/mod.ts). Bounded reads:
   *  one collection scan over the small `question-fail-stat` collection,
   *  filtered server-side by yyyymm window. NO per-finding loads. */
  @Get("question-failures") @ReturnedType(MessageResponse)
  async questionFailures(
    @Query("from") fromMonth: string,
    @Query("to") toMonth: string,
    @Query("configKey") configKey: string,
  ) {
    const t0 = Date.now();
    try {
      const { readQuestionFailRange } = await import("@audit/domain/data/question-stats-repository/mod.ts");
      const filter = configKey ? { configKey } : undefined;
      // Default to current month if from/to omitted. yyyymm format = YYYYMM.
      const nowD = new Date();
      const defMonth = `${nowD.getUTCFullYear()}${String(nowD.getUTCMonth() + 1).padStart(2, "0")}`;
      const from = (fromMonth && /^\d{6}$/.test(fromMonth)) ? fromMonth : defMonth;
      const to = (toMonth && /^\d{6}$/.test(toMonth)) ? toMonth : defMonth;
      const rows = await readQuestionFailRange(ORG(), from, to, filter);
      return { ok: true, range: { from, to }, rows, tookMs: Date.now() - t0 };
    } catch (err) {
      console.error(`❌ [QUESTION-FAILURES] read failed:`, err);
      return { ok: false, error: (err as Error).message ?? String(err), tookMs: Date.now() - t0 };
    }
  }

  /** Reset all question-fail counter state (stat buckets + per-finding marks)
   *  for this org. Use after a buggy backfill state needs a clean slate;
   *  operator re-runs their backfill chunks afterward. Bounded by the
   *  collection sizes, which are typically a few thousand docs each. */
  @Post("question-failures-reset") @ReturnedType(MessageResponse)
  async questionFailuresReset() {
    const t0 = Date.now();
    try {
      const { resetAllQuestionStats } = await import("@audit/domain/data/question-stats-repository/mod.ts");
      const { stats, marks } = await resetAllQuestionStats(ORG());
      console.log(`[QF-RESET] wiped stats=${stats} marks=${marks} tookMs=${Date.now() - t0}`);
      return { ok: true, statsDeleted: stats, marksDeleted: marks, tookMs: Date.now() - t0 };
    } catch (err) {
      console.error(`❌ [QF-RESET] aborted:`, err);
      return { ok: false, error: (err as Error).message ?? String(err), tookMs: Date.now() - t0 };
    }
  }

  /** Backfill the per-question counters from historical audit-done-idx +
   *  findings. Composable across chunks via per-finding dedup marks:
   *  each finding is counted exactly once across all backfill runs, so
   *  adjacent date ranges (e.g. Mar 1-13, Mar 13-20, Mar 20-27) compose
   *  correctly instead of wiping each other.
   *
   *  Flow:
   *    1. Walk audit-done-idx for the range.
   *    2. For each entry, skip findings that already have a "counted" mark.
   *    3. For the rest, load the finding, accumulate per-question fail
   *       counts + sample finding IDs in-memory.
   *    4. After accumulation, R-M-W each affected (configKey, questionKey,
   *       month) bucket — read existing + add the chunk's deltas + write.
   *    5. Drop counted marks so re-running the same chunk no-ops.
   *
   *  flippedToPass / flippedToFail stay at 0 from backfill; live counters
   *  get those fields incremented going forward via the review/admin/judge
   *  flip handlers. To wipe state and start over, hit /admin/question-
   *  failures-reset first. */
  @Post("question-failures-backfill") @ReturnedType(MessageResponse) @BodyType(GenericBodyRequest)
  async questionFailuresBackfill(@Body() body: GenericBodyRequest) {
    const t0 = Date.now();
    const b = body as { sinceMs?: number; untilMs?: number };
    const from = Number(b.sinceMs ?? 0);
    const to = Number(b.untilMs ?? Date.now());
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
      return { ok: false, error: "sinceMs and untilMs (ms epoch) required, to > from" };
    }
    try {
      const orgId = ORG();
      const { listStoredByCompletedAt, getStored, setStored } = await import("@core/data/firestore/mod.ts");
      const { getFinding } = await import("@audit/domain/data/audit-repository/mod.ts");
      const {
        normalizeQuestionKey, configKeyForFinding, yyyymm, hasBeenCounted, markCounted,
      } = await import("@audit/domain/data/question-stats-repository/mod.ts");

      const entries = await listStoredByCompletedAt<{ findingId?: string; completedAt?: number }>(
        "audit-done-idx",
        orgId,
        from,
        to,
        { limit: 500_000 },
      );
      console.log(`[QF-BACKFILL] entries=${entries.length} range=[${new Date(from).toISOString()}, ${new Date(to).toISOString()}]`);

      interface Bucket {
        configKey: string;
        questionKey: string;
        headerSample: string;
        yyyymm: string;
        failed: number;
        sampleFindingIds: string[];
        lastFailedAt: number;
      }
      const accum = new Map<string, Bucket>();
      let processed = 0;
      let skipped = 0;
      let failsCounted = 0;
      let errors = 0;
      const markedFindings: Array<{ id: string; when: number }> = [];

      // Per-finding work: 1 mark-check read + 1 finding read each (skipped
      // findings short-circuit after the mark-check). Sliding window of 20
      // keeps total wall-clock under Deno Deploy's request budget.
      const CONCURRENCY = 20;
      const SAMPLE_RING_SIZE = 10;
      const processOne = async (e: { findingId?: string; completedAt?: number }) => {
        if (!e.findingId || !e.completedAt) return;
        try {
          // Dedup: this finding's contributions are already in the buckets
          // (from a previous backfill chunk OR from live finalize). Skip
          // entirely so adjacent chunks compose without double-counting.
          if (await hasBeenCounted(orgId, e.findingId)) { skipped++; return; }
          const finding = await getFinding(orgId, e.findingId);
          if (!finding) return;
          const qs = (finding as Record<string, any>).answeredQuestions as any[] | undefined;
          if (!qs?.length) return;
          const cfgKey = configKeyForFinding(finding as Record<string, any>);
          const month = yyyymm(e.completedAt);
          for (const q of qs) {
            if (q.answer !== "No") continue;
            if (!q.header) continue;
            const qKey = normalizeQuestionKey(q.header);
            const k = `${cfgKey}::${qKey}::${month}`;
            let bucket = accum.get(k);
            if (!bucket) {
              bucket = {
                configKey: cfgKey, questionKey: qKey, headerSample: q.header,
                yyyymm: month, failed: 0, sampleFindingIds: [], lastFailedAt: 0,
              };
              accum.set(k, bucket);
            }
            bucket.failed++;
            if (q.header && bucket.headerSample !== q.header) bucket.headerSample = q.header;
            if (!bucket.sampleFindingIds.includes(e.findingId)) {
              bucket.sampleFindingIds.push(e.findingId);
              if (bucket.sampleFindingIds.length > SAMPLE_RING_SIZE) {
                bucket.sampleFindingIds = bucket.sampleFindingIds.slice(-SAMPLE_RING_SIZE);
              }
            }
            if (e.completedAt > bucket.lastFailedAt) bucket.lastFailedAt = e.completedAt;
            failsCounted++;
          }
          markedFindings.push({ id: e.findingId, when: e.completedAt });
          processed++;
          if (processed % 500 === 0) {
            console.log(`[QF-BACKFILL] processed ${processed} skipped ${skipped} (${Date.now() - t0}ms)`);
          }
        } catch (err) {
          errors++;
          console.warn(`⚠️ [QF-BACKFILL] finding ${e.findingId} failed:`, err);
        }
      };
      for (let i = 0; i < entries.length; i += CONCURRENCY) {
        await Promise.all(entries.slice(i, i + CONCURRENCY).map(processOne));
      }

      // R-M-W each accumulated bucket — read existing counter, add the
      // chunk's deltas, write back. This is what lets adjacent ranges
      // compose: chunk 2's deltas land on top of chunk 1's counts instead
      // of wiping them. Same concurrency pool.
      const buckets = [...accum.values()];
      let bucketsWritten = 0;
      const writeOne = async (b: Bucket) => {
        try {
          const existing = await getStored<{
            configKey: string; questionKey: string; headerSample: string; yyyymm: string;
            failed: number; flippedToPass: number; flippedToFail: number;
            sampleFindingIds: string[]; lastFailedAt?: number;
          }>("question-fail-stat", orgId, b.configKey, b.questionKey, b.yyyymm);
          // Merge: add chunk deltas onto existing, union sample IDs.
          const merged = {
            configKey: b.configKey,
            questionKey: b.questionKey,
            headerSample: b.headerSample || existing?.headerSample || b.questionKey,
            yyyymm: b.yyyymm,
            failed: (existing?.failed ?? 0) + b.failed,
            flippedToPass: existing?.flippedToPass ?? 0,
            flippedToFail: existing?.flippedToFail ?? 0,
            sampleFindingIds: [...(existing?.sampleFindingIds ?? []), ...b.sampleFindingIds]
              .filter((id, idx, arr) => arr.indexOf(id) === idx)
              .slice(-SAMPLE_RING_SIZE),
            lastFailedAt: Math.max(existing?.lastFailedAt ?? 0, b.lastFailedAt),
          };
          await setStored("question-fail-stat", orgId, [b.configKey, b.questionKey, b.yyyymm], merged);
          bucketsWritten++;
        } catch (err) {
          errors++;
          console.warn(`⚠️ [QF-BACKFILL] bucket write failed key=${b.configKey}::${b.questionKey}::${b.yyyymm}:`, err);
        }
      };
      for (let i = 0; i < buckets.length; i += CONCURRENCY) {
        await Promise.all(buckets.slice(i, i + CONCURRENCY).map(writeOne));
      }

      // Drop dedup marks AFTER bucket writes so a mid-run failure leaves the
      // chunk re-runnable (no half-counted state stuck behind missing marks).
      let marksWritten = 0;
      const markOne = async (m: { id: string; when: number }) => {
        try { await markCounted(orgId, m.id, m.when); marksWritten++; }
        catch (err) { errors++; console.warn(`⚠️ [QF-BACKFILL] mark failed fid=${m.id}:`, err); }
      };
      for (let i = 0; i < markedFindings.length; i += CONCURRENCY) {
        await Promise.all(markedFindings.slice(i, i + CONCURRENCY).map(markOne));
      }

      console.log(`[QF-BACKFILL] ✅ done processed=${processed} skipped=${skipped} failsCounted=${failsCounted} bucketsWritten=${bucketsWritten} marks=${marksWritten} errors=${errors} tookMs=${Date.now() - t0}`);
      return {
        ok: true,
        range: { sinceMs: from, untilMs: to },
        auditsProcessed: processed,
        auditsSkippedAlreadyCounted: skipped,
        failsCounted,
        bucketsWritten,
        marksWritten,
        errors,
        tookMs: Date.now() - t0,
      };
    } catch (err) {
      console.error(`❌ [QF-BACKFILL] aborted:`, err);
      return { ok: false, error: (err as Error).message ?? String(err), tookMs: Date.now() - t0 };
    }
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

  /** One-shot reconcile of the reviewedBy / review-done divergence introduced
   *  by the gap between adminFlipQuestion / adminFlipFinding (write
   *  review-done, skipped reviewedBy on the index) and backfillScores (wrote
   *  reviewedBy on the index, skipped review-done). Idempotent. */
  @Post("reconcile-reviewed-signals") @ReturnedType(OkMessageResponse)
  async reconcileReviewedSignalsEndpoint() {
    const { reconcileReviewedSignals } = await import("@audit/domain/business/admin-backfills/mod.ts");
    return runInBackgroundLane(async () => ({ ok: true, ...(await reconcileReviewedSignals(ORG())) }));
  }
  @Post("backfill-chargeback-entries") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  async backfillChargebackEntries(@Body() body: GenericBodyRequest) {
    const { since, until } = body as any;
    if (!since || !until) return { error: "since and until required" };
    const { backfillChargebackEntriesLegacy: backfill } = await import("@judge/domain/data/judge-repository/mod.ts");
    return runInBackgroundLane(() => backfill(ORG(), since, until));
  }

  // Chunked payroll/chargeback backfill — list once, then process N fids per
  // request so no single call does the full getFinding loop (Deno-Deploy-safe).
  @Post("chargeback-backfill-list") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  async chargebackBackfillList(@Body() body: GenericBodyRequest) {
    const { since, until } = body as any;
    if (!since || !until) return { ok: false, error: "since and until required" };
    const { listChargebackBackfillFids } = await import("@judge/domain/data/judge-repository/mod.ts");
    const fids = await runInBackgroundLane(() => listChargebackBackfillFids(ORG(), Number(since), Number(until)));
    return { ok: true, fids };
  }

  @Post("chargeback-backfill-process") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  async chargebackBackfillProcess(@Body() body: GenericBodyRequest) {
    const { fids } = body as any;
    if (!Array.isArray(fids)) return { ok: false, error: "fids array required" };
    const { processChargebackBackfillBatch } = await import("@judge/domain/data/judge-repository/mod.ts");
    const r = await runInBackgroundLane(() => processChargebackBackfillBatch(ORG(), fids));
    return { ok: true, ...r };
  }
  // Transcript Repair — findings whose stored `diarized` transcript is model
  // output (a refusal, or a markdown critique with the transcript in a code
  // fence) rather than speech. Same chunked list-then-process shape as the
  // chargeback backfill. `scan` mode NEVER writes; it exists so "how many are
  // impacted" can be answered before anything changes.
  @Post("transcript-repair-list") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  async transcriptRepairList(@Body() body: GenericBodyRequest) {
    const { since, until } = body as any;
    if (!since || !until) return { ok: false, error: "since and until required" };
    const { listTranscriptRepairFids } = await import("@audit/domain/business/transcript-repair/mod.ts");
    const candidates = await runInBackgroundLane(() => listTranscriptRepairFids(ORG(), Number(since), Number(until)));
    return { ok: true, candidates };
  }

  @Post("transcript-repair-process") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  async transcriptRepairProcess(@Body() body: GenericBodyRequest) {
    const { fids, mode } = body as any;
    if (!Array.isArray(fids)) return { ok: false, error: "fids array required" };
    // Anything that isn't an explicit "repair" is treated as a dry scan — a
    // dropped or mistyped field must never cause an unintended write.
    const safeMode = mode === "repair" ? "repair" : "scan";
    const { processTranscriptRepairBatch } = await import("@audit/domain/business/transcript-repair/mod.ts");
    const r = await runInBackgroundLane(() => processTranscriptRepairBatch(ORG(), fids, safeMode));
    return { ok: true, ...r };
  }

  // ── Bulk Genie Retry ──────────────────────────────────────────────────
  // Re-runs audits that finalized as "Invalid Genie" after the recording
  // database they search comes back healthy. Three endpoints, so the caller
  // owns the pacing and can hold a fixed number of audits in flight rather
  // than dumping a whole window onto Genie/AssemblyAI at once.
  @Post("genie-retry-list") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  async genieRetryList(@Body() body: GenericBodyRequest) {
    const { since, until } = body as any;
    if (!since || !until) return { ok: false, error: "since and until required" };
    const { listInvalidGenieFindings } = await import("@audit/domain/business/genie-retry/mod.ts");
    const candidates = await runInBackgroundLane(() => listInvalidGenieFindings(ORG(), Number(since), Number(until)));
    return { ok: true, candidates };
  }

  // Job lifecycle. The job lives in Firestore (see the module header) so a run
  // survives isolate swaps and deploys — the whole reason the first in-memory
  // version failed with "job not found" on every tick. Start creates it; each
  // advance does one bounded tick (poll ≤5 in-flight, requeue ≤5 more).
  @Post("genie-retry-start") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  async genieRetryStart(@Body() body: GenericBodyRequest) {
    const { since, until } = body as any;
    if (!since || !until) return { ok: false, error: "since and until required" };
    const { startGenieRetryJob } = await import("@audit/domain/business/genie-retry/mod.ts");
    const snapshot = await runInBackgroundLane(() => startGenieRetryJob(ORG(), Number(since), Number(until)));
    return { ok: true, snapshot };
  }

  @Post("genie-retry-advance") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  async genieRetryAdvance(@Body() body: GenericBodyRequest) {
    const { jobId } = body as any;
    if (!jobId) return { ok: false, error: "jobId required" };
    const { advanceGenieRetryJob } = await import("@audit/domain/business/genie-retry/mod.ts");
    const snapshot = await runInBackgroundLane(() => advanceGenieRetryJob(ORG(), String(jobId)));
    if (!snapshot) return { ok: false, error: "job not found" };
    return { ok: true, snapshot };
  }

  // Force every invalid-genie audit in a window to a 100% reviewed pass — the
  // conscious override of Bulk Flip's refusal to touch un-listened calls. Same
  // start/advance job shape as Genie Retry, persisted in Firestore.
  @Post("force-hundred-start") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  async forceHundredStart(@Body() body: GenericBodyRequest) {
    const { since, until, flippedBy } = body as any;
    if (!since || !until) return { ok: false, error: "since and until required" };
    const { startForceHundredJob } = await import("@audit/domain/business/genie-retry/mod.ts");
    const by = (typeof flippedBy === "string" && flippedBy.trim()) ? flippedBy.trim() : "admin";
    const snapshot = await runInBackgroundLane(() => startForceHundredJob(ORG(), Number(since), Number(until), by));
    return { ok: true, snapshot };
  }

  @Post("force-hundred-advance") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  async forceHundredAdvance(@Body() body: GenericBodyRequest) {
    const { jobId } = body as any;
    if (!jobId) return { ok: false, error: "jobId required" };
    const { advanceForceHundredJob } = await import("@audit/domain/business/genie-retry/mod.ts");
    const snapshot = await runInBackgroundLane(() => advanceForceHundredJob(ORG(), String(jobId)));
    if (!snapshot) return { ok: false, error: "job not found" };
    return { ok: true, snapshot };
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
    failed: number;
    startedAt: number;
    finishedAt?: number;
    error?: string;
    dryRun: boolean;
    pass?: "rows" | "records";
    plan?: { scannedRows: number; findingsWithDupes: number; staleRows: number };
    recordPlan?: { recordsWithDupes: number; losers: number; chargebacksRemoved: number; wiresRemoved: number; appealSkips: number };
  }>();

  private static _evictOldDedupJobs() {
    const cutoff = Date.now() - 10 * 60_000;
    for (const [id, job] of AdminConfigController._dedupJobs) {
      if ((job.finishedAt ?? job.startedAt) < cutoff) {
        AdminConfigController._dedupJobs.delete(id);
      }
    }
  }


  /** Kick off a dedup-rows job: collapse duplicate audit-done-idx rows so each
   *  finding keeps exactly one row (reviewed/judged, else newest), deleting the
   *  stale rows by key — never hiding a finding. Returns immediately with a
   *  jobId; the scan + delete runs fire-and-forget in the background lane. The
   *  maintenance modal polls /admin/deduplicate-status?jobId=… for progress. */
  @Post("deduplicate-findings") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  async deduplicateFindings(@Body() body: GenericBodyRequest) {
    const b = body as any;
    const since = parseDateOrMs(b.since, false);
    const until = parseDateOrMs(b.until, true);
    if (since == null || until == null) return { error: "since and until required (date YYYY-MM-DD or ms)" };
    // Explicit, defensive execute parse. The Mode <select> always submits
    // "dry"|"execute"; legacy checkbox forms (execute=true/1/on) still honoured.
    // Anything we don't recognise ⇒ dry run (fail-safe: never delete on doubt).
    // Log the raw values so a "ran but didn't delete" report is diagnosable.
    const execute = b.mode === "execute" ||
      b.execute === true || b.execute === "true" || b.execute === 1 || b.execute === "1" || b.execute === "on";
    // "rows" (default) collapses duplicate index rows of ONE finding; "records"
    // retires duplicate AUDITS of the same QB record (keeper rule + full evict).
    const pass: "rows" | "records" = b.pass === "records" ? "records" : "rows";
    console.log(`[DEDUP] start pass=${pass} since=${since} until=${until} raw.mode=${JSON.stringify(b.mode)} raw.execute=${JSON.stringify(b.execute)} → ${execute ? "EXECUTE (delete)" : "DRY RUN"}`);
    AdminConfigController._evictOldDedupJobs();
    const jobId = `dedup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    AdminConfigController._dedupJobs.set(jobId, {
      phase: "scanning",
      total: 0,
      deleted: 0,
      failed: 0,
      startedAt: Date.now(),
      dryRun: !execute,
      pass,
    });

    // Fire-and-forget. .catch is mandatory — an unhandled rejection here
    // would crash the isolate (Deno Deploy semantics, see commit 6fc28ee
    // for the dashboard SWR variant of this same trap).
    (async () => {
      try {
        if (pass === "records") {
          // Retire duplicate AUDITS of the same QB record: pick the keeper
          // (100%-on-entry > reviewed > latest) and strip every loser from
          // payroll + all queues/stats/index, keeping the raw audit body.
          const { evictDuplicateRecords } = await import("@audit/domain/business/dedup-records/mod.ts");
          const res = await runInBackgroundLane(() =>
            evictDuplicateRecords(ORG(), since, until, {
              execute,
              hiddenBy: "dedup-records",
              onProgress: (evicted, total) => {
                const j = AdminConfigController._dedupJobs.get(jobId);
                if (j) { j.deleted = evicted; j.total = total; j.phase = "deleting"; }
              },
            })
          );
          const j = AdminConfigController._dedupJobs.get(jobId);
          if (j) {
            j.total = res.losers;
            j.deleted = res.evicted;
            j.failed = res.failed;
            j.recordPlan = {
              recordsWithDupes: res.recordsWithDupes,
              losers: res.losers,
              chargebacksRemoved: res.chargebacksRemoved,
              wiresRemoved: res.wiresRemoved,
              appealSkips: res.appealSkips,
            };
            j.phase = "done";
            j.finishedAt = Date.now();
          }
        } else {
          // Collapse duplicate audit-done-idx ROWS per finding (keep the
          // reviewed/judged row, else newest; delete the stale rows by key).
          // NEVER hides a finding — no audit data is lost.
          const { collapseDuplicateIndexRows } = await import("@audit/domain/data/stats-repository/mod.ts");
          const res = await runInBackgroundLane(() =>
            collapseDuplicateIndexRows(ORG(), since, until, {
              execute,
              onProgress: (deleted, total) => {
                const j = AdminConfigController._dedupJobs.get(jobId);
                if (j) { j.deleted = deleted; j.total = total; j.phase = "deleting"; }
              },
            })
          );
          const j = AdminConfigController._dedupJobs.get(jobId);
          if (j) {
            j.plan = { scannedRows: res.scanned, findingsWithDupes: res.findingsWithDupes, staleRows: res.staleRows };
            j.total = res.staleRows;
            j.deleted = res.rowsDeleted;
            j.failed = res.failed;
            j.phase = "done";
            j.finishedAt = Date.now();
          }
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

    return { ok: true, jobId, message: execute ? "Dedup started" : "Dry-run started" };
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

  /** Read-only dedup verification. Scans the range and reports, per finding,
   *  how many audit-done-idx rows it has and which row the cleanup would KEEP
   *  vs DELETE. Never hides or deletes anything — safe to run anytime. The scan
   *  is fast (seconds), so unlike the delete path it returns inline. */
  @Post("deduplicate-diagnose") @ReturnedType(MessageResponse) @BodyType(GenericBodyRequest)
  async deduplicateDiagnose(@Body() body: GenericBodyRequest) {
    const b = body as any;
    const since = parseDateOrMs(b.since, false);
    const until = parseDateOrMs(b.until, true);
    if (since == null || until == null) return { ok: false, error: "since and until required (date YYYY-MM-DD or ms)" };
    const pass: "rows" | "records" = b.pass === "records" ? "records" : "rows";
    if (pass === "records") {
      const { diagnoseDuplicateRecords } = await import("@audit/domain/business/dedup-records/mod.ts");
      const diagnosis = await runInBackgroundLane(() => diagnoseDuplicateRecords(ORG(), since, until));
      return { ok: true, pass, diagnosis };
    }
    const { diagnoseDuplicatesLegacy } = await import("@judge/domain/data/judge-repository/mod.ts");
    const diagnosis = await runInBackgroundLane(() => diagnoseDuplicatesLegacy(ORG(), since, until));
    return { ok: true, pass, diagnosis };
  }

  /** Surgically restore ONE finding wrongly hidden as a duplicate: un-hide it
   *  and re-assert its index rows so record search surfaces it again. Bounded
   *  (a few reads/writes) so it runs inline — no background job needed.
   *  Deliberately per-finding (operator-confirmed); see restoreHiddenFinding. */
  @Post("restore-finding") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  async restoreFinding(@Body() body: GenericBodyRequest) {
    const findingId = String((body as any)?.findingId ?? "").trim();
    if (!findingId) return { ok: false, error: "findingId required" };
    const { restoreHiddenFinding } = await import("@audit/domain/data/stats-repository/mod.ts");
    return await restoreHiddenFinding(ORG(), findingId);
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

  /** Aggregate users + game-state + earned-badge counts for the
   *  Gamification Admin modal's Users tab. Admin-only; bounded by org
   *  size; cached 10s in-isolate to share across the modal's 30s
   *  HTMX refresh ticks and back-button reopens. */
  @Get("gamification/users-list") @ReturnedType(MessageResponse)
  async gamificationUsersList() {
    const orgId = ORG();
    const cached = AdminConfigController._gamUsersCache.get(orgId);
    const now = Date.now();
    if (cached && cached.expiresAt > now) return { ok: true, users: cached.value, cached: true };

    try {
      const { listUsers } = await import("@core/business/auth/mod.ts");
      const { listGameStates, getEarnedBadges } = await import("@gamification/domain/data/gamification-repository/mod.ts");

      // Three sources joined in memory by email.
      const [users, states] = await Promise.all([
        listUsers(orgId),
        listGameStates(orgId),
      ]);
      const stateByEmail = new Map(states.map((s) => [s.email, s.state as unknown as Record<string, unknown>]));

      const includedRoles = new Set(["user", "reviewer", "judge", "manager"]);
      const filtered = users.filter((u) => includedRoles.has(u.role));

      // earned-badge count: per-user list, parallelized. Bounded by user count.
      const badgeCounts = await Promise.all(
        filtered.map(async (u) => ({ email: u.email, n: (await getEarnedBadges(orgId, u.email)).length })),
      );
      const countByEmail = new Map(badgeCounts.map((b) => [b.email, b.n]));

      const rows = filtered.map((u) => {
        const s = stateByEmail.get(u.email) ?? {};
        return {
          email: u.email,
          role: u.role,
          totalXp: Number(s.totalXp ?? 0),
          level: Number(s.level ?? 0),
          dayStreak: Number(s.dayStreak ?? 0),
          earnedBadgeCount: countByEmail.get(u.email) ?? 0,
          equippedTitle: (s.equippedTitle as string | null | undefined) ?? null,
          equippedNameColor: (s.equippedNameColor as string | null | undefined) ?? null,
          equippedFrame: (s.equippedFrame as string | null | undefined) ?? null,
          equippedFlair: (s.equippedFlair as string | null | undefined) ?? null,
        };
      }).sort((a, b) => {
        if (b.totalXp !== a.totalXp) return b.totalXp - a.totalXp;
        if (b.level !== a.level) return b.level - a.level;
        return a.email.localeCompare(b.email);
      });

      AdminConfigController._gamUsersCache.set(orgId, { value: rows, expiresAt: now + 10_000 });
      return { ok: true, users: rows };
    } catch (err) {
      console.warn(`⚠️ [GAM-ADMIN] users-list failed — soft fallback:`, err);
      return { ok: false, error: (err as Error).message ?? String(err), users: [] };
    }
  }

  // 10s in-isolate cache. Same shape as _hiddenCache / _gameStateCache.
  private static _gamUsersCache = new Map<string, { value: unknown[]; expiresAt: number }>();

  /** Additive XP grant for a single user. Calls the same awardXp helper
   *  the natural earning flow uses, so level thresholds + dayStreak +
   *  tokenBalance all update consistently. Optionally broadcasts the
   *  resulting level_up prefab event so the recipient sees the toast. */
  @Post("gamification/grant-xp") @ReturnedType(MessageResponse) @BodyType(GenericBodyRequest)
  async gamificationGrantXp(@Body() body: GenericBodyRequest) {
    const b = (body ?? {}) as { email?: string; amount?: number; broadcast?: boolean; reason?: string };
    const email = String(b.email ?? "").trim();
    const amount = typeof b.amount === "number" ? Math.floor(b.amount) : NaN;
    if (!email) return { ok: false, error: "email required" };
    if (!Number.isFinite(amount) || amount < 1 || amount > 5000) {
      return { ok: false, error: "amount must be an integer 1-5000" };
    }
    const broadcast = b.broadcast !== false;
    const orgId = ORG();

    const { listUsers } = await import("@core/business/auth/mod.ts");
    const users = await listUsers(orgId);
    const target = users.find((u) => u.email === email);
    if (!target) return { ok: false, error: `user not found: ${email}` };
    if (!["user", "reviewer", "judge", "manager"].includes(target.role)) {
      return { ok: false, error: `role ${target.role} not eligible for XP grants` };
    }

    return runInBackgroundLane(async () => {
      const { awardXp, getGameState } = await import("@gamification/domain/data/gamification-repository/mod.ts");
      const role = target.role === "user" ? "agent" : target.role as "reviewer" | "judge" | "manager";
      const award = await awardXp(orgId, email, amount, role);

      AdminConfigController._gamUsersCache.clear();  // table refresh next render

      if (broadcast && award.leveledUp) {
        const { checkAndEmitPrefab } = await import("@events/domain/data/events-repository/mod.ts");
        const state = await getGameState(orgId, email) as unknown as { animBindings?: Record<string, string> };
        const animId = state.animBindings?.["level_up"] ?? null;
        const displayName = email.split("@")[0];
        await checkAndEmitPrefab(
          orgId, "level_up", email,
          `${displayName} reached level ${award.state.level}!`, animId,
        ).catch((err) => console.warn(`[GAM-ADMIN] level_up emit failed:`, err));
      }

      console.log(
        `🎯 [GAM-ADMIN] grant-xp email=${email} amount=${amount} ` +
        `newTotalXp=${award.state.totalXp} newLevel=${award.state.level}${award.leveledUp ? "↑" : ""} ` +
        `reason=${b.reason ?? "(none)"}`,
      );

      return {
        ok: true, email, amount,
        newTotalXp: award.state.totalXp,
        newLevel: award.state.level,
        leveledUp: award.leveledUp,
      };
    });
  }

  /** Force-award a specific badge from BADGE_CATALOG to a user. The
   *  atomic setStoredIfAbsent guard makes duplicate awards a no-op
   *  (returns alreadyEarned:true). Also grants the badge's xpReward
   *  via awardXp so admin grants behave identically to natural earns. */
  @Post("gamification/award-badge") @ReturnedType(MessageResponse) @BodyType(GenericBodyRequest)
  async gamificationAwardBadge(@Body() body: GenericBodyRequest) {
    const b = (body ?? {}) as { email?: string; badgeId?: string; broadcast?: boolean };
    const email = String(b.email ?? "").trim();
    const badgeId = String(b.badgeId ?? "").trim();
    if (!email) return { ok: false, error: "email required" };
    if (!badgeId) return { ok: false, error: "badgeId required" };
    const broadcast = b.broadcast !== false;
    const orgId = ORG();

    const { BADGE_CATALOG } = await import("@gamification/domain/business/badge-system/mod.ts");
    const badge = BADGE_CATALOG.find((bd) => bd.id === badgeId);
    if (!badge) return { ok: false, error: `unknown badgeId: ${badgeId}` };

    const { listUsers } = await import("@core/business/auth/mod.ts");
    const users = await listUsers(orgId);
    const target = users.find((u) => u.email === email);
    if (!target) return { ok: false, error: `user not found: ${email}` };

    // Role-mismatch is a soft warning, not a hard fail — admin might be
    // intentionally cross-role granting (rare but valid). Logged.
    const userRoleForBadge = target.role === "user" ? "agent" : target.role;
    if (badge.role !== userRoleForBadge) {
      console.warn(
        `⚠️ [GAM-ADMIN] cross-role award: badge.role=${badge.role} userRole=${userRoleForBadge} email=${email} badgeId=${badgeId}`,
      );
    }

    return runInBackgroundLane(async () => {
      const { awardBadge, awardXp, getGameState } = await import("@gamification/domain/data/gamification-repository/mod.ts");
      const fresh = await awardBadge(orgId, email, badge as never);

      if (!fresh) {
        return { ok: true, email, badgeId, alreadyEarned: true };
      }

      // Grant the badge's XP reward so admin awards match natural earns.
      const role = target.role === "user" ? "agent" : target.role as "reviewer" | "judge" | "manager";
      const award = await awardXp(orgId, email, badge.xpReward, role);
      AdminConfigController._gamUsersCache.clear();

      if (broadcast) {
        const { checkAndEmitPrefab } = await import("@events/domain/data/events-repository/mod.ts");
        const state = await getGameState(orgId, email) as unknown as { animBindings?: Record<string, string> };
        const animId = state.animBindings?.["badge_earned"] ?? null;
        const displayName = email.split("@")[0];
        await checkAndEmitPrefab(
          orgId, "badge_earned", email,
          `${displayName} earned ${badge.name}!`, animId,
        ).catch((err) => console.warn(`[GAM-ADMIN] badge_earned emit failed:`, err));
        if (award.leveledUp) {
          const lvlAnim = state.animBindings?.["level_up"] ?? null;
          await checkAndEmitPrefab(
            orgId, "level_up", email,
            `${displayName} reached level ${award.state.level}!`, lvlAnim,
          ).catch((err) => console.warn(`[GAM-ADMIN] level_up emit failed:`, err));
        }
      }

      console.log(
        `🏅 [GAM-ADMIN] award-badge email=${email} badgeId=${badgeId} ` +
        `xpReward=${badge.xpReward} newTotalXp=${award.state.totalXp}${award.leveledUp ? " ↑" : ""}`,
      );

      return {
        ok: true, email, badgeId,
        badgeName: badge.name,
        xpAwarded: badge.xpReward,
        newTotalXp: award.state.totalXp,
        newLevel: award.state.level,
        leveledUp: award.leveledUp,
      };
    });
  }

  /** Wipe per-user gamification progression for selected roles.
   *  Body: { roles: ("user"|"reviewer"|"judge"|"manager")[], fromMs?, toMs?, dryRun? }
   *  Omit both fromMs and toMs for a full reset. Window mode deletes only
   *  earned-badges in window; zeroes state for users active in window.
   *  See @admin/domain/business/reset-xp/mod.ts for full semantics. */
  @Post("reset-xp") @ReturnedType(MessageResponse) @BodyType(GenericBodyRequest)
  async resetXp(@Body() body: GenericBodyRequest) {
    const b = (body ?? {}) as { roles?: string[]; fromMs?: number; toMs?: number; dryRun?: boolean };
    const validRoles = new Set(["user", "reviewer", "judge", "manager"]);
    const roles = (b.roles ?? []).filter((r) => validRoles.has(r)) as Array<"user" | "reviewer" | "judge" | "manager">;
    if (!roles.length) return { ok: false, error: "select at least one role" };
    const { resetXp } = await import("@admin/domain/business/reset-xp/mod.ts");
    return runInBackgroundLane(async () => {
      const report = await resetXp({
        orgId: ORG(), roles,
        fromMs: typeof b.fromMs === "number" ? b.fromMs : undefined,
        toMs: typeof b.toMs === "number" ? b.toMs : undefined,
        dryRun: !!b.dryRun,
      });
      return { ok: true, report };
    });
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
      "judge-decided-decidedAt": { type: "judge-decided", fieldName: "decidedAt" },
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
      "judge-decided-decidedAt": { type: "judge-decided", fieldName: "decidedAt" },
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
