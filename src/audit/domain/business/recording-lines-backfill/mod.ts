/** Give multi-recording audits transcribed before REQ-015 their per-recording
 *  line times (REQ-016).
 *
 *  Those audits kept only the joined text — the times AssemblyAI returned were
 *  dropped. Each finding still has its AssemblyAI transcript ids, so this
 *  re-reads them, rebuilds the joined text exactly as step-poll-transcript does,
 *  and stores recordingLineTimes/recordingLineIdx ONLY when that text matches
 *  what the audit has: the times index those lines, and a transcript repaired
 *  or re-run since would take every time onto the wrong line.
 *
 *  Reads AssemblyAI and the finding; writes nothing unless `apply`. Idempotent —
 *  an audit that has times is skipped. */
import type { OrgId } from "@core/data/deno-kv/mod.ts";
import { getFinding, getTranscript, saveFinding, saveTranscript } from "@audit/domain/data/audit-repository/mod.ts";
import { pollTranscriptOnce } from "@audit/domain/data/assemblyai/mod.ts";
import { joinRecordingTranscripts } from "@audit/domain/business/recording-lines/mod.ts";

export type BackfillOutcome =
  | "updated"
  | "would-update"
  | "not-found"
  | "not-multi"
  | "has-times"
  | "skipped";

export interface BackfillResult {
  findingId: string;
  outcome: BackfillOutcome;
  reason?: string;
}

export async function backfillRecordingLines(
  orgId: OrgId,
  findingIds: string[],
  opts: { apply: boolean },
): Promise<BackfillResult[]> {
  const out: BackfillResult[] = [];
  for (const findingId of findingIds) out.push(await backfillOne(orgId, findingId, opts.apply));
  return out;
}

async function backfillOne(orgId: OrgId, findingId: string, apply: boolean): Promise<BackfillResult> {
  const finding = await getFinding(orgId, findingId) as Record<string, any> | null;
  if (!finding) return { findingId, outcome: "not-found" };
  const keys: string[] = finding.s3RecordingKeys ?? [];
  const ids: string[] = finding.assemblyAiTranscriptIds ?? [];
  if (keys.length < 2) return { findingId, outcome: "not-multi" };
  if (ids.length < 2) return { findingId, outcome: "skipped", reason: "no AssemblyAI transcript ids stored on the finding" };
  if (Array.isArray(finding.recordingLineTimes) && finding.recordingLineTimes.length > 0) {
    return { findingId, outcome: "has-times" };
  }

  // Which recording each transcript is. Older audits never stored it; with one
  // transcript per recording it's the identity, otherwise a leg was skipped at
  // submit and there's no telling which.
  const recs: number[] | null = Array.isArray(finding.assemblyAiTranscriptRecs)
    ? finding.assemblyAiTranscriptRecs
    : ids.length === keys.length
    ? ids.map((_, i) => i)
    : null;
  if (!recs) return { findingId, outcome: "skipped", reason: `${ids.length} transcripts for ${keys.length} recordings, mapping unknown` };

  const transcripts = [];
  for (const id of ids) transcripts.push(await pollTranscriptOnce(id));
  const { text, recordingLines } = joinRecordingTranscripts(transcripts.map((transcript, i) => ({ rec: recs[i], transcript })));
  if (!recordingLines) return { findingId, outcome: "skipped", reason: "transcripts have no per-line utterances" };

  const store = await getTranscript(orgId, findingId);
  if (text !== finding.rawTranscript || (store && store.raw !== text)) {
    return { findingId, outcome: "skipped", reason: "stored transcript text no longer matches the AssemblyAI transcripts" };
  }

  if (!apply) return { findingId, outcome: "would-update" };
  Object.assign(finding, recordingLines);
  await saveFinding(orgId, finding);
  await saveTranscript(orgId, findingId, text, undefined, undefined, recordingLines);
  return { findingId, outcome: "updated" };
}
