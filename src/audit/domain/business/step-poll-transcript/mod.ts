/** STEP 2b: Poll AssemblyAI for a single-genie transcription result. Re-enqueues itself with delay if not done. */
import { getFinding, saveFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { trackActive } from "@audit/domain/data/stats-repository/mod.ts";
import { enqueueStep } from "@core/data/qstash/mod.ts";
import { pollTranscriptOnce, processTranscriptResult } from "@audit/domain/data/assemblyai/mod.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const POLL_DELAY_SECONDS = 15;

export async function stepPollTranscript(req: Request): Promise<Response> {
  const body = await req.json();
  // `transcriptId` is now carried in the QStash payload by step-transcribe
  // (the in-memory value at submit time) so polling doesn't depend on the
  // saveFinding write surviving the 15s cross-isolate gap. Fall back to
  // the finding doc only for in-flight messages enqueued before this
  // payload-shape change deployed. See plan file for the
  // mqlfcCsh3sP1zH_6vpeT6 incident this prevents.
  const { findingId, orgId, transcriptId: payloadTranscriptId } = body;

  const pollStart = Date.now();
  console.log(`[STEP-POLL-TRANSCRIPT] ${findingId}: Starting...`);
  // Tracking owned by step dispatcher (main.ts) — see step-ask-all for context.

  const finding = await getFinding(orgId, findingId);
  if (!finding) return json({ error: "finding not found" }, 404);
  if (finding.findingStatus === "terminated") return json({ ok: true, skipped: true, reason: "terminated" });

  const transcriptId = payloadTranscriptId ?? finding.assemblyAiTranscriptId;
  if (!transcriptId) {
    console.error(
      `[STEP-POLL-TRANSCRIPT] ${findingId}: ❌ No transcriptId in payload AND not on finding (payloadHad=${!!payloadTranscriptId} findingHad=${!!finding.assemblyAiTranscriptId})`,
    );
    finding.rawTranscript = "Genie Invalid";
    finding.findingStatus = "finished";
    await saveFinding(orgId, finding);
    await enqueueStep("transcribe-complete", { findingId, orgId });
    return json({ ok: true, error: "no transcript id" });
  }

  // Elapsed time since AssemblyAI submission
  const submittedAt = (finding as Record<string, any>).assemblyAiSubmittedAt as number | undefined;
  const elapsedSec = submittedAt ? Math.round((pollStart - submittedAt) / 1000) : null;
  const elapsedTag = elapsedSec !== null ? ` (${elapsedSec}s since submit)` : "";

  let transcript: any;
  try {
    transcript = await pollTranscriptOnce(transcriptId);
  } catch (err) {
    console.warn(`[STEP-POLL-TRANSCRIPT] ${findingId}: ⚠️ Poll request failed${elapsedTag}, retrying in ${POLL_DELAY_SECONDS}s:`, err);
    // Propagate transcriptId so the retry doesn't lose it.
    await enqueueStep("poll-transcript", { findingId, orgId, transcriptId }, POLL_DELAY_SECONDS);
    return json({ ok: true, retrying: true });
  }

  // Still processing — come back later
  if (transcript.status === "queued" || transcript.status === "processing") {
    console.log(`[STEP-POLL-TRANSCRIPT] ${findingId}: 🔍 status=${transcript.status}${elapsedTag}, re-polling in ${POLL_DELAY_SECONDS}s`);
    // Propagate transcriptId so the re-poll doesn't lose it.
    await enqueueStep("poll-transcript", { findingId, orgId, transcriptId }, POLL_DELAY_SECONDS);
    return json({ ok: true, polling: true, status: transcript.status });
  }

  // Error or unknown status
  if (transcript.status !== "completed") {
    console.error(`[STEP-POLL-TRANSCRIPT] ${findingId}: ❌ Terminal status=${transcript.status}${elapsedTag} error=${transcript.error}`);
    finding.rawTranscript = "Genie Invalid";
    finding.findingStatus = "finished";
    await saveFinding(orgId, finding);
    await enqueueStep("transcribe-complete", { findingId, orgId });
    return json({ ok: true, transcriptStatus: transcript.status });
  }

  // Completed — process result (snip filter applied inside processTranscriptResult)
  const result = processTranscriptResult(transcript, finding.snipStart, finding.snipEnd);

  if (!result.text || result.text.trim().length === 0) {
    finding.rawTranscript = "Genie Invalid";
    finding.findingStatus = "finished";
  } else {
    finding.rawTranscript = result.text;
    // Store utterance start times (ms) so the reviewer can seek audio to the right position per line
    if (result.utterances && result.utterances.length > 0) {
      (finding as Record<string, any>).utteranceTimes = result.utterances.map((u: { start: number }) => u.start);
    }
  }

  await saveFinding(orgId, finding);
  await enqueueStep("transcribe-complete", { findingId, orgId });
  console.log(`[STEP-POLL-TRANSCRIPT] ${findingId}: ✅ Completed${elapsedTag}, transcript length=${result.text.length}`);
  return json({ ok: true, completed: true });
}
