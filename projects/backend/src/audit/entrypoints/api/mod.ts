import "reflect-metadata";
import { Controller, Get, Post, Req } from "@danet/core";
import { nanoid } from "nanoid";

import { saveFinding, saveJob, getFinding, getAllAnswersForFinding, getStats, fireWebhook } from "../../../core/data/kv/impl.ts";
import { getDateLegByRid } from "../../../core/data/quickbase/impl.ts";
import { S3Ref } from "../../../core/data/s3/impl.ts";
import { env } from "../../../core/data/env/impl.ts";
import { populateJudgeQueue, saveAppeal, getAppeal } from "../../../judge/domain/coordinators/judge/impl.ts";
import type { AuditFinding } from "../../../core/dto/audit-finding.ts";
import type { AuditJob } from "../../../core/dto/audit-job.ts";
import { createJob } from "../../domain/business/audit-job/impl.ts";
import { authenticate } from "../../../auth/domain/coordinators/auth/impl.ts";
import { kvFactory } from "../../../core/data/kv/factory.ts";
import type { OrgId } from "../../../core/data/kv/org.ts";

// Danet's @ReqParam() decorator type is incompatible with experimentalDecorators; cast to ParameterDecorator.
const ReqParam: () => ParameterDecorator = Req as any;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Resolve orgId: try auth, then ?org query param, then default org. */
async function resolveOrgId(req: Request): Promise<OrgId | null> {
  const auth = await authenticate(req);
  if (auth) return auth.orgId;
  const url = new URL(req.url);
  const org = url.searchParams.get("org");
  if (org) return org;
  const db = await kvFactory();
  const def = await db.get<string>(["default-org"]);
  return def.value ?? null;
}

/** Resolve orgId from request body. */
async function resolveBodyOrgId(req: Request): Promise<{ orgId: OrgId | null; body: Record<string, any> }> {
  try {
    const body = await req.clone().json();
    return { orgId: body.orgId ?? null, body };
  } catch {
    return { orgId: null, body: {} };
  }
}

@Controller("audit")
export class AuditApiController {

  /**
   * POST /audit/test-by-rid?rid=X&callback_url=Y&override=Z&audit_id=W&qlab_config=C
   * Creates an audit job for a standard date leg record.
   */
  @Post("test-by-rid")
  async handleAuditByRid(@ReqParam() req: Request): Promise<Response> {
    const { orgId } = await resolveBodyOrgId(req);
    if (!orgId) return json({ error: "orgId required in body" }, 400);

    const url = new URL(req.url);
    const rid = url.searchParams.get("rid");
    const callbackUrl = url.searchParams.get("callback_url") ?? "none";
    const override = url.searchParams.get("override");
    const auditId = url.searchParams.get("audit_id");
    const qlabConfig = url.searchParams.get("qlab_config");

    if (!rid) return json({ error: "rid parameter required" }, 400);

    let body: Record<string, any> = {};
    try {
      body = await req.json();
    } catch {
      // No body is fine
    }

    let record = body.record;
    if (!record) {
      record = await getDateLegByRid(rid) ?? { RecordId: rid };
    }
    const recordingIdField = body.recordingIdField ?? "VoGenie";

    const jobId = auditId ?? nanoid();
    const job: AuditJob = {
      id: jobId,
      doneAuditIds: [],
      status: "running",
      timestamp: new Date().toISOString(),
      owner: body.owner ?? "api",
      updateEndpoint: callbackUrl,
      recordsToAudit: [rid],
    };
    await saveJob(orgId, job);

    const findingId = nanoid();
    const finding: AuditFinding = {
      id: findingId,
      auditJobId: jobId,
      findingStatus: "pending",
      feedback: { heading: "", text: "", viewUrl: "" },
      job,
      record,
      recordingIdField,
      recordingId: record[recordingIdField] ? String(record[recordingIdField]) : undefined,
      owner: job.owner,
      updateEndpoint: callbackUrl,
      qlabConfig: qlabConfig ?? body.qlabConfig,
    };

    if (override) {
      finding.recordingId = override;
    }

    await saveFinding(orgId, finding);

    console.log(`[CONTROLLER] Audit started: job=${jobId} finding=${findingId} rid=${rid}`);
    return json({ jobId, findingId, status: "queued" });
  }

  /**
   * POST /audit/package-by-rid?rid=X&callback_url=Y
   * Creates an audit job for a package record.
   */
  @Post("package-by-rid")
  async handlePackageByRid(@ReqParam() req: Request): Promise<Response> {
    const { orgId } = await resolveBodyOrgId(req);
    if (!orgId) return json({ error: "orgId required in body" }, 400);

    const url = new URL(req.url);
    const rid = url.searchParams.get("rid");
    const callbackUrl = url.searchParams.get("callback_url") ?? "none";
    const qlabConfig = url.searchParams.get("qlab_config");

    if (!rid) return json({ error: "rid parameter required" }, 400);

    let body: Record<string, any> = {};
    try {
      body = await req.json();
    } catch {
      // No body is fine
    }

    const record = body.record ?? { RecordId: rid };
    const recordingIdField = body.recordingIdField ?? "GenieNumber";

    const jobId = nanoid();
    const job: AuditJob = {
      id: jobId,
      doneAuditIds: [],
      status: "running",
      timestamp: new Date().toISOString(),
      owner: body.owner ?? "api",
      updateEndpoint: callbackUrl,
      recordsToAudit: [rid],
    };
    await saveJob(orgId, job);

    const findingId = nanoid();
    const finding: AuditFinding = {
      id: findingId,
      auditJobId: jobId,
      findingStatus: "pending",
      feedback: { heading: "", text: "", viewUrl: "" },
      job,
      record,
      recordingIdField,
      recordingId: record[recordingIdField] ? String(record[recordingIdField]) : undefined,
      owner: job.owner,
      updateEndpoint: callbackUrl,
      qlabConfig: qlabConfig ?? body.qlabConfig,
    };

    await saveFinding(orgId, finding);

    console.log(`[CONTROLLER] Package audit started: job=${jobId} finding=${findingId} rid=${rid}`);
    return json({ jobId, findingId, status: "queued" });
  }

  /**
   * GET /audit/finding?id=X
   * Retrieve a finding by ID.
   */
  @Get("finding")
  async handleGetFinding(@ReqParam() req: Request): Promise<Response> {
    const orgId = await resolveOrgId(req);
    if (!orgId) return json({ error: "org required (authenticate or provide ?org=)" }, 400);

    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) return json({ error: "id parameter required" }, 400);

    const finding = await getFinding(orgId, id);
    if (!finding) return json({ error: "not found" }, 404);

    return json(finding);
  }

  /**
   * GET /audit/stats
   * Real-time pipeline stats (JSON).
   */
  @Get("stats")
  async handleGetStats(@ReqParam() req: Request): Promise<Response> {
    const orgId = await resolveOrgId(req);
    if (!orgId) return json({ error: "org required (authenticate or provide ?org=)" }, 400);

    const stats = await getStats(orgId);

    return json({
      inPipe: stats.active.length,
      active: stats.active,
      completed24h: stats.completedCount,
      errors24h: stats.errors.length,
      errors: stats.errors,
      retries24h: stats.retries.length,
      retries: stats.retries,
    });
  }

  /**
   * GET /audit/recording?id=X
   * Streams the recording audio from S3 as audio/mpeg.
   */
  @Get("recording")
  async handleGetRecording(@ReqParam() req: Request): Promise<Response> {
    const orgId = await resolveOrgId(req);
    if (!orgId) return json({ error: "org required (authenticate or provide ?org=)" }, 400);

    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) return json({ error: "id parameter required" }, 400);

    const finding = await getFinding(orgId, id);
    if (!finding) return json({ error: "finding not found" }, 404);

    const recordingPath = (finding as Record<string, any>).recordingPath;
    if (!recordingPath) return json({ error: "no recording path" }, 404);

    const s3 = new S3Ref(env.s3Bucket, recordingPath);
    const bytes = await s3.get();
    if (!bytes) return json({ error: "recording not found in S3" }, 404);

    return new Response(bytes, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "public, max-age=3600",
      },
    });
  }

  /**
   * POST /audit/appeal
   * File an appeal for a finding.
   */
  @Post("appeal")
  async handleFileAppeal(@ReqParam() req: Request): Promise<Response> {
    const { orgId } = await resolveBodyOrgId(req);
    if (!orgId) return json({ error: "orgId required in body" }, 400);

    let body: Record<string, any> = {};
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid JSON body" }, 400);
    }

    const findingId = body.findingId;
    const comment = body.comment;
    if (!findingId) return json({ error: "findingId required" }, 400);

    const existing = await getAppeal(orgId, findingId);
    if (existing) return json({ error: "appeal already filed", status: existing.status }, 409);

    const finding = await getFinding(orgId, findingId);
    if (!finding) return json({ error: "finding not found" }, 404);

    const f = finding as Record<string, any>;
    const allAnswers = await getAllAnswersForFinding(orgId, findingId);
    const questions = allAnswers.length > 0 ? allAnswers : (f.answeredQuestions ?? []);

    if (questions.length === 0) {
      return json({ error: "no answered questions to appeal" }, 400);
    }

    await populateJudgeQueue(orgId, findingId, questions, "redo");

    const appealedAt = Date.now();
    await saveAppeal(orgId, {
      findingId,
      appealedAt,
      status: "pending",
      auditor: f.owner,
      ...(comment ? { comment: String(comment) } : {}),
    });

    fireWebhook(orgId, "appeal", {
      findingId,
      finding: f,
      auditor: f.owner,
      questionCount: questions.length,
      appealedAt: new Date(appealedAt).toISOString(),
    }).catch((err) => console.error(`[APPEAL] ${findingId}: Webhook failed:`, err));

    return json({ ok: true, judgeUrl: "/judge" });
  }

  /**
   * POST /audit/appeal/different-recording
   * Re-audit with different/additional recording IDs.
   */
  @Post("appeal/different-recording")
  async handleAppealDifferentRecording(@ReqParam() req: Request): Promise<Response> {
    const { orgId } = await resolveBodyOrgId(req);
    if (!orgId) return json({ error: "orgId required in body" }, 400);

    let body: Record<string, any> = {};
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid JSON body" }, 400);
    }

    const { findingId, recordingIds, comment } = body;
    if (!findingId) return json({ error: "findingId required" }, 400);
    if (!Array.isArray(recordingIds) || recordingIds.length === 0) {
      return json({ error: "recordingIds must be a non-empty array" }, 400);
    }

    for (const rid of recordingIds) {
      if (!/^\d+$/.test(String(rid).trim())) {
        return json({ error: `invalid recording ID: ${rid}` }, 400);
      }
    }

    const oldFinding = await getFinding(orgId, findingId);
    if (!oldFinding) return json({ error: "finding not found" }, 404);

    const normalizedIds = recordingIds.map((r: any) => String(r).trim());
    const originalId = oldFinding.recordingId ? String(oldFinding.recordingId) : undefined;
    const appealType = originalId && normalizedIds.includes(originalId) ? "additional-recording" : "different-recording";

    (oldFinding as Record<string, any>).reAuditedAt = Date.now();
    await saveFinding(orgId, oldFinding as Record<string, any>);

    const newJobId = nanoid();
    const newJob: AuditJob = createJob(
      oldFinding.owner ?? "api",
      oldFinding.updateEndpoint ?? "none",
      oldFinding.record?.RecordId ? [String(oldFinding.record.RecordId)] : [],
      newJobId,
    );
    newJob.status = "running";
    await saveJob(orgId, newJob);

    const newFindingId = nanoid();
    const newFinding: AuditFinding = {
      id: newFindingId,
      auditJobId: newJobId,
      findingStatus: "pending",
      feedback: { heading: "", text: "", viewUrl: "" },
      job: newJob,
      record: oldFinding.record,
      recordingIdField: oldFinding.recordingIdField,
      recordingId: normalizedIds[0],
      owner: oldFinding.owner,
      updateEndpoint: oldFinding.updateEndpoint,
      qlabConfig: oldFinding.qlabConfig,
      genieIds: normalizedIds,
      appealSourceFindingId: findingId,
      appealType,
      ...(comment ? { appealComment: String(comment) } : {}),
    };

    await saveFinding(orgId, newFinding as Record<string, any>);

    const reportUrl = `${env.selfUrl}/audit/report?id=${newFindingId}`;
    console.log(`[APPEAL] ${appealType}: old=${findingId} new=${newFindingId} recordings=${normalizedIds.join(",")}`);
    return json({ ok: true, newFindingId, reportUrl });
  }

  /**
   * POST /audit/appeal/upload-recording
   * Re-audit with an uploaded MP3 file and optional snip markers.
   */
  @Post("appeal/upload-recording")
  async handleAppealUploadRecording(@ReqParam() req: Request): Promise<Response> {
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return json({ error: "multipart form data required" }, 400);
    }

    const orgId = formData.get("orgId") as string;
    if (!orgId) return json({ error: "orgId required in form data" }, 400);

    const findingId = formData.get("findingId") as string;
    if (!findingId) return json({ error: "findingId required" }, 400);

    const file = formData.get("file") as File | null;
    if (!file) return json({ error: "file required" }, 400);

    const snipStartRaw = formData.get("snipStart") as string | null;
    const snipEndRaw = formData.get("snipEnd") as string | null;
    const snipStart = snipStartRaw ? Number(snipStartRaw) : undefined;
    const snipEnd = snipEndRaw ? Number(snipEndRaw) : undefined;
    const comment = formData.get("comment") as string | null;

    const oldFinding = await getFinding(orgId, findingId);
    if (!oldFinding) return json({ error: "finding not found" }, 404);

    (oldFinding as Record<string, any>).reAuditedAt = Date.now();
    await saveFinding(orgId, oldFinding as Record<string, any>);

    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const newJobId = nanoid();
    const s3Key = `recordings/${newJobId}/upload.mp3`;
    const s3 = new S3Ref(env.s3Bucket, s3Key);
    await s3.save(fileBytes);

    const newJob: AuditJob = createJob(
      oldFinding.owner ?? "api",
      oldFinding.updateEndpoint ?? "none",
      oldFinding.record?.RecordId ? [String(oldFinding.record.RecordId)] : [],
      newJobId,
    );
    newJob.status = "running";
    await saveJob(orgId, newJob);

    const newFindingId = nanoid();
    const newFinding: AuditFinding = {
      id: newFindingId,
      auditJobId: newJobId,
      findingStatus: "pending",
      feedback: { heading: "", text: "", viewUrl: "" },
      job: newJob,
      record: oldFinding.record,
      recordingIdField: oldFinding.recordingIdField,
      owner: oldFinding.owner,
      updateEndpoint: oldFinding.updateEndpoint,
      qlabConfig: oldFinding.qlabConfig,
      s3RecordingKey: s3Key,
      recordingPath: s3Key,
      snipStart,
      snipEnd,
      appealSourceFindingId: findingId,
      appealType: "upload-recording",
      ...(comment ? { appealComment: String(comment) } : {}),
    };

    await saveFinding(orgId, newFinding as Record<string, any>);

    const reportUrl = `${env.selfUrl}/audit/report?id=${newFindingId}`;
    console.log(`[APPEAL] Upload-recording: old=${findingId} new=${newFindingId} snip=${snipStart ?? "none"}-${snipEnd ?? "none"}`);
    return json({ ok: true, newFindingId, reportUrl });
  }

  /**
   * GET /audit/appeal/status?findingId=X
   * Check if an appeal exists for a finding.
   */
  @Get("appeal/status")
  async handleAppealStatus(@ReqParam() req: Request): Promise<Response> {
    const orgId = await resolveOrgId(req);
    if (!orgId) return json({ error: "org required (authenticate or provide ?org=)" }, 400);

    const url = new URL(req.url);
    const findingId = url.searchParams.get("findingId");
    if (!findingId) return json({ error: "findingId required" }, 400);

    const existing = await getAppeal(orgId, findingId);
    return json({ exists: !!existing, status: existing?.status ?? null });
  }
}
