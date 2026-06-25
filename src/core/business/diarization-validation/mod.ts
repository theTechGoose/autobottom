/** Validator for LLM speaker-diarization output — the single source of truth for
 *  "is this string a real diarized transcript?". The diarize() pass occasionally
 *  returns a meta/refusal reply instead of labeled transcript content; we can't
 *  stop the model from producing it, so we guard the boundaries (diarize() return,
 *  persistence, render). See report 76UGB0H1yVYu54OHQgGVe for the incident.
 *
 *  Pure — string/regex only, zero dependencies, no Deno/Groq/IO. Imported by
 *  both the backend (`@core/...`) and the Fresh frontend (`@core/` → `../src/core/`),
 *  so it MUST stay bundle-safe for Vite. */

/** Speaker labels the diarization prompt mandates. */
const LABEL_RE = /\[(CUSTOMER|AGENT)\]/g;

/** Meta/refusal phrasings an LLM emits when it thinks it has no content to work
 *  on. Kept deliberately broad — a false "refusal" verdict only costs us the
 *  speaker labels (we fall back to the readable raw transcript), so over-
 *  rejecting is far cheaper than letting a refusal through.
 *
 *  To add a pattern: append a case-insensitive RegExp matching a meta/refusal
 *  phrasing. Err broad and do NOT anchor to line-start — a false positive only
 *  downgrades that one call to the raw transcript, but a false negative ships a
 *  refusal as the audit record (the 76UGB0… bug). Note these match content, not
 *  structure, so a genuine "please provide your email" turn is intentionally
 *  rejected — see the "do not tighten" test in test.ts. */
const REFUSAL_PATTERNS: RegExp[] = [
  /please (share|provide|paste|send|supply)/i,
  /(share|provide|paste|upload) (the|your)?\s*(audio|file|transcript|conversation|raw text)/i,
  /raw text of the conversation/i,
  /i('|’)?(ll| will) (return|provide|transcribe|format)/i,
  /i('|’)?m (unable|sorry|happy to|ready)/i,
  /once you (share|provide|paste|send)/i,
];

/** True if `text` reads like an LLM meta/refusal reply rather than transcript content. */
export function looksLikeRefusal(text: string): boolean {
  return REFUSAL_PATTERNS.some((re) => re.test(text));
}

/** True only when `out` is a real diarized transcript: carries multiple speaker
 *  labels, is not a refusal/meta reply, and hasn't collapsed to a fraction of
 *  the source. `raw` is the source transcript used for the length-ratio check. */
export function isValidDiarizedTranscript(out: string, raw: string): boolean {
  const text = (out ?? "").trim();
  if (!text) return false;
  // A real call has many turns; a refusal mentions a label or two at most.
  const labelCount = (text.match(LABEL_RE) ?? []).length;
  if (labelCount < 2) return false;
  // Kills the production refusal even though it happens to contain labels.
  if (looksLikeRefusal(text)) return false;
  // Diarization reformats; it must not shrink the content to a fraction of the
  // source. A ~200-char refusal vs a multi-KB transcript fails this outright.
  const floor = Math.min(200, (raw ?? "").length);
  if (text.length < floor * 0.5) return false;
  return true;
}
