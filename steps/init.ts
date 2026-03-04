/** STEP 1: Initialize finding, fetch recording, save to S3. */
import { saveFinding, getFinding, trackActive, getPipelineConfig } from "../lib/kv.ts";
import { enqueueStep } from "../lib/queue.ts";
import { downloadRecording } from "../providers/genie.ts";
import { uploadAudio } from "../providers/assemblyai.ts";
import { S3Ref } from "../lib/s3.ts";
import { env } from "../env.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function stepInit(req: Request): Promise<Response> {
  const body = await req.json();
  const { findingId, orgId } = body;

  const pipelineCfg = await getPipelineConfig(orgId);
  console.log(`[STEP-INIT] ${findingId}: Starting... [parallelism=${pipelineCfg.parallelism}]`);
  await trackActive(orgId, findingId, "init");

  const finding = await getFinding(orgId, findingId);
  if (!finding) return json({ error: "finding not found" }, 404);
  console.log(`[STEP-INIT] ${findingId}: record keys=${JSON.stringify(Object.keys(finding.record ?? {}))} values=${JSON.stringify(finding.record ?? {})}`);
  if (finding.findingStatus === "terminated") return json({ ok: true, skipped: true, reason: "terminated" });

  // Record audit start time (used for duration tracking)
  if (!finding.startedAt) {
    finding.startedAt = Date.now();
    await saveFinding(orgId, finding);
  }

  // Update active entry with QB record metadata + audit start time
  const qbRecordId = String(finding.record?.RecordId ?? "");
  trackActive(orgId, findingId, "init", {
    recordId: qbRecordId || undefined,
    isPackage: finding.recordingIdField === "GenieNumber",
    startedAt: finding.startedAt,
  }).catch(() => {});

  finding.findingStatus = "getting-recording";
  await saveFinding(orgId, finding);

  // Multi-genie path: download all genies in parallel
  if (finding.genieIds && finding.genieIds.length > 0) {
    const validIds = finding.genieIds
      .map((gid: any) => String(gid).trim())
      .filter((trimmed: string) => {
        if (!trimmed || trimmed === "0" || trimmed.replace(/0/g, "") === "") {
          console.warn(`[STEP-INIT] ${findingId}: Skipping invalid genie ID "${trimmed}"`);
          return false;
        }
        return true;
      });

    const results = await Promise.all(
      validIds.map(async (trimmed: string) => {
        const bytes = await downloadRecording(Number(trimmed), findingId);
        if (!bytes) {
          console.warn(`[STEP-INIT] ${findingId}: No recording for genie ${trimmed}, skipping`);
          return null;
        }
        const key = `recordings/${finding.auditJobId}/${trimmed}.mp3`;
        const ref = new S3Ref(env.s3Bucket, key);
        await ref.save(bytes);
        console.log(`[STEP-INIT] ${findingId}: Genie ${trimmed} saved (${bytes.byteLength} bytes)`);
        return key;
      })
    );

    const keys = results.filter((k): k is string => k !== null);

    if (keys.length === 0) {
      finding.rawTranscript = "Invalid Genie";
      finding.findingStatus = "finished";
      await saveFinding(orgId, finding);
      await enqueueStep("finalize", { findingId, orgId });
      return json({ ok: true, skipped: true, reason: "no valid genies" });
    }

    finding.s3RecordingKeys = keys;
    finding.s3RecordingKey = keys[0];
    finding.recordingPath = keys[0];
    await saveFinding(orgId, finding);

    console.log(`[STEP-INIT] ${findingId}: Multi-genie: ${keys.length} recordings saved`);
    await enqueueStep("transcribe", { findingId, orgId });
    return json({ ok: true, s3Keys: keys });
  }

  // Validate genie ID
  const rid = String(finding.recordingId ?? "").trim();
  if (!rid || rid === "0" || rid === "00000000" || rid.replace(/0/g, "") === "") {
    console.warn(`[STEP-INIT] ${findingId}: Invalid Genie ID: "${rid}"`);
    finding.rawTranscript = "Invalid Genie";
    finding.findingStatus = "finished";
    await saveFinding(orgId, finding);
    // Skip to finalize (will fail all questions)
    await enqueueStep("finalize", { findingId, orgId });
    return json({ ok: true, skipped: true, reason: "invalid genie" });
  }

  // Download recording from Genie
  const bytes = await downloadRecording(Number(rid), findingId);
  if (!bytes) {
    console.warn(`[STEP-INIT] ${findingId}: No recording found for Genie ${rid}`);
    finding.rawTranscript = "Invalid Genie";
    finding.findingStatus = "finished";
    await saveFinding(orgId, finding);
    await enqueueStep("finalize", { findingId, orgId });
    return json({ ok: true, skipped: true, reason: "no recording" });
  }

  // Save to S3
  const s3Key = `recordings/${finding.auditJobId}/${rid}.mp3`;
  const ref = new S3Ref(env.s3Bucket, s3Key);
  await ref.save(bytes);

  finding.s3RecordingKey = s3Key;
  finding.recordingPath = s3Key;
  await saveFinding(orgId, finding);

  console.log(`[STEP-INIT] ${findingId}: Recording saved to S3 (${bytes.byteLength} bytes)`);

  // Pre-upload to AssemblyAI so transcribe step can skip the upload and return immediately
  try {
    const assemblyAiUploadUrl = await uploadAudio(bytes);
    finding.assemblyAiUploadUrl = assemblyAiUploadUrl;
    await saveFinding(orgId, finding);
    console.log(`[STEP-INIT] ${findingId}: Pre-uploaded to AssemblyAI`);
  } catch (err) {
    console.warn(`[STEP-INIT] ${findingId}: AssemblyAI pre-upload failed (transcribe will retry):`, err);
  }

  // Enqueue transcription
  await enqueueStep("transcribe", { findingId, orgId });
  return json({ ok: true, s3Key });
}
