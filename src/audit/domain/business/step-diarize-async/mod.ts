/** STEP 2c: Async speaker diarization — runs in parallel with prepare, not on the critical path. */
import { getFinding, saveTranscript, getTranscript } from "@audit/domain/data/audit-repository/mod.ts";
import { diarize } from "@audit/domain/data/groq/mod.ts";
import { isValidDiarizedTranscript } from "@core/business/diarization-validation/mod.ts";

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

  // Idempotency: the transcript store is the durable home for the diarized
  // transcript (we no longer mirror it onto the finding doc — see the save note
  // below). If it already holds a real diarized transcript (distinct from raw),
  // this step ran already — skip.
  const existing = await getTranscript(orgId, findingId);
  if (existing?.diarized && existing.diarized !== existing.raw) {
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
    // Defense-in-depth: never persist a non-diarized string even though diarize()
    // already falls back to raw. If invalid, store raw so the canonical
    // audit-transcript never holds a refusal (76UGB0…). The warn below is the
    // only signal that this second guard actually fired.
    const valid = isValidDiarizedTranscript(diarized, raw);
    const toStore = valid ? diarized : raw;
    if (!valid) {
      console.warn(`⚠️ [STEP-DIARIZE] ${findingId}: diarization invalid (refusal/short) — storing raw transcript as fallback`);
    }
    // Persist ONLY to the transcript store. We deliberately do NOT write the
    // diarized transcript back onto the finding doc. This step runs IN PARALLEL
    // with prepare → ask-all → finalize, and saveFinding is a full-document
    // overwrite. Even re-reading "fresh" first left a TOCTOU window: if our read
    // landed before finalize committed "finished" and our save landed after, we
    // reverted the finished audit back to "asking-questions", wiped answers, and
    // stranded its review-queue rows — the exact race that lost BofFRUvr…
    // (reviewed at 96%, then refused as mid-pipeline). Readers get the diarized
    // transcript from the transcript store: the review queue loads it via
    // getTranscript, and the audit-report / manager-finding endpoints backfill
    // finding.diarizedTranscript from it on read.
    await saveTranscript(orgId, findingId, raw, toStore);
    console.log(`[STEP-DIARIZE] ${findingId}: Diarization complete${valid ? "" : " (raw fallback)"}`);
  } catch (err) {
    console.error(`[STEP-DIARIZE] ${findingId}: Diarization failed:`, err);
  }

  return json({ ok: true });
}
