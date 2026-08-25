/** STEP 2: Submit audio to AssemblyAI. Returns immediately (single OR multi genie);
 *  poll-transcript handles the wait. */
import { getFinding, saveFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { trackActive } from "@audit/domain/data/stats-repository/mod.ts";
import { enqueueStep } from "@core/data/qstash/mod.ts";
import { uploadAudio, submitTranscription } from "@audit/domain/data/assemblyai/mod.ts";
import { S3Ref } from "@core/data/s3/mod.ts";


function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const POLL_DELAY_SECONDS = 15;

export async function stepTranscribe(req: Request): Promise<Response> {
  const body = await req.json();
  // Recording fields are carried in the QStash payload by step-init so
  // step-transcribe doesn't depend on a cross-isolate Firestore read of
  // s3RecordingKey/s3RecordingKeys/recordingPath/assemblyAiUploadUrl.
  // Without this, a stale read here cascaded into the "no s3 key"
  // Invalid-Genie skip even on audits where the genie download succeeded
  // (see LI6JHRl9-N6uvuRoA8ykO incident).
  const {
    findingId,
    orgId,
    s3RecordingKeys: payloadKeys,
    s3RecordingKey: payloadKey,
    recordingPath: payloadPath,
    assemblyAiUploadUrl: payloadUploadUrl,
  } = body;

  console.log(`[STEP-TRANSCRIBE] ${findingId}: Starting... payloadKeysLength=${Array.isArray(payloadKeys) ? payloadKeys.length : 0} payloadKey=${typeof payloadKey === "string" && payloadKey ? "yes" : "no"}`);
  // Tracking owned by step dispatcher (main.ts) — see step-ask-all for context.

  const finding = await getFinding(orgId, findingId);
  if (!finding) return json({ error: "finding not found" }, 404);
  if (finding.findingStatus === "terminated") return json({ ok: true, skipped: true, reason: "terminated" });

  // Re-hydrate from payload — guards against the chunked-write/cross-isolate
  // race where step-init's saveFinding hasn't propagated yet. Without this,
  // the next saveFinding below would overwrite the persisted doc with a
  // stale snapshot missing the recording fields.
  if (Array.isArray(payloadKeys) && payloadKeys.length > 0) finding.s3RecordingKeys = payloadKeys;
  if (typeof payloadKey === "string" && payloadKey) finding.s3RecordingKey = payloadKey;
  if (typeof payloadPath === "string" && payloadPath) finding.recordingPath = payloadPath;
  if (typeof payloadUploadUrl === "string" && payloadUploadUrl) finding.assemblyAiUploadUrl = payloadUploadUrl;

  if (finding.rawTranscript) {
    console.log(`[STEP-TRANSCRIBE] ${findingId}: Already has transcript, skipping`);
    await enqueueStep("transcribe-complete", { findingId, orgId });
    return json({ ok: true, skipped: true });
  }

  finding.findingStatus = "transcribing";
  await saveFinding(orgId, finding);

  // Multi-genie path: submit every recording to AssemblyAI, then hand off to
  // poll-transcript — exactly like the single-genie path below.
  //
  // This used to call the BLOCKING transcribe() once per recording, holding the
  // request open for the entire AssemblyAI job (whose internal wait loop has no
  // deadline at all). When that wait stalled, the isolate died mid-loop: no
  // status write, no error, no log — and because non-delayed QStash steps carry
  // Upstash-Retries: 0, nothing ever re-sent it. QqzfObJYP5aibL_YT6AHX sat at
  // findingStatus="transcribing" for 4 days that way. Submitting and returning
  // means the handler now finishes in seconds and every subsequent wait is a
  // separate, individually-retryable QStash message.
  const multiKeys = finding.s3RecordingKeys;
  if (multiKeys && multiKeys.length > 1) {
    // Order matters — the transcripts are concatenated back in submit order to
    // reconstruct the call chronologically, so this stays a sequential loop
    // over multiKeys and a failed leg does NOT shift the others.
    const transcriptIds: string[] = [];
    for (const key of multiKeys) {
      const ref = new S3Ref(Deno.env.get("S3_BUCKET") ?? "", key);
      const bytes = await ref.get();
      if (!bytes) {
        console.warn(`[STEP-TRANSCRIBE] ${findingId}: Missing S3 file ${key}, skipping`);
        continue;
      }
      try {
        const uploadUrl = await uploadAudio(bytes);
        transcriptIds.push(await submitTranscription(uploadUrl, findingId));
      } catch (err) {
        // Same tolerance as before: one bad leg must not sink the whole audit.
        console.error(`[STEP-TRANSCRIBE] ${findingId}: Failed to submit ${key}:`, err);
      }
    }

    if (transcriptIds.length === 0) {
      finding.rawTranscript = "Genie Invalid";
      finding.findingStatus = "finished";
      await saveFinding(orgId, finding);
      // Payload-carry rawTranscript across the QStash hop so transcribe-cb
      // doesn't depend on the saveFinding write propagating across isolates.
      // Without this, multi-genie audits raced and finalized with 0 questions
      // (BOTH-MISS at [TRANSCRIPT-RACE] — see 7xjSz3Cb8HgKmDOmRfhAP incident).
      await enqueueStep("transcribe-complete", { findingId, orgId, rawTranscript: finding.rawTranscript });
      return json({ ok: true, multiGenie: true, error: true, reason: "no submissions" });
    }

    // CRITICAL: carry transcriptIds IN THE QSTASH PAYLOAD, same reason the
    // single-genie path does — poll-transcript must not depend on this
    // saveFinding being visible to a fresh isolate 15s later.
    finding.assemblyAiTranscriptIds = transcriptIds;
    (finding as Record<string, any>).assemblyAiSubmittedAt = Date.now();
    await saveFinding(orgId, finding);
    await enqueueStep("poll-transcript", { findingId, orgId, transcriptIds }, POLL_DELAY_SECONDS);
    console.log(`[STEP-TRANSCRIBE] ${findingId}: 🚀 Submitted ${transcriptIds.length}/${multiKeys.length} recordings [${transcriptIds.join(",")}], polling in ${POLL_DELAY_SECONDS}s`);
    return json({ ok: true, multiGenie: true, submitted: transcriptIds.length });
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
    // Upload-reaudit (Option V): pass snipStart/snipEnd so AssemblyAI only
    // transcribes the trimmed portion. No-op for regular audits.
    const isUploadReaudit = (finding as Record<string, unknown>).appealType === "upload-recording";
    const snipStart = isUploadReaudit ? Number((finding as Record<string, unknown>).snipStart ?? NaN) : NaN;
    const snipEnd = isUploadReaudit ? Number((finding as Record<string, unknown>).snipEnd ?? NaN) : NaN;
    const submitOpts = isUploadReaudit && (Number.isFinite(snipStart) || Number.isFinite(snipEnd))
      ? {
          ...(Number.isFinite(snipStart) ? { audioStartFrom: snipStart } : {}),
          ...(Number.isFinite(snipEnd) ? { audioEndAt: snipEnd } : {}),
        }
      : undefined;
    const transcriptId = await submitTranscription(uploadUrl, findingId, submitOpts);
    finding.assemblyAiTranscriptId = transcriptId;
    (finding as Record<string, any>).assemblyAiSubmittedAt = Date.now();
    await saveFinding(orgId, finding);
    // Return immediately — poll-transcript handles waiting and result processing.
    // CRITICAL: pass `transcriptId` IN THE QSTASH PAYLOAD so poll-transcript
    // doesn't depend on the saveFinding write being visible to a fresh
    // isolate 15s later. Race-survivor for the "No transcript ID on finding"
    // path that booked mqlfcCsh3sP1zH_6vpeT6 as an invalid-genie chargeback
    // despite a healthy 1.6MB recording — see plan file for full timeline.
    await enqueueStep("poll-transcript", { findingId, orgId, transcriptId }, POLL_DELAY_SECONDS);
    console.log(`[STEP-TRANSCRIBE] ${findingId}: 🚀 Submitted ${transcriptId}, polling in ${POLL_DELAY_SECONDS}s${submitOpts ? ` (snip ${submitOpts.audioStartFrom ?? "-"}→${submitOpts.audioEndAt ?? "-"}ms)` : ""}`);
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
