/** Upload-reaudit business module — ports prod main:controller.ts
 *  handleAppealUploadRecording. Agent uploads an audio file + optional snip
 *  range; we store to S3 under uploads/{orgId}/{newFindingId}.mp3, create a
 *  new finding with appealType="upload-recording" + snipStart/snipEnd, and
 *  enqueue directly to transcribe (skipping init, since the recording is
 *  already in S3 with a known key).
 *
 *  The snip is applied server-side: step-transcribe forwards snipStart/snipEnd
 *  to AssemblyAI's audio_start_from / audio_end_at params so only the trimmed
 *  portion is transcribed. */

import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";
import { getFinding, saveFinding, saveJob } from "@audit/domain/data/audit-repository/mod.ts";
import { enqueueStep } from "@core/data/qstash/mod.ts";
import { cleanupFindingFromIndices } from "@judge/domain/data/judge-repository/mod.ts";
import { fireWebhook } from "@admin/domain/data/admin-repository/mod.ts";
import { S3Ref } from "@core/data/s3/mod.ts";

export interface UploadReauditInput {
  file: Uint8Array;
  contentType?: string;
  snipStart?: number;
  snipEnd?: number;
  comment?: string;
  agentEmail: string;
}

export interface UploadReauditResult {
  ok: true;
  newFindingId: string;
  reportUrl: string;
  appealType: "upload-recording";
}

function selfUrl(): string {
  return Deno.env.get("SELF_URL") ?? "http://localhost:3000";
}

export async function startUploadReaudit(
  orgId: OrgId,
  findingId: string,
  input: UploadReauditInput,
): Promise<UploadReauditResult> {
  const old = await getFinding(orgId, findingId);
  if (!old) throw new Error(`finding not found: ${findingId}`);
  if (!input.file || input.file.byteLength === 0) throw new Error("file required");

  const bucket = Deno.env.get("S3_BUCKET") ?? Deno.env.get("AWS_S3_BUCKET") ?? "";
  if (!bucket) throw new Error("S3_BUCKET env var not configured");

  const newFindingId = nanoid();
  const s3Key = `uploads/${orgId}/${newFindingId}.mp3`;

  await new S3Ref(bucket, s3Key).save(input.file);

  // Soft-delete the old finding from queues; keep chunks for the report link.
  (old as Record<string, unknown>).reAuditedAt = Date.now();
  await saveFinding(orgId, old);
  cleanupFindingFromIndices(orgId, findingId).catch((err) =>
    console.error(`[UPLOAD-REAUDIT] ❌ cleanup old fid=${findingId} failed:`, err));

  const newJobId = nanoid();
  const newJob: Record<string, unknown> = {
    id: newJobId,
    doneAuditIds: [],
    status: "running",
    timestamp: new Date().toISOString(),
    owner: old.owner ?? "api",
    updateEndpoint: old.updateEndpoint ?? "none",
    recordsToAudit: old.record?.RecordId ? [String(old.record.RecordId)] : [],
  };
  await saveJob(orgId, newJob);

  const newFinding: Record<string, unknown> = {
    id: newFindingId,
    auditJobId: newJobId,
    findingStatus: "pending",
    feedback: { heading: "", text: "", viewUrl: "" },
    job: newJob,
    record: old.record,
    recordingIdField: old.recordingIdField,
    // Keep the record's original recordingId as a display hint but route
    // the pipeline off s3RecordingKey (init is skipped — see below).
    recordingId: `upload-${newFindingId}`,
    owner: old.owner,
    updateEndpoint: old.updateEndpoint,
    qlabConfig: old.qlabConfig,
    appealSourceFindingId: findingId,
    appealType: "upload-recording",
    s3RecordingKey: s3Key,
    recordingPath: s3Key,
    ...(typeof input.snipStart === "number" ? { snipStart: input.snipStart } : {}),
    ...(typeof input.snipEnd === "number" ? { snipEnd: input.snipEnd } : {}),
    ...(input.comment ? { appealComment: input.comment } : {}),
    startedAt: Date.now(),
  };
  await saveFinding(orgId, newFinding);

  // Skip init — recording is already in S3. Jump to transcribe, which uploads
  // the bytes to AssemblyAI and submits the transcript job (with snip params).
  try {
    await enqueueStep("transcribe", { findingId: newFindingId, orgId });
  } catch (err) {
    console.error(`[UPLOAD-REAUDIT] ❌ enqueueStep failed new=${newFindingId}:`, err);
    throw err;
  }

  const reportUrl = `${selfUrl()}/audit/report?id=${newFindingId}`;
  fireWebhook(orgId, "re-audit-receipt", {
    findingId: newFindingId,
    originalFindingId: findingId,
    finding: newFinding,
    appealType: "upload-recording",
    genieIds: [],
    originalGenieId: old.recordingId ? String(old.recordingId) : "",
    agentEmail: input.agentEmail,
    comment: input.comment ?? "",
    reAuditedAt: Date.now(),
    reportUrl,
    originalReportUrl: `${selfUrl()}/audit/report?id=${findingId}`,
  }).catch((err) => console.error(`[UPLOAD-REAUDIT] ❌ re-audit-receipt webhook fid=${newFindingId}:`, err));

  console.log(`📣 [UPLOAD-REAUDIT] old=${findingId} new=${newFindingId} bytes=${input.file.byteLength} snipStart=${input.snipStart ?? "-"} snipEnd=${input.snipEnd ?? "-"} agent=${input.agentEmail || "(none)"}`);
  return { ok: true, newFindingId, reportUrl, appealType: "upload-recording" };
}
