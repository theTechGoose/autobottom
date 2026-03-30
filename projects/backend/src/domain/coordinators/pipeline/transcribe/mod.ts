/** STEP 2: Submit audio to AssemblyAI and transcribe. */
import { getFinding, saveFinding, trackActive } from "../../../data/kv/mod.ts";
import { enqueueStep } from "../../../data/queue/mod.ts";
import { transcribe, transcribeWithUtterances } from "../../../data/assemblyai/mod.ts";
import { S3Ref } from "../../../data/s3/mod.ts";
import { env } from "../../../data/env/mod.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function stepTranscribe(req: Request): Promise<Response> {
  const body = await req.json();
  const { findingId, orgId } = body;

  console.log(`[STEP-TRANSCRIBE] ${findingId}: Starting...`);
  trackActive(orgId, findingId, "transcribe").catch(() => {});

  const finding = await getFinding(orgId, findingId);
  if (!finding) return json({ error: "finding not found" }, 404);

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
      const ref = new S3Ref(env.s3Bucket, key);
      const bytes = await ref.get();
      if (!bytes) {
        console.warn(`[STEP-TRANSCRIBE] ${findingId}: Missing S3 file ${key}, skipping`);
        continue;
      }
      try {
        const text = await transcribe(bytes);
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

  // Get recording bytes from S3 and upload to AssemblyAI
  const s3Key = finding.s3RecordingKey;
  if (!s3Key) {
    finding.rawTranscript = "Invalid Genie";
    finding.findingStatus = "finished";
    await saveFinding(orgId, finding);
    await enqueueStep("finalize", { findingId, orgId });
    return json({ ok: true, skipped: true, reason: "no s3 key" });
  }

  const ref = new S3Ref(env.s3Bucket, s3Key);
  const bytes = await ref.get();
  if (!bytes) {
    finding.rawTranscript = "Invalid Genie";
    finding.findingStatus = "finished";
    await saveFinding(orgId, finding);
    await enqueueStep("finalize", { findingId, orgId });
    return json({ ok: true, skipped: true, reason: "s3 file missing" });
  }

  // Snip path: transcribe with utterances and filter by time window
  if (finding.snipStart != null) {
    try {
      const result = await transcribeWithUtterances(bytes);
      const filtered = result.utterances.filter(
        (u) => u.start >= finding.snipStart! && (finding.snipEnd == null || u.end <= finding.snipEnd),
      );
      const text = filtered.length > 0
        ? filtered.map((u) => `${u.role}: ${u.text}`).join("\n")
        : result.text;

      if (!text || text.trim().length === 0) {
        finding.rawTranscript = "Genie Invalid";
        finding.findingStatus = "finished";
      } else {
        finding.rawTranscript = text;
      }
    } catch (err) {
      console.error(`[STEP-TRANSCRIBE] ${findingId}: Snip transcription failed:`, err);
      finding.rawTranscript = "Genie Invalid";
      finding.findingStatus = "finished";
    }

    await saveFinding(orgId, finding);
    await enqueueStep("transcribe-complete", { findingId, orgId });
    return json({ ok: true, snip: true });
  }

  try {
    const text = await transcribe(bytes);
    if (!text || text.trim().length === 0) {
      finding.rawTranscript = "Genie Invalid";
      finding.findingStatus = "finished";
    } else {
      finding.rawTranscript = text;
    }
  } catch (err) {
    console.error(`[STEP-TRANSCRIBE] ${findingId}: Transcription failed:`, err);
    finding.rawTranscript = "Genie Invalid";
    finding.findingStatus = "finished";
  }

  await saveFinding(orgId, finding);

  // Move to diarization step
  await enqueueStep("transcribe-complete", { findingId, orgId });
  return json({ ok: true });
}
