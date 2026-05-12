/** STEP 2c: Async speaker diarization — runs in parallel with prepare, not on the critical path. */
import { getFinding, saveFinding, saveTranscript } from "@audit/domain/data/audit-repository/mod.ts";
import { trackActive } from "@audit/domain/data/stats-repository/mod.ts";
import { diarize } from "@audit/domain/data/groq/mod.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

export async function stepDiarizeAsync(req: Request): Promise<Response> {
  const body = await req.json();
  const { findingId, orgId } = body;

  const finding = await getFinding(orgId, findingId);
  if (!finding) return json({ error: "finding not found" }, 404);
  if (finding.findingStatus === "terminated") return json({ ok: true, skipped: true, reason: "terminated" });

  // Tracking owned by step dispatcher (main.ts) — see step-ask-all for context.

  if (finding.diarizedTranscript) {
    console.log(`[STEP-DIARIZE] ${findingId}: Already diarized, skipping`);
    return json({ ok: true, skipped: true });
  }

  console.log(`[STEP-DIARIZE] ${findingId}: Starting diarization...`);

  const raw = finding.rawTranscript ?? "";
  if (!raw || raw.includes("Invalid Genie") || raw.includes("Genie Invalid")) {
    console.log(`[STEP-DIARIZE] ${findingId}: Skipping — no valid transcript`);
    return json({ ok: true, skipped: true });
  }

  try {
    const diarized = await diarize(raw);
    // CRITICAL: re-fetch the finding right before save. This step runs IN
    // PARALLEL with prepare → ask-all → finalize on the critical path.
    // Diarization can take seconds-to-minutes; meanwhile the critical path
    // may have flipped findingStatus from "asking-questions" → "finished"
    // and written answeredQuestions. Saving the stale snapshot we captured
    // before diarize() would regress those updates: status would flip back
    // to "asking-questions", answeredQuestions would be wiped, and the
    // audit would appear orphan in Recently Completed while review-queue
    // rows reference indices that no longer exist. That is the exact bug
    // that left lTBHV… and NLbvBCPh… stuck for joshk + ashleyk.
    // Only mutate diarizedTranscript on the fresh read so concurrent
    // writers on other fields don't lose their work.
    const fresh = await getFinding(orgId, findingId);
    if (fresh) {
      fresh.diarizedTranscript = diarized;
      await saveFinding(orgId, fresh);
    } else {
      console.warn(`⚠️ [STEP-DIARIZE] ${findingId}: finding disappeared between snapshot + diarize result — skipping save`);
    }
    await saveTranscript(orgId, findingId, raw, diarized);
    console.log(`[STEP-DIARIZE] ${findingId}: Diarization complete`);
  } catch (err) {
    console.error(`[STEP-DIARIZE] ${findingId}: Diarization failed:`, err);
  }

  return json({ ok: true });
}
