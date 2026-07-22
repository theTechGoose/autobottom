/** Validator + salvager for LLM speaker-diarization output — the single source of
 *  truth for "is this string a real diarized transcript, and if not, is a real
 *  transcript hiding inside it?".
 *
 *  Two production incidents shaped this module, and both shapes must stay dead:
 *
 *    1. REFUSAL (report 76UGB0H1yVYu54OHQgGVe) — the model replied "Please share
 *       the audio file…" and, because it *named* the labels, the old
 *       `includes("[AGENT]")` check shipped the refusal as the audit record.
 *    2. COMMENTARY (report 4oL3fw_Coxvzpx7El_qip) — the model replied with a
 *       markdown critique of its own previous attempt ("**Review of the original
 *       transcription**", a `| # | Original line | Issue identified |` table, a
 *       "## Corrected transcription" heading, the real transcript inside a code
 *       fence, then a "### What was changed / added" changelog). It sailed
 *       through every check: it *quotes* the labels dozens of times, contains no
 *       refusal phrasing, and commentary makes it LONGER than the raw transcript.
 *
 *  We can't stop the model from producing either, so we guard the boundaries
 *  (diarize() return, persistence, and every render) and — for commentary — cut
 *  the transcript back out of it.
 *
 *  Pure — string/regex only, zero dependencies, no Deno/Groq/IO. Imported by
 *  both the backend (`@core/...`) and the Fresh frontend (`@core/` → `../src/core/`),
 *  so it MUST stay bundle-safe for Vite. */

/** Speaker labels the diarization prompt mandates. */
const LABEL_RE = /\[(CUSTOMER|AGENT)\]/g;

/** A line that IS a speaker turn: the label leads the line. The `^` anchor is
 *  the whole trick — it excludes markdown table rows (`| 1 | **[CUSTOMER]** All
 *  right. | …`), bullet points, and any other prose that merely *mentions* a
 *  label mid-line. */
const TURN_LINE_RE = /^\s*\[?(?:AGENT|CUSTOMER)\]?\s*:\s*\S/i;

/** Fraction of non-empty lines that must be speaker turns for a string to count
 *  as a transcript. Deliberately below 1.0 — a stray blank-ish artifact line
 *  shouldn't condemn an otherwise clean transcript — but high enough that a
 *  critique (mostly prose) can never clear it. */
const LABELED_LINE_FLOOR = 0.85;

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

/** Markdown/prose STRUCTURE that a transcript never contains. A transcript is
 *  speaker turns and nothing else — no headings, no tables, no fences, no
 *  numbered analysis. Multiline-anchored so they fire anywhere in the body. */
const COMMENTARY_STRUCTURE: RegExp[] = [
  /^[ \t]*#{1,6}\s+\S/m, // "## Corrected transcription"
  /^[ \t]*\|.*\|/m, // "| 1 | **[CUSTOMER]** All right. | … |"
  /\|\s*:?-{3,}/, // table rule "|---|----|"
  /^[ \t]*(?:```|~~~)/m, // code fence
  /^[ \t]*\d+\.\s+\*\*/m, // "1. **Mis-labelled opening line**"
  /^[ \t]*[-*]\s+\*\*/m, // "- **Every [AGENT] line** is a single question"
  /^[ \t]*\*\*[^*\n]+\*\*\s*$/m, // "**Summary of problems**" on its own line
];

/** Phrasings that mean the model is talking ABOUT a transcript rather than
 *  producing one. Same broad-not-tight tradeoff as REFUSAL_PATTERNS: a false
 *  positive costs one audit its speaker labels; a false negative puts model
 *  commentary in front of a reviewer as if it were evidence. */
const COMMENTARY_PHRASES: RegExp[] = [
  /corrected transcription/i,
  /revised (version|transcription)/i,
  /what (was|i) (changed|added)/i,
  /summary of problems/i,
  /review of the (original|transcription)/i,
  /required (transcription )?format/i,
  /issue identified/i,
  /mis-?labell?ed/i,
  /original line/i,
  /below is (a|the)/i,
  /with these (adjustments|changes)/i,
];

/** True if `text` reads like an LLM meta/refusal reply rather than transcript content. */
export function looksLikeRefusal(text: string): boolean {
  return REFUSAL_PATTERNS.some((re) => re.test(text));
}

/** True if `text` contains model commentary — prose/markdown wrapped around (or
 *  instead of) a transcript. The 4oL3fw… incident shape. */
export function looksLikeCommentary(text: string): boolean {
  const s = text ?? "";
  return COMMENTARY_STRUCTURE.some((re) => re.test(s)) ||
    COMMENTARY_PHRASES.some((re) => re.test(s));
}

/** Fraction of non-empty lines that are speaker turns. 0 when there are none. */
export function labeledLineRatio(text: string): number {
  const lines = (text ?? "").split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return 0;
  return lines.filter((l) => TURN_LINE_RE.test(l)).length / lines.length;
}

/** True only when `out` is a real diarized transcript: carries multiple speaker
 *  labels, is (nearly) all speaker turns, is not a refusal or commentary reply,
 *  and hasn't collapsed to a fraction of the source. `raw` is the source
 *  transcript used for the length-ratio check. */
export function isValidDiarizedTranscript(out: string, raw: string): boolean {
  const text = (out ?? "").trim();
  if (!text) return false;
  // A real call has many turns; a refusal mentions a label or two at most.
  const labelCount = (text.match(LABEL_RE) ?? []).length;
  if (labelCount < 2) return false;
  // Kills the production refusal even though it happens to contain labels.
  if (looksLikeRefusal(text)) return false;
  // Kills the production commentary even though it is label-rich and long.
  if (looksLikeCommentary(text)) return false;
  // Structure, not just content: a transcript is speaker turns, end of story.
  if (labeledLineRatio(text) < LABELED_LINE_FLOOR) return false;
  // Diarization reformats; it must not shrink the content to a fraction of the
  // source. A ~200-char refusal vs a multi-KB transcript fails this outright.
  const floor = Math.min(200, (raw ?? "").length);
  if (text.length < floor * 0.5) return false;
  return true;
}

// ── Salvage ──────────────────────────────────────────────────────────────────

/** How a candidate transcript was obtained.
 *  - `clean`    — the model's output was already a transcript; untouched.
 *  - `fenced`   — lifted out of a ``` code fence inside a commentary reply.
 *  - `filtered` — commentary with no fence; non-turn lines were dropped.
 *  - `none`     — nothing salvageable; the caller must use the raw transcript. */
export type DiarizeMethod = "clean" | "fenced" | "filtered" | "none";

export interface DiarizeExtraction {
  text: string;
  method: DiarizeMethod;
  /** Word-overlap measurements vs the raw transcript, for `fenced`/`filtered`
   *  candidates. Surfaced by the Transcript Repair scan so the fidelity floors
   *  below can be tuned against real data instead of guessed at. */
  fidelity?: TranscriptFidelity;
}

export interface TranscriptFidelity {
  /** Share of the candidate's words that actually appear in raw. Low ⇒ the model
   *  INVENTED content (4oL3fw…'s changelog admits providing a customer response
   *  that was never spoken). */
  precision: number;
  /** Share of raw's words that survive into the candidate. Low ⇒ the model
   *  CONDENSED or dropped content (4oL3fw… condensed the fee-explanation block). */
  recall: number;
}

/** Fidelity floors a salvaged candidate must clear before we prefer it over the
 *  raw transcript.
 *
 *  These are the tuning knobs of this module. They are set to accept a
 *  reformat-with-light-rewriting (which is what the "## Corrected transcription"
 *  block is) while still rejecting a block the model largely made up.
 *
 *  Measured against production (1,092 audits scanned 2026-07-21, 3 contaminated):
 *    4oL3fw_Coxvzpx7El_qip  fenced    92% / 59%  → salvaged (model condensed heavily)
 *    U8aKDyl9L4uiql2z3Bagr  filtered 100% / 80%  → salvaged cleanly
 *    4caMNdxRVrnTHt0pD9Ync  —                    → rejected: a how-to essay whose
 *                                                  example fence was a fabricated
 *                                                  conversation. THIS is why the
 *                                                  gate exists; structure alone
 *                                                  would have stored the invention.
 *
 *  So the real margin on recall is ~4 points. If a future scan shows genuine
 *  salvages falling to raw, move these — and pin the new behavior with a fixture
 *  test. Do NOT loosen them blind: below these floors the "transcript" stops
 *  being a record of what was said, which is the entire point of the artifact.
 *  A false reject costs one audit its speaker labels; a false accept puts words
 *  in a guest's mouth in a compliance record. */
const FIDELITY_PRECISION_FLOOR = 0.75;
const FIDELITY_RECALL_FLOOR = 0.55;

/** Strip speaker labels and punctuation → lowercase word list. Labels are
 *  removed from both sides so a labeled candidate isn't penalized against an
 *  unlabeled raw transcript. */
function contentWords(s: string): string[] {
  return (s ?? "")
    .replace(/\[?\b(?:AGENT|CUSTOMER|TEAM MEMBER|GUEST)\b\]?\s*:?/gi, " ")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function multiset(words: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const w of words) m.set(w, (m.get(w) ?? 0) + 1);
  return m;
}

/** Bidirectional word overlap between a candidate transcript and the raw one.
 *  Precision catches fabrication, recall catches condensation — a diarization
 *  pass is supposed to RE-LABEL the words, not rewrite them. */
export function transcriptFidelity(candidate: string, raw: string): TranscriptFidelity {
  const a = contentWords(candidate);
  const b = contentWords(raw);
  if (a.length === 0 || b.length === 0) return { precision: 0, recall: 0 };
  const bm = multiset(b);
  const am = multiset(a);
  let overlap = 0;
  for (const [w, n] of am) overlap += Math.min(n, bm.get(w) ?? 0);
  return { precision: overlap / a.length, recall: overlap / b.length };
}

/** All ```/~~~ fenced blocks, longest first.
 *
 *  Split on fence-delimiter LINES rather than matching open/close pairs with a
 *  lazy regex: `$` under the `m` flag means end-of-LINE, so the obvious
 *  `/```\n([\s\S]*?)(?:```|$)/gm` terminates on the first newline and returns
 *  nothing. Splitting also handles a truncated reply whose closing fence never
 *  arrived — the trailing segment is still captured. */
function fencedBlocks(text: string): string[] {
  const parts = (text ?? "").split(/^[ \t]*(?:```|~~~)[^\n]*$/m);
  // parts[0] is before the first fence; odd indices are fence interiors.
  const out: string[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const body = (parts[i] ?? "").trim();
    if (body) out.push(body);
  }
  return out.sort((a, b) => b.length - a.length);
}

/** Drop every line that isn't a speaker turn. This is what removes the critique
 *  table, the headings, and the changelog when there's no fence to lift from. */
function keepTurnLines(text: string): string {
  return (text ?? "")
    .split(/\r?\n/)
    .filter((l) => TURN_LINE_RE.test(l))
    .join("\n")
    .trim();
}

/** A salvaged candidate is only accepted if it is a valid transcript in its own
 *  right AND is faithful to what was actually said. */
function accept(candidate: string, raw: string): TranscriptFidelity | null {
  if (!candidate) return null;
  if (!isValidDiarizedTranscript(candidate, raw)) return null;
  const fidelity = transcriptFidelity(candidate, raw);
  if (fidelity.precision < FIDELITY_PRECISION_FLOOR) return null;
  if (fidelity.recall < FIDELITY_RECALL_FLOOR) return null;
  return fidelity;
}

/** Turn whatever the diarization model returned into something safe to store and
 *  show a human. Never throws, never returns commentary; falls back to `raw`.
 *
 *  Order matters: the `clean` early-exit means healthy audits (the overwhelming
 *  majority) take one cheap validation pass and are returned untouched — this
 *  function is safe to call on every render. */
export function extractDiarizedTranscript(out: string, raw: string): DiarizeExtraction {
  const text = (out ?? "").trim();
  const fallback = raw ?? "";
  if (!text) return { text: fallback, method: "none" };

  // 1. Already a transcript.
  if (isValidDiarizedTranscript(text, raw)) return { text, method: "clean" };

  // NOTE: we deliberately do NOT short-circuit on looksLikeRefusal here. Every
  // candidate below is fully re-validated by accept() — which runs the refusal
  // check on the candidate itself — so bailing early would only lose salvage on
  // a reply that mixes a refusal-ish phrase with a real fenced transcript.

  // 2. Lift the transcript out of the code fence the commentary wrapped it in.
  for (const block of fencedBlocks(text)) {
    const fidelity = accept(block, raw);
    if (fidelity) return { text: block, method: "fenced", fidelity };
  }

  // 3. No usable fence — keep the speaker turns, drop everything else.
  const filtered = keepTurnLines(text);
  const fidelity = accept(filtered, raw);
  if (fidelity) return { text: filtered, method: "filtered", fidelity };

  return { text: fallback, method: "none" };
}

/** Read-side chokepoint: the text that is safe to render for a given stored
 *  transcript. Every surface that shows a transcript to a human goes through
 *  this — the report, both queues, the manager remediation view, the evidence
 *  excerpt, and the question lab. */
export function safeDiarized(diarized: string | undefined, raw: string | undefined): string {
  return extractDiarizedTranscript(diarized ?? "", raw ?? "").text;
}
