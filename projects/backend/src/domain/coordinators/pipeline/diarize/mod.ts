/** STEP 2b: Diarize the raw transcript using Groq LLM. */
import { getFinding, saveFinding, saveTranscript, trackActive } from "../../../data/kv/mod.ts";
import { enqueueStep } from "../../../data/queue/mod.ts";
import { diarize } from "../../../data/groq/mod.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function stepTranscribeCb(req: Request): Promise<Response> {
  const body = await req.json();
  const { findingId, orgId } = body;

  console.log(`[STEP-DIARIZE] ${findingId}: Starting diarization...`);
  trackActive(orgId, findingId, "diarize").catch(() => {});

  const finding = await getFinding(orgId, findingId);
  if (!finding) return json({ error: "finding not found" }, 404);

  // If invalid transcript, skip to finalize
  if (finding.rawTranscript?.includes("Invalid Genie") || finding.rawTranscript?.includes("Genie Invalid")) {
    await enqueueStep("finalize", { findingId, orgId });
    return json({ ok: true, skipped: true, reason: "invalid transcript" });
  }

  if (!finding.rawTranscript) {
    await enqueueStep("finalize", { findingId, orgId });
    return json({ ok: true, skipped: true, reason: "no transcript" });
  }

  try {
    const diarized = await diarize(finding.rawTranscript);
    finding.diarizedTranscript = diarized;
  } catch (err) {
    console.error(`[STEP-DIARIZE] ${findingId}: Diarization failed:`, err);
    // Continue without diarization - raw transcript still available
  }

  // Persist full transcript in its own KV key (backup)
  await saveTranscript(orgId, findingId, finding.rawTranscript, finding.diarizedTranscript);

  await saveFinding(orgId, finding);

  // Move to preparation step
  await enqueueStep("prepare", { findingId, orgId });
  return json({ ok: true });
}
