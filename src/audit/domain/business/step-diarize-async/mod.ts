/** STEP 2c: Async speaker diarization — runs in parallel with prepare, not on the critical path. */
import { getFinding, saveFinding, saveTranscript, invalidateFindingCache } from "@audit/domain/data/audit-repository/mod.ts";
import { trackActive } from "@audit/domain/data/stats-repository/mod.ts";
import { diarize } from "@audit/domain/data/groq/mod.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

export async function stepDiarizeAsync(req: Request): Promise<Response> {
  const body = await req.json();
  // rawTranscript carried in the payload by transcribe-cb so this step doesn't
  // depend on transcribe-cb's saveFinding being visible across the QStash hop.
  const { findingId, orgId, rawTranscript: payloadRaw } = body;

  const finding = await getFinding(orgId, findingId);
  if (!finding) return json({ error: "finding not found" }, 404);
  if (finding.findingStatus === "terminated") return json({ ok: true, skipped: true, reason: "terminated" });

  // Tracking owned by step dispatcher (main.ts) — see step-ask-all for context.

  // Grep-able tag — see step-transcribe-cb for taxonomy.
  {
    const fromPayload = typeof payloadRaw === "string" && payloadRaw.length > 0;
    const fromFinding = !fromPayload && (finding.rawTranscript?.length ?? 0) > 0;
    const outcome = fromPayload ? "payload-hit" : fromFinding ? "payload-miss-finding-hit" : "BOTH-MISS";
    const log = outcome === "BOTH-MISS" ? console.warn : console.log;
    log(`🔍 [TRANSCRIPT-RACE] step=diarize-async fid=${findingId} ${outcome} payloadLen=${typeof payloadRaw === "string" ? payloadRaw.length : 0} findingLen=${finding.rawTranscript?.length ?? 0}`);
  }

  if (finding.diarizedTranscript) {
    console.log(`[STEP-DIARIZE] ${findingId}: Already diarized, skipping`);
    return json({ ok: true, skipped: true });
  }

  console.log(`[STEP-DIARIZE] ${findingId}: Starting diarization...`);

  // Prefer payload; fall back to finding doc (covers in-flight legacy messages
  // enqueued before the carry shipped).
  const raw = (typeof payloadRaw === "string" && payloadRaw.length > 0)
    ? payloadRaw
    : (finding.rawTranscript ?? "");
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
    // Bypass the 30s getFinding cache: without this, the re-fetch returns our
    // own stale pre-diarize snapshot (this step's first getFinding), so the
    // save below would revert findingStatus and wipe finalize's answers/score.
    invalidateFindingCache(orgId, findingId);
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
