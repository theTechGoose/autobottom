/** STEP 2c: Async speaker diarization — runs in parallel with prepare, not on the critical path.
 *  Saves [AGENT]/[CUSTOMER] labels to the transcript KV when done. Never gates QA. */
import { getFinding, saveFinding, saveTranscript, trackActive } from "../lib/kv.ts";
import { diarize } from "../providers/groq.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function stepDiarizeAsync(req: Request): Promise<Response> {
  const body = await req.json();
  const { findingId, orgId } = body;

  console.log(`[STEP-DIARIZE] ${findingId}: Starting diarization (async)...`);
  trackActive(orgId, findingId, "diarize-async").catch(() => {});

  const finding = await getFinding(orgId, findingId);
  if (!finding) return json({ error: "finding not found" }, 404);
  if (finding.findingStatus === "terminated") return json({ ok: true, skipped: true, reason: "terminated" });

  const raw = finding.rawTranscript ?? "";
  if (!raw || raw.includes("Invalid Genie") || raw.includes("Genie Invalid")) {
    console.log(`[STEP-DIARIZE] ${findingId}: Skipping — no valid transcript`);
    return json({ ok: true, skipped: true });
  }

  try {
    const diarized = await diarize(raw);
    finding.diarizedTranscript = diarized;
    await saveFinding(orgId, finding);
    await saveTranscript(orgId, findingId, raw, diarized);
    console.log(`[STEP-DIARIZE] ${findingId}: Diarization complete`);
  } catch (err) {
    console.error(`[STEP-DIARIZE] ${findingId}: Diarization failed:`, err);
    // Raw transcript already saved in transcribe-cb — report falls back to it automatically
  }

  return json({ ok: true });
}
