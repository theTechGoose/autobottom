/** Audit API controller — create audits, get findings/stats/recordings. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Req, Query, Body, HttpContext } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { ReturnedType, Description, BodyType } from "#danet/swagger-decorators";
import { AuditQueuedResponse, FindingResponse, MessageResponse, PipelineStatsResponse } from "@core/dto/responses.ts";
import { getStats, trackActive } from "@audit/domain/data/stats-repository/mod.ts";
import { defaultOrgId } from "@core/business/auth/mod.ts";
import { GenericBodyRequest } from "@core/dto/requests.ts";
import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import { authenticate } from "@core/business/auth/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";
import { KvRepository } from "@core/business/repository-base/mod.ts";
import { getDateLegByRid, getPackageByRid } from "@audit/domain/data/quickbase/mod.ts";
import { enqueueStep, getSelfUrl } from "@core/data/qstash/mod.ts";
import { S3Ref } from "@core/data/s3/mod.ts";
import { fileJudgeAppeal } from "@audit/domain/business/file-appeal/mod.ts";
import { startReauditWithGenies } from "@audit/domain/business/reaudit/mod.ts";

const findingRepo = new KvRepository("audit-finding");
const jobRepo = new KvRepository("audit-job");

@SwaggerDescription("Audit pipeline — create audits, retrieve findings, pipeline stats")
@Controller("audit")
export class AuditController {

  @Post("test-by-rid") @ReturnedType(AuditQueuedResponse) @Description("Create date-leg audit from QuickBase record ID") @BodyType(GenericBodyRequest)
  async createDateLegAudit(@Body() body: any, @Query("rid") rid: string, @Query("callback_url") callbackUrl: string, @Query("qlab_config") qlabConfig: string, @Query("override") override: string, @Query("audit_id") auditId: string) {
    if (!rid) return { error: "rid parameter required" };

    const record = await getDateLegByRid(rid) ?? body?.record ?? { RecordId: rid };
    const recordingIdField = body?.recordingIdField ?? "VoGenie";

    const jobId = auditId ?? nanoid();
    const job = { id: jobId, doneAuditIds: [], status: "running", timestamp: new Date().toISOString(), owner: body?.owner ?? "api", updateEndpoint: callbackUrl ?? "none", recordsToAudit: [rid] };
    // Use defaultOrgId() to match DashboardController — both read/write to the same org.
    const orgId = defaultOrgId() as OrgId;
    await jobRepo.setChunked(orgId, [jobId], job);

    const findingId = nanoid();
    const rawRecordingId = record[recordingIdField] ? String(record[recordingIdField]) : undefined;
    const genieIdList = rawRecordingId ? rawRecordingId.split(",").map((s: string) => s.trim()).filter(Boolean) : [];
    const finding = {
      id: findingId, auditJobId: jobId, findingStatus: "pending",
      feedback: { heading: "", text: "", viewUrl: "" },
      job, record, recordingIdField,
      recordingId: override ?? genieIdList[0] ?? rawRecordingId,
      genieIds: !override && genieIdList.length > 1 ? genieIdList : undefined,
      owner: job.owner, updateEndpoint: callbackUrl ?? "none",
      qlabConfig: qlabConfig ?? body?.qlabConfig ?? undefined,
      isTest: body?.isTest ?? undefined,
      testEmailRecipients: body?.testEmailRecipients ?? undefined,
      startedAt: Date.now(),
    };
    await findingRepo.setChunked(orgId, [findingId], finding);

    // Capture enqueue result + trackActive status so the frontend can surface any
    // failure without requiring log access. This lets the user see "audit started
    // BUT trackActive failed: <reason>" instead of a silent success that vanishes.
    let enqueueResult: { ok: boolean; messageId?: string; callback?: string; error?: string };
    try {
      const messageId = await enqueueStep("init", { findingId, orgId });
      enqueueResult = { ok: true, messageId, callback: `${getSelfUrl()}/audit/step/init` };
    } catch (e) {
      enqueueResult = { ok: false, error: (e as Error).message };
      console.error(`❌ [AUDIT] enqueueStep FAILED orgId=${orgId} finding=${findingId}:`, e);
    }

    let trackActiveResult: { ok: boolean; error?: string };
    try {
      await trackActive(orgId, findingId, "queued", { recordId: rid, isPackage: false, startedAt: Date.now() });
      trackActiveResult = { ok: true };
      console.log(`✅ [AUDIT] trackActive(queued) succeeded orgId=${orgId} finding=${findingId}`);
    } catch (e) {
      trackActiveResult = { ok: false, error: (e as Error).message };
      console.error(`❌ [AUDIT] trackActive FAILED orgId=${orgId} finding=${findingId}:`, e);
    }

    console.log(`🚀 [AUDIT] Date-leg audit started: job=${jobId} finding=${findingId} rid=${rid} orgId=${orgId}`);
    return { jobId, findingId, status: "queued", enqueue: enqueueResult, trackActive: trackActiveResult };
  }

  @Post("package-by-rid") @ReturnedType(AuditQueuedResponse) @Description("Create package audit from QuickBase record ID") @BodyType(GenericBodyRequest)
  async createPackageAudit(@Body() body: any, @Query("rid") rid: string, @Query("callback_url") callbackUrl: string, @Query("qlab_config") qlabConfig: string) {
    if (!rid) return { error: "rid parameter required" };

    const record = await getPackageByRid(rid) ?? body?.record ?? { RecordId: rid };
    const recordingIdField = body?.recordingIdField ?? "GenieNumber";

    // Use defaultOrgId() to match DashboardController — both read/write to the same org.
    const orgId = defaultOrgId() as OrgId;
    const jobId = nanoid();
    const job = { id: jobId, doneAuditIds: [], status: "running", timestamp: new Date().toISOString(), owner: body?.owner ?? "api", updateEndpoint: callbackUrl ?? "none", recordsToAudit: [rid] };
    await jobRepo.setChunked(orgId, [jobId], job);

    const findingId = nanoid();
    const rawRecordingId = record[recordingIdField] ? String(record[recordingIdField]) : undefined;
    const genieIdList = rawRecordingId ? rawRecordingId.split(",").map((s: string) => s.trim()).filter(Boolean) : [];
    const finding = {
      id: findingId, auditJobId: jobId, findingStatus: "pending",
      feedback: { heading: "", text: "", viewUrl: "" },
      job, record, recordingIdField,
      recordingId: genieIdList[0] ?? rawRecordingId,
      genieIds: genieIdList.length > 1 ? genieIdList : undefined,
      owner: job.owner, updateEndpoint: callbackUrl ?? "none",
      qlabConfig: qlabConfig ?? body?.qlabConfig ?? undefined,
      isTest: body?.isTest ?? undefined,
      testEmailRecipients: body?.testEmailRecipients ?? undefined,
      startedAt: Date.now(),
    };
    await findingRepo.setChunked(orgId, [findingId], finding);

    let enqueueResult: { ok: boolean; messageId?: string; callback?: string; error?: string };
    try {
      const messageId = await enqueueStep("init", { findingId, orgId });
      enqueueResult = { ok: true, messageId, callback: `${getSelfUrl()}/audit/step/init` };
    } catch (e) {
      enqueueResult = { ok: false, error: (e as Error).message };
      console.error(`❌ [AUDIT] enqueueStep FAILED orgId=${orgId} finding=${findingId}:`, e);
    }

    let trackActiveResult: { ok: boolean; error?: string };
    try {
      await trackActive(orgId, findingId, "queued", { recordId: rid, isPackage: true, startedAt: Date.now() });
      trackActiveResult = { ok: true };
      console.log(`✅ [AUDIT] trackActive(queued) succeeded orgId=${orgId} finding=${findingId}`);
    } catch (e) {
      trackActiveResult = { ok: false, error: (e as Error).message };
      console.error(`❌ [AUDIT] trackActive FAILED orgId=${orgId} finding=${findingId}:`, e);
    }

    console.log(`🚀 [AUDIT] Package audit started: job=${jobId} finding=${findingId} rid=${rid} orgId=${orgId}`);
    return { jobId, findingId, status: "queued", enqueue: enqueueResult, trackActive: trackActiveResult };
  }

  @Get("finding") @ReturnedType(FindingResponse) @Description("Get audit finding by ID")
  async getFinding(@Query("id") id: string) {
    if (!id) return { error: "id parameter required" };
    const orgId = defaultOrgId() as OrgId;
    const finding = await findingRepo.getChunked(orgId, id);
    if (!finding) return { error: "not found" };
    return finding;
  }

  @Get("recording") @Description("Stream audit recording audio from S3 as audio/mpeg")
  async getRecording(@Query("id") id: string, @Query("idx") idxStr: string) {
    if (!id) return new Response(JSON.stringify({ error: "id parameter required" }), { status: 400, headers: { "content-type": "application/json" } });

    const orgId = defaultOrgId() as OrgId;
    const finding = await findingRepo.getChunked(orgId, id) as Record<string, unknown> | null;
    if (!finding) return new Response(JSON.stringify({ error: "finding not found" }), { status: 404, headers: { "content-type": "application/json" } });

    const idx = parseInt(idxStr ?? "0") || 0;
    const keys = finding.s3RecordingKeys as string[] | undefined;
    const recordingPath = keys?.length ? keys[Math.min(idx, keys.length - 1)] : (finding.recordingPath as string | undefined);
    if (!recordingPath) return new Response(JSON.stringify({ error: "no recording path" }), { status: 404, headers: { "content-type": "application/json" } });

    const bucket = Deno.env.get("S3_BUCKET") ?? Deno.env.get("AWS_S3_BUCKET") ?? "";
    if (!bucket) return new Response(JSON.stringify({ error: "S3 bucket not configured" }), { status: 500, headers: { "content-type": "application/json" } });

    const s3 = new S3Ref(bucket, recordingPath);
    const bytes = await s3.get();
    if (!bytes) return new Response(JSON.stringify({ error: "recording not found in S3" }), { status: 404, headers: { "content-type": "application/json" } });

    // Return full file with proper headers for <audio controls>. Range support is
    // nice-to-have; native browsers work fine with a full download for short clips.
    return new Response(bytes, {
      status: 200,
      headers: {
        "content-type": "audio/mpeg",
        "content-length": String(bytes.byteLength),
        "accept-ranges": "bytes",
        "cache-control": "private, max-age=300",
      },
    });
  }

  @Post("api/appeal") @ReturnedType(MessageResponse) @Description("File a judge appeal for a completed audit") @BodyType(GenericBodyRequest)
  async fileAppeal(@Body() body: GenericBodyRequest) {
    const b = body as unknown as { findingId?: string; auditor?: string; comment?: string; appealedQuestions?: unknown };
    if (!b.findingId || !b.auditor) return { error: "findingId and auditor required" };
    const raw = Array.isArray(b.appealedQuestions) ? b.appealedQuestions : [];
    const indexes = raw.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n >= 0);
    if (!indexes.length) return { error: "appealedQuestions required" };
    try {
      const orgId = defaultOrgId() as OrgId;
      return await fileJudgeAppeal(orgId, b.findingId, { auditor: b.auditor, comment: b.comment, appealedQuestions: indexes });
    } catch (e) {
      console.error(`❌ [AUDIT] fileAppeal failed:`, e);
      return { ok: false, error: (e as Error).message };
    }
  }

  @Post("api/appeal/different-recording") @ReturnedType(MessageResponse) @Description("Re-audit a finding with a different/additional genie recording") @BodyType(GenericBodyRequest)
  async reauditWithGenies(@Body() body: GenericBodyRequest) {
    const b = body as unknown as { findingId?: string; recordingIds?: unknown; comment?: string; agentEmail?: string };
    if (!b.findingId) return { error: "findingId required" };
    const rawIds = Array.isArray(b.recordingIds) ? b.recordingIds : [];
    const ids = rawIds.map((v) => String(v).trim()).filter(Boolean);
    if (!ids.length) return { error: "recordingIds required" };
    try {
      const orgId = defaultOrgId() as OrgId;
      return await startReauditWithGenies(orgId, b.findingId, { recordingIds: ids, comment: b.comment, agentEmail: b.agentEmail ?? "" });
    } catch (e) {
      console.error(`❌ [AUDIT] reauditWithGenies failed:`, e);
      return { ok: false, error: (e as Error).message };
    }
  }

  @Get("stats") @ReturnedType(PipelineStatsResponse) @Description("Get pipeline stats")
  async getStats() {
    const orgId = defaultOrgId();
    const stats = await getStats(orgId);
    return {
      inPipe: stats.active.length,
      active: stats.active,
      completed24h: stats.completedCount,
      errors24h: stats.errors.length,
      errors: stats.errors,
      retries24h: stats.retries.length,
      retries: stats.retries,
    };
  }
}
