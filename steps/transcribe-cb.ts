/** STEP 2b: Post-transcription router — saves raw transcript, fires prepare + diarize-async in parallel. */
import { getFinding, saveFinding, saveTranscript, trackActive } from "../lib/kv.ts";
import { enqueueStep } from "../lib/queue.ts";

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
  trackActive(orgId, findingId, "transcribe-cb").catch(() => {});

  const finding = await getFinding(orgId, findingId);
  if (!finding) return json({ error: "finding not found" }, 404);
  if (finding.findingStatus === "terminated") return json({ ok: true, skipped: true, reason: "terminated" });

  // Invalid transcript: skip straight to finalize
  if (
    !finding.rawTranscript ||
    finding.rawTranscript.includes("Invalid Genie") ||
    finding.rawTranscript.includes("Genie Invalid")
  ) {
    await enqueueStep("finalize", { findingId, orgId });
    return json({ ok: true, skipped: true, reason: "invalid transcript" });
  }

  // Persist raw transcript to its own KV key immediately (diarized will be filled in later)
  await saveTranscript(orgId, findingId, finding.rawTranscript, undefined);
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
