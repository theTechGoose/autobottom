/** STEP 2b: Poll AssemblyAI for a transcription result — one transcript, or several
 *  concatenated for a multi-genie audit. Re-enqueues itself with delay if not done. */
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

const TRANSCRIBE_CB_PAYLOAD_MAX = 900_000;

function buildTranscribeCbPayload(findingId: string, orgId: string, rawTranscript: string, utteranceTimes: number[] | undefined): Record<string, unknown> {
  const payload: Record<string, unknown> = { findingId, orgId };
  if (rawTranscript && rawTranscript.length <= TRANSCRIBE_CB_PAYLOAD_MAX) {
    payload.rawTranscript = rawTranscript;
    if (utteranceTimes && utteranceTimes.length > 0) payload.utteranceTimes = utteranceTimes;
  }
  return payload;
}

export async function stepPollTranscript(req: Request): Promise<Response> {
  const body = await req.json();
  // `transcriptId` is now carried in the QStash payload by step-transcribe
  // (the in-memory value at submit time) so polling doesn't depend on the
  // saveFinding write surviving the 15s cross-isolate gap. Fall back to
  // the finding doc only for in-flight messages enqueued before this
  // payload-shape change deployed. See plan file for the
  // mqlfcCsh3sP1zH_6vpeT6 incident this prevents.
  const { findingId, orgId, transcriptId: payloadTranscriptId, transcriptIds: payloadTranscriptIds } = body;

  const pollStart = Date.now();
  console.log(`[STEP-POLL-TRANSCRIPT] ${findingId}: Starting...`);
  // Tracking owned by step dispatcher (main.ts) — see step-ask-all for context.

  const finding = await getFinding(orgId, findingId);
  if (!finding) return json({ error: "finding not found" }, 404);
  if (finding.findingStatus === "terminated") return json({ ok: true, skipped: true, reason: "terminated" });

  // Multi-genie: several transcripts in flight, concatenated back in submit
  // order once they all settle. Same payload-first / finding-doc-fallback rule
  // as the single-genie id below.
  const multiIds: string[] = Array.isArray(payloadTranscriptIds) && payloadTranscriptIds.length > 0
    ? payloadTranscriptIds
    : (Array.isArray(finding.assemblyAiTranscriptIds) ? finding.assemblyAiTranscriptIds : []);
  if (multiIds.length > 1) {
    return await pollMultiGenie(finding, findingId, orgId, multiIds, pollStart);
  }

  const transcriptId = payloadTranscriptId ?? finding.assemblyAiTranscriptId ?? multiIds[0];
  if (!transcriptId) {
    console.error(
      `[STEP-POLL-TRANSCRIPT] ${findingId}: ❌ No transcriptId in payload AND not on finding (payloadHad=${!!payloadTranscriptId} findingHad=${!!finding.assemblyAiTranscriptId})`,
    );
    finding.rawTranscript = "Genie Invalid";
    finding.findingStatus = "finished";
    await saveFinding(orgId, finding);
    await enqueueStep("transcribe-complete", buildTranscribeCbPayload(findingId, orgId, finding.rawTranscript, undefined));
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
    await enqueueStep("transcribe-complete", buildTranscribeCbPayload(findingId, orgId, finding.rawTranscript, undefined));
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
  const utteranceTimes = (finding as Record<string, any>).utteranceTimes as number[] | undefined;
  await enqueueStep("transcribe-complete", buildTranscribeCbPayload(findingId, orgId, finding.rawTranscript, utteranceTimes));
  console.log(`[STEP-POLL-TRANSCRIPT] ${findingId}: ✅ Completed${elapsedTag}, transcript length=${result.text.length}`);
  return json({ ok: true, completed: true });
}

/** Multi-genie wait: poll every submitted transcript, re-enqueue until they've
 *  all settled, then concatenate the completed ones IN SUBMIT ORDER.
 *
 *  Replaces the old blocking loop in step-transcribe, which held one request
 *  open for the whole AssemblyAI job and left the audit stuck at
 *  "transcribing" forever when that request died (QqzfObJYP5aibL_YT6AHX).
 *
 *  Deliberately does NOT write utteranceTimes. Those offsets are per-recording,
 *  and the reviewer's click-to-scrub player streams one leg at a time
 *  (/audit/recording?idx=n), so concatenated times would seek to the wrong
 *  place in leg 2+. Matches the old multi-genie behaviour, which was text-only. */
async function pollMultiGenie(
  finding: Record<string, any>,
  findingId: string,
  orgId: string,
  transcriptIds: string[],
  pollStart: number,
): Promise<Response> {
  const submittedAt = finding.assemblyAiSubmittedAt as number | undefined;
  const elapsedSec = submittedAt ? Math.round((pollStart - submittedAt) / 1000) : null;
  const elapsedTag = elapsedSec !== null ? ` (${elapsedSec}s since submit)` : "";

  const results: any[] = [];
  for (const id of transcriptIds) {
    try {
      results.push(await pollTranscriptOnce(id));
    } catch (err) {
      // A failed poll REQUEST says nothing about the transcript — come back and
      // ask again rather than throwing away a leg that may well be finished.
      console.warn(`[STEP-POLL-TRANSCRIPT] ${findingId}: ⚠️ Poll request failed for ${id}${elapsedTag}, retrying in ${POLL_DELAY_SECONDS}s:`, err);
      await enqueueStep("poll-transcript", { findingId, orgId, transcriptIds }, POLL_DELAY_SECONDS);
      return json({ ok: true, retrying: true, multiGenie: true });
    }
  }

  const pending = results.filter((t) => t.status === "queued" || t.status === "processing");
  if (pending.length > 0) {
    console.log(`[STEP-POLL-TRANSCRIPT] ${findingId}: 🔍 ${pending.length}/${transcriptIds.length} still running${elapsedTag}, re-polling in ${POLL_DELAY_SECONDS}s`);
    await enqueueStep("poll-transcript", { findingId, orgId, transcriptIds }, POLL_DELAY_SECONDS);
    return json({ ok: true, polling: true, multiGenie: true, pending: pending.length });
  }

  // All settled. Keep whatever completed — one dead leg must not sink an audit
  // whose other recording transcribed fine (the old loop behaved the same way).
  const texts: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const t = results[i];
    if (t.status !== "completed") {
      console.error(`[STEP-POLL-TRANSCRIPT] ${findingId}: ❌ Leg ${i + 1}/${results.length} (${transcriptIds[i]}) terminal status=${t.status} error=${t.error}`);
      continue;
    }
    const { text } = processTranscriptResult(t);
    if (text && text.trim().length > 0) texts.push(text);
  }

  if (texts.length === 0) {
    finding.rawTranscript = "Genie Invalid";
    finding.findingStatus = "finished";
  } else {
    finding.rawTranscript = texts.join("\n");
  }

  await saveFinding(orgId, finding);
  await enqueueStep("transcribe-complete", buildTranscribeCbPayload(findingId, orgId, finding.rawTranscript, undefined));
  console.log(`[STEP-POLL-TRANSCRIPT] ${findingId}: ✅ Multi-genie complete${elapsedTag}, ${texts.length}/${transcriptIds.length} legs, transcript length=${finding.rawTranscript.length}`);
  return json({ ok: true, completed: true, multiGenie: true, legs: texts.length });
}
