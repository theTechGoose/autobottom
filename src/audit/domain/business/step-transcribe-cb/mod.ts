/** STEP 2b: Post-transcription router — saves raw transcript, fires prepare + diarize-async in parallel. */
import { getFinding, saveFinding, saveTranscript } from "@audit/domain/data/audit-repository/mod.ts";
import { trackActive } from "@audit/domain/data/stats-repository/mod.ts";
import { enqueueStep } from "@core/data/qstash/mod.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function stepTranscribeCb(req: Request): Promise<Response> {
  const body = await req.json();
  // rawTranscript + utteranceTimes are now carried in the QStash payload
  // from step-poll-transcript so the cb doesn't depend on a chunked
  // saveFinding write becoming visible across the QStash isolate hop.
  // Fall back to the finding doc only for messages enqueued before this
  // payload shape deployed. See plan file for the rationale.
  const { findingId, orgId, rawTranscript: payloadRaw, utteranceTimes: payloadTimes } = body;

  console.log(`[STEP-TRANSCRIBE-CB] ${findingId}: Starting... payloadRawLength=${typeof payloadRaw === "string" ? payloadRaw.length : 0}`);
  // Tracking owned by step dispatcher (main.ts) — see step-ask-all for context.

  let finding = await getFinding(orgId, findingId);
  if (!finding) return json({ error: "finding not found" }, 404);
  if (finding.findingStatus === "terminated") return json({ ok: true, skipped: true, reason: "terminated" });

  let rawTranscript: string | undefined = (typeof payloadRaw === "string" && payloadRaw.length > 0)
    ? payloadRaw
    : finding.rawTranscript;
  let utteranceTimes: number[] | undefined = (Array.isArray(payloadTimes) ? payloadTimes : undefined)
    ?? (finding as Record<string, any>).utteranceTimes;

  // Backstop retry only when both payload and finding doc are empty —
  // catches the rare in-flight message enqueued before payload-carry
  // deployed. Same backoff schedule as before.
  for (let attempt = 1; attempt <= 3 && !rawTranscript; attempt++) {
    console.warn(`[STEP-TRANSCRIBE-CB] ${findingId}: rawTranscript missing on attempt ${attempt} — retrying read in ${200 * attempt}ms`);
    await new Promise((r) => setTimeout(r, 200 * attempt));
    finding = await getFinding(orgId, findingId);
    rawTranscript = finding?.rawTranscript;
    utteranceTimes ??= (finding as Record<string, any> | null)?.utteranceTimes;
  }
  if (!finding) return json({ error: "finding not found" }, 404);

  // Invalid transcript: skip straight to finalize. Diagnostic log
  // captures the exact rawTranscript state so we can tell which
  // condition matched the next time this happens (chunked-read race
  // → length=0; substring match → real text with the sentinel inside).
  const hasInvalidPhrase = rawTranscript?.includes("Invalid Genie") ||
    rawTranscript?.includes("Genie Invalid");
  if (!rawTranscript || hasInvalidPhrase) {
    console.warn(
      `[STEP-TRANSCRIBE-CB] ${findingId}: SKIPPING to finalize — ` +
      `rawTranscriptLength=${rawTranscript?.length ?? 0} ` +
      `hasInvalidPhrase=${!!hasInvalidPhrase} ` +
      `head="${(rawTranscript ?? "(missing)").slice(0, 120)}"`,
    );
    await enqueueStep("finalize", { findingId, orgId });
    return json({ ok: true, skipped: true, reason: "invalid transcript" });
  }

  // Make sure the finding doc reflects the payload value so downstream
  // steps (ask-batch, ask-all, bad-word-check) that read finding.rawTranscript
  // see the same text we just validated, even if the original saveFinding
  // from poll-transcript hasn't fully propagated yet.
  finding.rawTranscript = rawTranscript;
  if (utteranceTimes) (finding as Record<string, any>).utteranceTimes = utteranceTimes;

  // Persist raw transcript to its own KV key immediately (diarized will be filled in later)
  await saveTranscript(orgId, findingId, rawTranscript, undefined, utteranceTimes);
  await saveFinding(orgId, finding);

  // Fire prepare (critical path) + diarize-async (parallel, non-blocking) concurrently.
  // QA runs entirely off rawTranscript — diarize result is cosmetic only (report display).
  await Promise.all([
    enqueueStep("prepare", { findingId, orgId }),
    enqueueStep("diarize-async", { findingId, orgId }),
  ]);

  console.log(`[STEP-TRANSCRIBE-CB] ${findingId}: Enqueued prepare + diarize-async`);
  return json({ ok: true });
}
