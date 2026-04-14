/** STEP 1: Initialize finding, fetch recording, save to S3. */
import { getFinding, saveFinding } from "../src/audit/domain/data/audit-repository/mod.ts";
import { trackActive } from "../src/audit/domain/data/stats-repository/mod.ts";
import { getPipelineConfig } from "../src/admin/domain/data/admin-repository/mod.ts";
import { enqueueStep } from "../src/core/domain/data/qstash/mod.ts";
import { downloadRecording } from "../src/audit/domain/data/genie/mod.ts";
import { uploadAudio } from "../src/audit/domain/data/assemblyai/mod.ts";
import { S3Ref } from "../src/core/domain/data/s3/mod.ts";


function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const MAX_GENIE_RETRIES = 4; // 1 initial + 3 retries, each 10 min apart
const GENIE_RETRY_DELAY_SEC = 600; // 10 minutes

/** True for real Genie IDs: 8 digits starting with 2 or 3.
 *  All-zeros, 7-digit, or other prefixes are fake/placeholder IDs — no point retrying. */
function isRetryableGenie(rid: string): boolean {
  return /^[23]\d{7}$/.test(rid);
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
      .map((gid: any) => String(gid).trim().replace(/[^0-9].*$/, ""))
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
        const ref = new S3Ref(Deno.env.get("S3_BUCKET") ?? "", key);
        await ref.save(bytes);
        console.log(`[STEP-INIT] ${findingId}: Genie ${trimmed} saved (${bytes.byteLength} bytes)`);
        return { key, bytes };
      })
    );

    const successful = results.filter((r): r is { key: string; bytes: Uint8Array } => r !== null);
    const keys = successful.map((r) => r.key);

    if (keys.length === 0) {
      const retryableIds = validIds.filter(isRetryableGenie);
      const attempts = (finding.genieAttempts ?? 0) + 1;
      if (retryableIds.length > 0 && attempts < MAX_GENIE_RETRIES) {
        const retryAt = Date.now() + GENIE_RETRY_DELAY_SEC * 1000;
        finding.genieAttempts = attempts;
        finding.genieRetryAt = retryAt;
        await saveFinding(orgId, finding);
        await trackActive(orgId, findingId, "genie-retry", {
          recordId: qbRecordId || undefined,
          isPackage: finding.recordingIdField === "GenieNumber",
          startedAt: finding.startedAt,
          genieRetryAt: retryAt,
          genieAttempts: attempts,
        });
        await enqueueStep("init", { findingId, orgId }, GENIE_RETRY_DELAY_SEC);
        console.log(`[STEP-INIT] ${findingId}: ⏳ Multi-genie no recordings — retry ${attempts}/${MAX_GENIE_RETRIES - 1} in ${GENIE_RETRY_DELAY_SEC / 60}min (ids: ${retryableIds.join(",")})`);
        return json({ ok: true, retrying: true, attempt: attempts, retryAt });
      }
      const reason = retryableIds.length > 0 ? "no recordings (retries exhausted)" : "no recordings (none retryable)";
      console.warn(`[STEP-INIT] ${findingId}: Multi-genie ${reason}`);
      finding.rawTranscript = "Invalid Genie";
      finding.findingStatus = "finished";
      await saveFinding(orgId, finding);
      await enqueueStep("finalize", { findingId, orgId });
      return json({ ok: true, skipped: true, reason });
    }

    finding.s3RecordingKeys = keys;
    finding.s3RecordingKey = keys[0];

    // Stitch multi-genie audio into one continuous MP3 for the review/judge queue
    if (successful.length > 1) {
      const totalBytes = successful.reduce((sum, r) => sum + r.bytes.byteLength, 0);
      const stitched = new Uint8Array(totalBytes);
      let offset = 0;
      for (const r of successful) {
        stitched.set(r.bytes, offset);
        offset += r.bytes.byteLength;
      }
      const stitchedKey = `recordings/${finding.auditJobId}/stitched.mp3`;
      const stitchedRef = new S3Ref(Deno.env.get("S3_BUCKET") ?? "", stitchedKey);
      await stitchedRef.save(stitched);
      finding.recordingPath = stitchedKey;
      console.log(`[STEP-INIT] ${findingId}: 🎵 Stitched ${successful.length} recordings → ${stitchedKey} (${totalBytes} bytes)`);
    } else {
      finding.recordingPath = keys[0];
    }

    await saveFinding(orgId, finding);

    console.log(`[STEP-INIT] ${findingId}: Multi-genie: ${keys.length} recordings saved`);
    await enqueueStep("transcribe", { findingId, orgId });
    return json({ ok: true, s3Keys: keys });
  }

  // Validate genie ID — strip any non-numeric suffix (e.g. "27475188-error" → "27475188")
  const rid = String(finding.recordingId ?? "").trim().replace(/[^0-9].*$/, "");
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
    const attempts = (finding.genieAttempts ?? 0) + 1;
    if (isRetryableGenie(rid) && attempts < MAX_GENIE_RETRIES) {
      const retryAt = Date.now() + GENIE_RETRY_DELAY_SEC * 1000;
      finding.genieAttempts = attempts;
      finding.genieRetryAt = retryAt;
      await saveFinding(orgId, finding);
      await trackActive(orgId, findingId, "genie-retry", {
        recordId: qbRecordId || undefined,
        isPackage: finding.recordingIdField === "GenieNumber",
        startedAt: finding.startedAt,
        genieRetryAt: retryAt,
        genieAttempts: attempts,
      });
      await enqueueStep("init", { findingId, orgId }, GENIE_RETRY_DELAY_SEC);
      console.log(`[STEP-INIT] ${findingId}: ⏳ Genie ${rid} not found — retry ${attempts}/${MAX_GENIE_RETRIES - 1} in ${GENIE_RETRY_DELAY_SEC / 60}min`);
      return json({ ok: true, retrying: true, attempt: attempts, retryAt });
    }
    const reason = isRetryableGenie(rid) ? "no recording (retries exhausted)" : "no recording (not retryable)";
    console.warn(`[STEP-INIT] ${findingId}: No recording found for Genie ${rid} — ${reason}`);
    finding.rawTranscript = "Invalid Genie";
    finding.findingStatus = "finished";
    await saveFinding(orgId, finding);
    await enqueueStep("finalize", { findingId, orgId });
    return json({ ok: true, skipped: true, reason });
  }

  // Save to S3
  const s3Key = `recordings/${finding.auditJobId}/${rid}.mp3`;
  const ref = new S3Ref(Deno.env.get("S3_BUCKET") ?? "", s3Key);
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
