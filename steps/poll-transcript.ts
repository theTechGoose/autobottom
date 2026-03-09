/** STEP 2b: Poll AssemblyAI for a single-genie transcription result. Re-enqueues itself with delay if not done. */
import { getFinding, saveFinding, trackActive } from "../lib/kv.ts";
import { enqueueStep } from "../lib/queue.ts";
import { pollTranscriptOnce, processTranscriptResult } from "../providers/assemblyai.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const POLL_DELAY_SECONDS = 15;

export async function stepPollTranscript(req: Request): Promise<Response> {
  const body = await req.json();
  const { findingId, orgId } = body;

  const pollStart = Date.now();
  console.log(`[STEP-POLL-TRANSCRIPT] ${findingId}: Starting...`);
  trackActive(orgId, findingId, "poll-transcript").catch(() => {});

  const finding = await getFinding(orgId, findingId);
  if (!finding) return json({ error: "finding not found" }, 404);
  if (finding.findingStatus === "terminated") return json({ ok: true, skipped: true, reason: "terminated" });

  const transcriptId = finding.assemblyAiTranscriptId;
  if (!transcriptId) {
    console.error(`[STEP-POLL-TRANSCRIPT] ${findingId}: ❌ No transcript ID on finding`);
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
    await enqueueStep("poll-transcript", { findingId, orgId }, POLL_DELAY_SECONDS);
    return json({ ok: true, retrying: true });
  }

  // Still processing — come back later
  if (transcript.status === "queued" || transcript.status === "processing") {
    console.log(`[STEP-POLL-TRANSCRIPT] ${findingId}: 🔍 status=${transcript.status}${elapsedTag}, re-polling in ${POLL_DELAY_SECONDS}s`);
    await enqueueStep("poll-transcript", { findingId, orgId }, POLL_DELAY_SECONDS);
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
  }

  await saveFinding(orgId, finding);
  await enqueueStep("transcribe-complete", { findingId, orgId });
  console.log(`[STEP-POLL-TRANSCRIPT] ${findingId}: ✅ Completed${elapsedTag}, transcript length=${result.text.length}`);
  return json({ ok: true, completed: true });
}
