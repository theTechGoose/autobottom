/** STEP 1: Initialize finding, fetch recording, save to S3. */
import { Kv } from "../../../data/kv/mod.ts";
import { enqueueStep } from "../../../data/queue/mod.ts";
import { downloadRecording } from "../../../data/genie/mod.ts";
import { S3Ref } from "../../../data/s3/mod.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function stepInit(req: Request): Promise<Response> {
  const body = await req.json();
  const { findingId, orgId } = body;

  const kv = await Kv.getInstance();
  console.log(`[STEP-INIT] ${findingId}: Starting...`);
  await kv.trackActive(orgId, findingId, "init");

  const finding = await kv.getFinding(orgId, findingId);
  if (!finding) return json({ error: "finding not found" }, 404);

  finding.findingStatus = "getting-recording";
  await kv.saveFinding(orgId, finding);

  // Multi-genie path: download each genie separately
  if (finding.genieIds && finding.genieIds.length > 0) {
    const keys: string[] = [];
    for (const gid of finding.genieIds) {
      const trimmed = String(gid).trim();
      if (!trimmed || trimmed === "0" || trimmed.replace(/0/g, "") === "") {
        console.warn(`[STEP-INIT] ${findingId}: Skipping invalid genie ID "${trimmed}"`);
        continue;
      }
      const bytes = await downloadRecording(Number(trimmed));
      if (!bytes) {
        console.warn(`[STEP-INIT] ${findingId}: No recording for genie ${trimmed}, skipping`);
        continue;
      }
      const key = `recordings/${finding.auditJobId}/${trimmed}.mp3`;
      const ref = new S3Ref(Deno.env.get("S3_BUCKET")!, key);
      await ref.save(bytes);
      keys.push(key);
      console.log(`[STEP-INIT] ${findingId}: Genie ${trimmed} saved (${bytes.byteLength} bytes)`);
    }

    if (keys.length === 0) {
      finding.rawTranscript = "Invalid Genie";
      finding.findingStatus = "finished";
      await kv.saveFinding(orgId, finding);
      await enqueueStep("finalize", { findingId, orgId });
      return json({ ok: true, skipped: true, reason: "no valid genies" });
    }

    finding.s3RecordingKeys = keys;
    finding.s3RecordingKey = keys[0];
    finding.recordingPath = keys[0];
    await kv.saveFinding(orgId, finding);

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
    await kv.saveFinding(orgId, finding);
    // Skip to finalize (will fail all questions)
    await enqueueStep("finalize", { findingId, orgId });
    return json({ ok: true, skipped: true, reason: "invalid genie" });
  }

  // Download recording from Genie
  const bytes = await downloadRecording(Number(rid));
  if (!bytes) {
    console.warn(`[STEP-INIT] ${findingId}: No recording found for Genie ${rid}`);
    finding.rawTranscript = "Invalid Genie";
    finding.findingStatus = "finished";
    await kv.saveFinding(orgId, finding);
    await enqueueStep("finalize", { findingId, orgId });
    return json({ ok: true, skipped: true, reason: "no recording" });
  }

  // Save to S3
  const s3Key = `recordings/${finding.auditJobId}/${rid}.mp3`;
  const ref = new S3Ref(Deno.env.get("S3_BUCKET")!, s3Key);
  await ref.save(bytes);

  finding.s3RecordingKey = s3Key;
  finding.recordingPath = s3Key;
  await kv.saveFinding(orgId, finding);

  console.log(`[STEP-INIT] ${findingId}: Recording saved to S3 (${bytes.byteLength} bytes)`);

  // Enqueue transcription
  await enqueueStep("transcribe", { findingId, orgId });
  return json({ ok: true, s3Key });
}
