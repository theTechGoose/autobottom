/** Read one finding the way the report page sees it — shared by GET
 *  /audit/finding and GET /audit/finding-by-record so both return the same object.
 *
 *  Two things on top of the raw getFinding:
 *    1. Retry once on a transient abort (the chunked read is 5-10 FS round-trips,
 *       and any one can trip the 25s watchdog while the data is fine).
 *    2. Backfill transcript fields from the canonical `audit-transcript` doc when
 *       the finding doc is missing them. */
import type { OrgId } from "@core/data/deno-kv/mod.ts";
import { getFinding, getTranscript } from "@audit/domain/data/audit-repository/mod.ts";

export type FindingRead =
  | { kind: "found"; finding: Record<string, unknown> }
  | { kind: "missing" }
  | { kind: "busy"; detail: string }
  | { kind: "failed"; detail: string };

const errorMessage = (err: unknown) => err instanceof Error ? err.message : String(err);

const isAbortMessage = (msg: string) =>
  msg.includes("aborted") || msg.includes("AbortError") || msg.includes("signal");

export async function readFullFinding(orgId: OrgId, id: string): Promise<FindingRead> {
  let finding: Record<string, unknown> | null = null;
  // getFinding does a CHUNKED read (header + record + transcript +
  // answeredQuestions chunks, often 5-10 FS round-trips). If any single
  // chunk aborts on the 25s foreground watchdog, the whole call throws —
  // but the data is fine, the wedge is transient. Retry once on abort
  // before giving up; this catches the common "audit mid-pipeline + brief
  // pool wedge" case where the user opens the report page seconds after
  // triggering an audit. If the retry also aborts, report busy so the
  // caller can offer a retry instead of "lookup failed".
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      finding = await getFinding(orgId, id);
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      const msg = errorMessage(err);
      const isAbort = isAbortMessage(msg);
      console.warn(`[GET-FINDING] ⚠️ getFinding attempt ${attempt + 1} threw for id=${id}: ${msg}${isAbort ? " (abort — will retry)" : " (non-abort — giving up)"}`);
      if (!isAbort) break;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 600));
    }
  }
  if (lastErr) {
    const msg = errorMessage(lastErr);
    console.error(`[GET-FINDING] ❌ getFinding final fail for id=${id} orgId=${orgId}: ${msg}`);
    return isAbortMessage(msg) ? { kind: "busy", detail: msg } : { kind: "failed", detail: msg };
  }
  if (!finding) return { kind: "missing" };

  await backfillTranscript(orgId, id, finding);
  console.log(`[GET-FINDING] ✅ found id=${id} orgId=${orgId}`);
  return { kind: "found", finding };
}

/** Transcript text lives in two places: on the finding doc (working copy for
 *  pipeline steps) and in the separate `audit-transcript` chunked doc (canonical
 *  persistent record, written by step-transcribe-cb + step-diarize-async). If
 *  either transcript field on the finding is missing — chunked-read race,
 *  downstream save with a stale value, or a skip-to-finalize that left the field
 *  empty — fall back to the canonical doc so the report page always renders the
 *  call text.
 *
 *  utteranceTimes counts as a missing field too: the scrub view (/audit/scrub)
 *  seeks the audio to a clicked transcript line, and with no per-line times every
 *  line is dead. The times index the STORE's raw lines, so when we take them we
 *  take that raw text with them — mixing the finding doc's raw with the store's
 *  times slides every timestamp onto the wrong line. Same matched-pair rule as
 *  /manager/api/finding. */
async function backfillTranscript(orgId: OrgId, id: string, rec: Record<string, unknown>): Promise<void> {
  const hasTimes = Array.isArray(rec.utteranceTimes) && (rec.utteranceTimes as unknown[]).length > 0;
  if (rec.rawTranscript && rec.diarizedTranscript && hasTimes) return;
  try {
    const t = await getTranscript(orgId, id);
    if (!t) return;
    rec.diarizedTranscript ??= t.diarized;
    if (!hasTimes && t.utteranceTimes?.length && t.raw) {
      rec.rawTranscript = t.raw;
      rec.utteranceTimes = t.utteranceTimes;
    } else {
      rec.rawTranscript ??= t.raw;
      rec.utteranceTimes ??= t.utteranceTimes;
    }
  } catch (err) {
    console.warn(`[GET-FINDING] ⚠️ getTranscript fallback failed for id=${id}: ${errorMessage(err)}`);
  }
}
