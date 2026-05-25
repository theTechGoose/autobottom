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
  const { findingId, orgId } = body;

  console.log(`[STEP-TRANSCRIBE-CB] ${findingId}: Starting...`);
  // Tracking owned by step dispatcher (main.ts) — see step-ask-all for context.

  // Findings are chunk-stored in Firestore; the saveFinding from
  // poll-transcript may not be visible to a different isolate within
  // 0.1-0.3s of the qstash hop. If rawTranscript reads as missing on
  // the first read, retry a few times before declaring the transcript
  // invalid. Without this, race-induced skips silently finalize an
  // audit with zero questions answered. Same pattern finalize uses.
  let finding = await getFinding(orgId, findingId);
  for (let attempt = 1; attempt <= 3 && finding && !finding.rawTranscript; attempt++) {
    console.warn(`[STEP-TRANSCRIBE-CB] ${findingId}: rawTranscript missing on attempt ${attempt} — retrying read in ${200 * attempt}ms`);
    await new Promise((r) => setTimeout(r, 200 * attempt));
    finding = await getFinding(orgId, findingId);
  }
  if (!finding) return json({ error: "finding not found" }, 404);
  if (finding.findingStatus === "terminated") return json({ ok: true, skipped: true, reason: "terminated" });

  // Invalid transcript: skip straight to finalize. Diagnostic log
  // captures the exact rawTranscript state so we can tell which
  // condition matched the next time this happens (chunked-read race
  // → length=0; substring match → real text with the sentinel inside).
  const hasInvalidPhrase = finding.rawTranscript?.includes("Invalid Genie") ||
    finding.rawTranscript?.includes("Genie Invalid");
  if (!finding.rawTranscript || hasInvalidPhrase) {
    console.warn(
      `[STEP-TRANSCRIBE-CB] ${findingId}: SKIPPING to finalize — ` +
      `rawTranscriptLength=${finding.rawTranscript?.length ?? 0} ` +
      `hasInvalidPhrase=${!!hasInvalidPhrase} ` +
      `head="${(finding.rawTranscript ?? "(missing)").slice(0, 120)}"`,
    );
    await enqueueStep("finalize", { findingId, orgId });
    return json({ ok: true, skipped: true, reason: "invalid transcript" });
  }

  // Persist raw transcript to its own KV key immediately (diarized will be filled in later)
  const utteranceTimes = (finding as Record<string, any>).utteranceTimes as number[] | undefined;
  await saveTranscript(orgId, findingId, finding.rawTranscript, undefined, utteranceTimes);
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
