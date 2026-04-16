/** Audit API controller — create audits, get findings/stats/recordings. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Req, Query, Body, HttpContext } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { ReturnedType, Description, BodyType } from "#danet/swagger-decorators";
import { AuditQueuedResponse, FindingResponse, MessageResponse, PipelineStatsResponse } from "@core/dto/responses.ts";
import { getStats } from "@audit/domain/data/stats-repository/mod.ts";
import { defaultOrgId } from "@core/business/auth/mod.ts";
import { GenericBodyRequest } from "@core/dto/requests.ts";
import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import { authenticate } from "@core/business/auth/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";
import { KvRepository } from "@core/business/repository-base/mod.ts";
import { getDateLegByRid, getPackageByRid } from "@audit/domain/data/quickbase/mod.ts";
import { enqueueStep } from "@core/data/qstash/mod.ts";
import { S3Ref } from "@core/data/s3/mod.ts";

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
    await enqueueStep("init", { findingId, orgId });

    console.log(`🚀 [AUDIT] Date-leg audit started: job=${jobId} finding=${findingId} rid=${rid}`);
    return { jobId, findingId, status: "queued" };
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
    await enqueueStep("init", { findingId, orgId });

    console.log(`🚀 [AUDIT] Package audit started: job=${jobId} finding=${findingId} rid=${rid}`);
    return { jobId, findingId, status: "queued" };
  }

  @Get("finding") @ReturnedType(FindingResponse) @Description("Get audit finding by ID")
  async getFinding(@Query("id") id: string) {
    if (!id) return { error: "id parameter required" };
    const orgId = defaultOrgId() as OrgId;
    const finding = await findingRepo.getChunked(orgId, id);
    if (!finding) return { error: "not found" };
    return finding;
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
