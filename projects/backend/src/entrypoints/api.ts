/** API controller - creates audit jobs and kicks off the QStash pipeline. */
import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import { saveFinding, saveJob, getFinding, getAllAnswersForFinding, getStats, fireWebhook } from "../domain/data/kv/mod.ts";
import { enqueueStep } from "../domain/data/queue/mod.ts";
import { getDateLegByRid } from "../domain/data/quickbase/mod.ts";
import { S3Ref } from "../domain/data/s3/mod.ts";
import { env } from "../../env.ts";
import { populateJudgeQueue, saveAppeal, getAppeal } from "../domain/coordinators/judge/mod.ts";
import type { AuditFinding } from "../../dto/audit-finding.ts";
import type { AuditJob } from "../../dto/audit-job.ts";
import { createJob } from "../domain/business/audit-job/mod.ts";
import type { OrgId } from "../domain/data/kv/org.ts";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * POST /audit/test-by-rid?rid=X&callback_url=Y&override=Z&audit_id=W&qlab_config=C
 * Creates an audit job for a standard date leg record.
 * Pass qlab_config to use Question Lab questions instead of QuickBase.
 */
export async function handleAuditByRid(orgId: OrgId, req: Request): Promise<Response> {
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
    // Fetch full record from QuickBase so we get the VoGenie field
    record = await getDateLegByRid(rid) ?? { RecordId: rid };
  }
  const recordingIdField = body.recordingIdField ?? "VoGenie";

  // Create job
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

  // Create finding
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

  // Kick off pipeline
  await enqueueStep("init", { findingId });

  console.log(`[CONTROLLER] Audit started: job=${jobId} finding=${findingId} rid=${rid}`);
  return json({ jobId, findingId, status: "queued" });
}

/**
 * POST /audit/package-by-rid?rid=X&callback_url=Y
 * Creates an audit job for a package record.
 */
export async function handlePackageByRid(orgId: OrgId, req: Request): Promise<Response> {
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
  await enqueueStep("init", { findingId });

  console.log(`[CONTROLLER] Package audit started: job=${jobId} finding=${findingId} rid=${rid}`);
  return json({ jobId, findingId, status: "queued" });
}

/**
 * GET /audit/finding?id=X
 * Retrieve a finding by ID.
 */
export async function handleGetFinding(orgId: OrgId, req: Request): Promise<Response> {
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
export async function handleGetStats(orgId: OrgId, _req: Request): Promise<Response> {
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
export async function handleGetRecording(orgId: OrgId, req: Request): Promise<Response> {
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
 * File an appeal for a finding - queues ALL questions for judge review.
 */
export async function handleFileAppeal(orgId: OrgId, req: Request): Promise<Response> {
  let body: Record<string, any> = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const findingId = body.findingId;
  const comment = body.comment;
  if (!findingId) return json({ error: "findingId required" }, 400);

  // Check if appeal already exists
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

  // Populate judge queue with ALL questions
  await populateJudgeQueue(orgId, findingId, questions, "redo");

  // Save appeal record
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
 * Re-audit with different/additional recording IDs. Nukes old finding, creates new one.
 * Auto-detects appeal type: if original recordingId is in submitted list -> "additional-recording", else -> "different-recording".
 */
export async function handleAppealDifferentRecording(orgId: OrgId, req: Request): Promise<Response> {
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

  // Validate all IDs are numeric
  for (const rid of recordingIds) {
    if (!/^\d+$/.test(String(rid).trim())) {
      return json({ error: `invalid recording ID: ${rid}` }, 400);
    }
  }

  const oldFinding = await getFinding(orgId, findingId);
  if (!oldFinding) return json({ error: "finding not found" }, 404);

  // Auto-detect appeal type
  const normalizedIds = recordingIds.map((r: any) => String(r).trim());
  const originalId = oldFinding.recordingId ? String(oldFinding.recordingId) : undefined;
  const appealType = originalId && normalizedIds.includes(originalId) ? "additional-recording" : "different-recording";

  // Mark old finding as re-audited
  (oldFinding as Record<string, any>).reAuditedAt = Date.now();
  await saveFinding(orgId, oldFinding as Record<string, any>);

  // Create new job + finding with same record data
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
  await enqueueStep("init", { findingId: newFindingId });

  const reportUrl = `${env.selfUrl}/audit/report?id=${newFindingId}`;
  console.log(`[APPEAL] ${appealType}: old=${findingId} new=${newFindingId} recordings=${normalizedIds.join(",")}`);
  return json({ ok: true, newFindingId, reportUrl });
}

/**
 * POST /audit/appeal/upload-recording
 * Re-audit with an uploaded MP3 file and optional snip markers.
 */
export async function handleAppealUploadRecording(orgId: OrgId, req: Request): Promise<Response> {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return json({ error: "multipart form data required" }, 400);
  }

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

  // Mark old finding as re-audited
  (oldFinding as Record<string, any>).reAuditedAt = Date.now();
  await saveFinding(orgId, oldFinding as Record<string, any>);

  // Upload file to S3
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  const newJobId = nanoid();
  const s3Key = `recordings/${newJobId}/upload.mp3`;
  const s3 = new S3Ref(env.s3Bucket, s3Key);
  await s3.save(fileBytes);

  // Create new job + finding
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

  // Skip init (recording already in S3), go straight to transcribe
  await enqueueStep("transcribe", { findingId: newFindingId });

  const reportUrl = `${env.selfUrl}/audit/report?id=${newFindingId}`;
  console.log(`[APPEAL] Upload-recording: old=${findingId} new=${newFindingId} snip=${snipStart ?? "none"}-${snipEnd ?? "none"}`);
  return json({ ok: true, newFindingId, reportUrl });
}

/**
 * GET /audit/appeal/status?findingId=X
 * Check if an appeal exists for a finding (no side effects).
 */
export async function handleAppealStatus(orgId: OrgId, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const findingId = url.searchParams.get("findingId");
  if (!findingId) return json({ error: "findingId required" }, 400);
  const existing = await getAppeal(orgId, findingId);
  return json({ exists: !!existing, status: existing?.status ?? null });
}
