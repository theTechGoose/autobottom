/** Join a multi-recording audit's per-recording AssemblyAI transcripts into the
 *  one text the grader reads, and keep each line's place in its own recording.
 *
 *  Every recording has its own clock starting at 0:00, so one flat list of
 *  times can't say where a line plays. Next to the joined text this returns a
 *  matched pair indexed to its non-empty lines: the line's start (ms) on its own
 *  recording, and which recording that is (the /audit/recording `idx`). The
 *  scrub view uses the pair to switch to the right recording before seeking.
 *
 *  Used by step-poll-transcript (new audits) and the recording-lines backfill
 *  (audits that finished before the pair was stored), so both build the same
 *  text the same way. */
import { processTranscriptResult } from "@audit/domain/data/assemblyai/mod.ts";
import type { RecordingLines } from "@audit/domain/data/audit-repository/mod.ts";

export interface RecordingTranscript {
  /** Index of the recording in the finding's s3RecordingKeys; negative when
   *  unknown, which drops the line pair (the text is still joined). */
  rec: number;
  /** A settled AssemblyAI transcript (GET /v2/transcript/<id>). */
  // deno-lint-ignore no-explicit-any
  transcript: any;
}

export interface JoinedTranscript {
  text: string;
  /** How many recordings made it into `text`. */
  kept: number;
  /** Absent when any kept recording has no per-line utterances — a partial
   *  pair would misalign every line after the gap, so it's all or nothing. */
  recordingLines?: RecordingLines;
}

/** Completed recordings only, in the order given (submit order = call order).
 *  A recording that failed or came back empty is dropped, same as before. */
export function joinRecordingTranscripts(recordings: RecordingTranscript[]): JoinedTranscript {
  const texts: string[] = [];
  const times: number[] = [];
  const idx: number[] = [];
  let aligned = true;
  for (const { rec, transcript } of recordings) {
    if (transcript?.status !== "completed") continue;
    const { text, utterances } = processTranscriptResult(transcript);
    if (!text || text.trim().length === 0) continue;
    texts.push(text);
    const lineCount = text.split(/\r?\n/).filter((l) => l.trim()).length;
    if (utterances.length === 0 || utterances.length !== lineCount) {
      aligned = false;
      continue;
    }
    for (const u of utterances) {
      times.push(u.start);
      idx.push(rec);
    }
  }
  const text = texts.join("\n");
  const kept = texts.length;
  if (!aligned || times.length === 0 || idx.some((r) => r < 0)) return { text, kept };
  return { text, kept, recordingLines: { recordingLineTimes: times, recordingLineIdx: idx } };
}
