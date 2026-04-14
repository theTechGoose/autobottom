/** STEP 2: Submit audio to AssemblyAI. Single-genie returns immediately; poll-transcript handles the wait. */
import { getFinding, saveFinding, trackActive } from "../lib/kv.ts";
import { enqueueStep } from "../src/core/domain/data/qstash/mod.ts";
import { transcribe, uploadAudio, submitTranscription } from "../src/audit/domain/data/assemblyai/mod.ts";
import { S3Ref } from "../src/core/domain/data/s3/mod.ts";


function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const POLL_DELAY_SECONDS = 15;

export async function stepTranscribe(req: Request): Promise<Response> {
  const body = await req.json();
  const { findingId, orgId } = body;

  console.log(`[STEP-TRANSCRIBE] ${findingId}: Starting...`);
  trackActive(orgId, findingId, "transcribe").catch(() => {});

  const finding = await getFinding(orgId, findingId);
  if (!finding) return json({ error: "finding not found" }, 404);
  if (finding.findingStatus === "terminated") return json({ ok: true, skipped: true, reason: "terminated" });

  if (finding.rawTranscript) {
    console.log(`[STEP-TRANSCRIBE] ${findingId}: Already has transcript, skipping`);
    await enqueueStep("transcribe-complete", { findingId, orgId });
    return json({ ok: true, skipped: true });
  }

  finding.findingStatus = "transcribing";
  await saveFinding(orgId, finding);

  // Multi-genie path: transcribe each recording separately and concatenate
  const multiKeys = finding.s3RecordingKeys;
  if (multiKeys && multiKeys.length > 1) {
    const texts: string[] = [];
    for (const key of multiKeys) {
      const ref = new S3Ref(Deno.env.get("S3_BUCKET") ?? "", key);
      const bytes = await ref.get();
      if (!bytes) {
        console.warn(`[STEP-TRANSCRIBE] ${findingId}: Missing S3 file ${key}, skipping`);
        continue;
      }
      try {
        const text = await transcribe(bytes, 3, 1500, findingId);
        if (text && text.trim().length > 0) texts.push(text);
      } catch (err) {
        console.error(`[STEP-TRANSCRIBE] ${findingId}: Failed to transcribe ${key}:`, err);
      }
    }

    if (texts.length === 0) {
      finding.rawTranscript = "Genie Invalid";
      finding.findingStatus = "finished";
    } else {
      finding.rawTranscript = texts.join("\n");
    }

    await saveFinding(orgId, finding);
    await enqueueStep("transcribe-complete", { findingId, orgId });
    return json({ ok: true, multiGenie: true, transcribed: texts.length });
  }

  // Single-genie path: non-blocking submit → poll-transcript handles the rest
  const s3Key = finding.s3RecordingKey;
  if (!s3Key) {
    finding.rawTranscript = "Invalid Genie";
    finding.findingStatus = "finished";
    await saveFinding(orgId, finding);
    await enqueueStep("finalize", { findingId, orgId });
    return json({ ok: true, skipped: true, reason: "no s3 key" });
  }

  // Use pre-uploaded URL from init if available, otherwise upload now
  let uploadUrl: string = finding.assemblyAiUploadUrl || "";
  if (!uploadUrl) {
    const ref = new S3Ref(Deno.env.get("S3_BUCKET") ?? "", s3Key);
    const bytes = await ref.get();
    if (!bytes) {
      finding.rawTranscript = "Invalid Genie";
      finding.findingStatus = "finished";
      await saveFinding(orgId, finding);
      await enqueueStep("finalize", { findingId, orgId });
      return json({ ok: true, skipped: true, reason: "s3 file missing" });
    }
    uploadUrl = await uploadAudio(bytes);
  }

  try {
    const transcriptId = await submitTranscription(uploadUrl, findingId);
    finding.assemblyAiTranscriptId = transcriptId;
    (finding as Record<string, any>).assemblyAiSubmittedAt = Date.now();
    await saveFinding(orgId, finding);
    // Return immediately — poll-transcript handles waiting and result processing
    await enqueueStep("poll-transcript", { findingId, orgId }, POLL_DELAY_SECONDS);
    console.log(`[STEP-TRANSCRIBE] ${findingId}: 🚀 Submitted ${transcriptId}, polling in ${POLL_DELAY_SECONDS}s`);
    return json({ ok: true, transcriptId });
  } catch (err) {
    console.error(`[STEP-TRANSCRIBE] ${findingId}: Submit failed:`, err);
    finding.rawTranscript = "Genie Invalid";
    finding.findingStatus = "finished";
    await saveFinding(orgId, finding);
    await enqueueStep("transcribe-complete", { findingId, orgId });
    return json({ ok: true, error: true });
  }
}
