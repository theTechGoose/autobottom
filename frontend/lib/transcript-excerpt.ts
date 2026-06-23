/** Focused, speaker-split "Transcript Context" excerpts for the audit report.
 *
 *  WHY THIS EXISTS — the brick-wall bug:
 *  step-ask-all stores `answeredQuestion.snippet` = the RAW context the bot
 *  graded against. For short calls (≤8000 chars) that context is the ENTIRE raw
 *  transcript, and the raw transcript is AssemblyAI's `${role}: ${text}` output.
 *  When AssemblyAI fails to separate speakers, `identifyRoles` collapses the
 *  whole call into ONE `[AGENT]:` utterance — a single un-segmented line. Render
 *  that snippet verbatim and you get the "giant brick wall of text" under each
 *  question. Meanwhile Groq's async `diarize` step produces a properly
 *  speaker-split transcript (what the top "Transcript" section shows), but the
 *  per-question snippet was never upgraded to use it.
 *
 *  THE FIX (render-time, retroactive for every existing finding):
 *  rebuild the per-question context from the diarized transcript, focused to the
 *  turns relevant to the bot's `defense` quote, falling back gracefully when the
 *  diarized transcript or a confident match isn't available. No grading-pipeline
 *  change — the bot still grades against the raw transcript; only the display of
 *  the supporting context changes. */

export type Speaker = "team" | "guest" | null;

export interface ExcerptTurn {
  speaker: Speaker;
  text: string;
}

export type ExcerptSegment =
  | { kind: "turn"; speaker: Speaker; text: string }
  | { kind: "gap" };

export interface FocusedExcerpt {
  /** Ordered render list. A `gap` marks elided turns between two windows. */
  segments: ExcerptSegment[];
  /** True when only the relevant subset of turns is shown (some elided). */
  focused: boolean;
  /** Plain text of the rendered turns — drives the Copy button + assertions. */
  text: string;
  /** True when no transcript text was available at all (caller hides the block). */
  empty: boolean;
}

// Leading speaker tag on a diarized/raw line. Two accepted forms ONLY, so a
// word that merely STARTS with a role name ("Agentina", "Customers love…")
// is never mistaken for a tag:
//   1. bracketed:   `[AGENT]`, `[ AGENT ]`, optionally followed by `:`/`-`
//   2. bare + delim: `AGENT:`, `TEAM MEMBER -` (a colon/dash is required)
const TEAM_TAG = /^(?:\[\s*(?:AGENT|TEAM MEMBER)\s*\]\s*[:\-]?|(?:AGENT|TEAM MEMBER)\s*[:\-])\s*/i;
const GUEST_TAG = /^(?:\[\s*(?:CUSTOMER|GUEST)\s*\]\s*[:\-]?|(?:CUSTOMER|GUEST)\s*[:\-])\s*/i;
// A line that is purely a separator (compound-question snippets are joined with
// `\n---\n`) — never a real turn.
const SEPARATOR_LINE = /^[-–—_=*]{2,}$/;

/** Split a transcript into speaker turns. Drops blank lines and separator rules,
 *  and suppresses consecutive exact-duplicate lines (prod parity with
 *  TranscriptPanel). */
export function parseTranscriptTurns(text: string): ExcerptTurn[] {
  const turns: ExcerptTurn[] = [];
  let last = "";
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line === last || SEPARATOR_LINE.test(line)) continue;
    last = line;
    if (TEAM_TAG.test(line)) {
      turns.push({ speaker: "team", text: line.replace(TEAM_TAG, "").trim() });
    } else if (GUEST_TAG.test(line)) {
      turns.push({ speaker: "guest", text: line.replace(GUEST_TAG, "").trim() });
    } else {
      turns.push({ speaker: null, text: line });
    }
  }
  return turns;
}

// Tokens we never let anchor a transcript match. Two distinct intents — kept
// in separate lists so future tuning is obvious (e.g. "state" lives in the
// defense-prose group, so if a guest literally names a US state you know where
// to look). DF weighting handles call-SPECIFIC recurring words (names, scripted
// phrases) per-transcript; these two static lists handle what DF structurally
// can't anticipate.

// (1) Generic high-frequency English — would scatter hits across every turn.
const ENGLISH_STOP = [
  "the", "and", "that", "this", "with", "your", "you", "have", "has", "had",
  "was", "were", "are", "for", "not", "but", "they", "them", "from", "what",
  "when", "will", "would", "could", "should", "about", "there", "their",
  "into", "just", "like", "also", "been", "being", "does", "did", "done",
  "which", "while", "then", "than", "over", "only", "very", "more", "most",
  "some", "such", "any", "all", "one", "two", "get", "got", "out", "off",
  "per", "its", "his", "her", "our", "who", "whom", "how", "why", "yes",
  "without", "during", "point",
];

// (2) LLM-defense PROSE vocabulary — appears in the bot's reasoning but should
// never anchor a transcript match (often near-zero document frequency, so DF
// weighting would otherwise let a stray occurrence anchor a false hit).
const DEFENSE_PROSE_STOP = [
  "said", "says", "say", "tell", "told", "ask", "asked", "asks", "answer",
  "answers", "question", "questions", "transcript", "transcription", "team",
  "member", "guest", "agent", "customer", "mention", "mentions", "mentioned",
  "state", "states", "stated", "because", "directly", "relevant", "criteria",
  "meeting", "therefore", "quote", "quoted", "quoting", "excerpt", "excerpts",
  "reasoning", "defense", "reads", "read", "provided", "provide", "provides",
  "support", "supports", "claim", "claims", "conversation", "call", "occurred",
];

const STOPWORDS = new Set([...ENGLISH_STOP, ...DEFENSE_PROSE_STOP]);

/** Pull distinctive content tokens out of a defense string. Quoted spans are
 *  the verbatim transcript excerpts the bot cited, so prefer them; fall back to
 *  the whole defense when nothing is quoted. */
export function extractDefenseTokens(defense: string): string[] {
  if (!defense) return [];
  const quoted: string[] = [];
  // Straight and smart quotes, ≥6 chars between marks to skip stray apostrophes.
  // The smart-quote class excludes the OPENING marks too (`“‘`), not just the
  // closing ones — otherwise a run of opening quotes triggers O(n²) backtracking.
  const quoteRe = /[“‘]([^“‘”’]{6,})[”’]|"([^"]{6,})"|'([^']{6,})'/g;
  let m: RegExpExecArray | null;
  while ((m = quoteRe.exec(defense)) !== null) {
    quoted.push(m[1] ?? m[2] ?? m[3] ?? "");
  }
  const basis = quoted.length ? quoted.join(" ") : defense;
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const w of basis.toLowerCase().replace(/[^a-z0-9$]+/g, " ").split(/\s+/)) {
    if (w.length < 4 || STOPWORDS.has(w) || seen.has(w)) continue;
    seen.add(w);
    tokens.push(w);
    if (tokens.length >= 60) break;
  }
  return tokens;
}

// Pad with spaces so includes(" token ") is a whole-word match.
function normalize(s: string): string {
  return ` ${s.toLowerCase().replace(/[^a-z0-9$]+/g, " ")} `;
}

function scoreTurn(turnNorm: string, tokens: string[]): number {
  let score = 0;
  for (const t of tokens) if (turnNorm.includes(` ${t} `)) score++;
  return score;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Character-window focus for a single un-segmented brick (used only when no
 *  diarized transcript exists yet and the raw transcript is one line). Locates
 *  the match by a case-insensitive search on the ORIGINAL string, so the slice
 *  indices can never desync from a length-changing toLowerCase(). */
function charWindow(block: string, tokens: string[], radius: number): string {
  let bestStart = -1;
  for (const t of tokens) {
    const m = new RegExp(escapeRegExp(t), "i").exec(block);
    if (m && (bestStart < 0 || m.index < bestStart)) bestStart = m.index;
  }
  if (bestStart < 0) return "";
  const start = Math.max(0, bestStart - radius);
  const end = Math.min(block.length, bestStart + radius);
  let slice = block.slice(start, end).trim();
  if (start > 0) slice = "… " + slice;
  if (end < block.length) slice = slice + " …";
  return slice;
}

/** Speaker prefix for the plain-text / copy representation of a turn. */
function turnText(speaker: Speaker, text: string): string {
  const label = speaker === "team" ? "[TEAM MEMBER] " : speaker === "guest" ? "[GUEST] " : "";
  return label + text;
}

/** Whole, speaker-split transcript — the honest fallback when we can't (or
 *  shouldn't) narrow. Readable, never a brick. */
function fullExcerpt(turns: ExcerptTurn[]): FocusedExcerpt {
  return {
    segments: turns.map((t) => ({ kind: "turn" as const, speaker: t.speaker, text: t.text })),
    focused: false,
    text: turns.map((t) => turnText(t.speaker, t.text)).join("\n"),
    empty: false,
  };
}

// A token appearing in more than this fraction of turns isn't distinctive
// enough to anchor a focused window (e.g. a guest name, "married", "confirm"
// that recurs all call) — drop it so it can't balloon the excerpt.
const MAX_DOC_FREQ = 0.5;
// If the focused window would cover this fraction of the call — or fragment it
// into more than this many windows — narrowing is pointless/noisy; show the
// full transcript instead (honestly un-narrowed) rather than a misleading
// "relevant excerpt" that's most of the call.
const MAX_COVERAGE = 0.6;
const MAX_WINDOWS = 4;

/** Build the focused excerpt for one graded question.
 *
 *  SOURCE preference: a speaker-labeled transcript (diarized, else raw) →
 *  otherwise the first non-empty of diarized/raw/snippet (so a snippet-only
 *  finding — e.g. one persisted before diarize ran — still renders).
 *
 *  OUTPUT precedence, in the order tried (mirrors the test cases):
 *    1. multi-turn source + a confident defense-token match → focused window
 *       (hit turns ± contextTurns, merged), unless it's too broad/fragmented;
 *    2. multi-turn source, no confident match (or over-broad) → fullExcerpt
 *       (the whole speaker-split transcript — readable, never a brick);
 *    3. single-line brick + defense tokens → charWindow (a slice around the
 *       match, with … elision);
 *    4. single-line brick, no tokens → that whole block as one turn;
 *    5. no source at all → { empty: true } (caller hides the block). */
export function buildFocusedExcerpt(opts: {
  diarized?: string;
  raw?: string;
  snippet?: string;
  defense?: string;
  contextTurns?: number;
  maxCharWindow?: number;
}): FocusedExcerpt {
  const contextTurns = opts.contextTurns ?? 1;
  const diarized = (opts.diarized ?? "").trim();
  const raw = (opts.raw ?? "").trim();
  const snippet = (opts.snippet ?? "").trim();
  const defense = (opts.defense ?? "").trim();

  const hasLabels = (s: string) => /\[(?:AGENT|CUSTOMER|TEAM MEMBER|GUEST)\b/i.test(s);
  // Prefer a properly speaker-split source. A non-empty diarized transcript that
  // somehow lost its labels shouldn't beat a labeled raw transcript.
  const source =
    (diarized && hasLabels(diarized) && diarized) ||
    (raw && hasLabels(raw) && raw) ||
    diarized || raw || snippet;
  if (!source) return { segments: [], focused: false, text: "", empty: true };

  const turns = parseTranscriptTurns(source);
  const tokens = extractDefenseTokens(defense);

  // Degenerate source: a single un-segmented brick (AssemblyAI didn't split
  // speakers AND no diarized transcript yet). No turns to focus across, so
  // window on characters around the defense match instead.
  if (turns.length <= 1) {
    const block = turns[0]?.text ?? source;
    const speaker = turns[0]?.speaker ?? null;
    if (tokens.length) {
      const windowed = charWindow(block, tokens, opts.maxCharWindow ?? 700);
      if (windowed && windowed.length < block.length) {
        return { segments: [{ kind: "turn", speaker, text: windowed }], focused: true, text: turnText(speaker, windowed), empty: false };
      }
    }
    return { segments: [{ kind: "turn", speaker, text: block }], focused: false, text: turnText(speaker, block), empty: false };
  }

  // Drop tokens that aren't distinctive (present in too many turns). Without
  // this, a recurring word ("married", "confirm", a guest name) hits most turns
  // and the "focused" excerpt balloons to ~the whole call.
  const turnNorms = turns.map((t) => normalize(t.text));
  // A token is "non-distinctive" only if it recurs in more than half the turns
  // AND in ≥3 turns absolute — otherwise on a 3-5 turn call a token appearing
  // twice would be wrongly dropped, leaving nothing to focus on.
  const dfCap = Math.max(2, Math.floor(turns.length * MAX_DOC_FREQ));
  const distinctive = tokens.filter((t) => {
    let df = 0;
    for (const tn of turnNorms) if (tn.includes(` ${t} `)) df++;
    return df > 0 && df <= dfCap;
  });

  if (!distinctive.length) return fullExcerpt(turns);

  // A turn is a hit when it carries enough distinctive tokens. Require 2 when
  // we have ≥3 to resist a single common word; allow 1 for sparse defenses.
  const threshold = distinctive.length >= 3 ? 2 : 1;
  let hits = turnNorms.flatMap((tn, i) => (scoreTurn(tn, distinctive) >= threshold ? [i] : []));

  // Clause-split fallback: diarization can split one quoted utterance across
  // adjacent turns so no single turn clears the threshold. Before giving up,
  // slide a 2-turn window and accept pairs that jointly clear it.
  if (!hits.length) {
    const paired = new Set<number>();
    for (let i = 0; i < turns.length - 1; i++) {
      if (scoreTurn(normalize(turns[i].text + " " + turns[i + 1].text), distinctive) >= threshold) {
        paired.add(i);
        paired.add(i + 1);
      }
    }
    hits = [...paired].sort((a, b) => a - b);
  }

  // No confident match → full speaker-split transcript (readable, not a brick).
  if (!hits.length) return fullExcerpt(turns);

  // Expand each hit by `contextTurns` and merge overlapping/adjacent windows
  // (a 1-turn gap isn't worth an ellipsis, so merge when gap ≤ 1).
  const windows: Array<[number, number]> = hits.map((i) => [
    Math.max(0, i - contextTurns),
    Math.min(turns.length - 1, i + contextTurns),
  ]);
  windows.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const w of windows) {
    const last = merged[merged.length - 1];
    if (last && w[0] <= last[1] + 1) last[1] = Math.max(last[1], w[1]);
    else merged.push([w[0], w[1]]);
  }

  const coveredTurns = merged.reduce((sum, [s, e]) => sum + (e - s + 1), 0);
  // Too broad or too fragmented → narrowing is misleading/noisy. Show full.
  // The coverage cap only applies once there are enough turns for "most of the
  // call" to be meaningful — on a ≤6-turn call a 3-turn window is a legitimate
  // focus, not a balloon (and short calls are exactly this bug's domain).
  const tooBroad = turns.length > 6 && coveredTurns >= turns.length * MAX_COVERAGE;
  if (tooBroad || merged.length > MAX_WINDOWS) {
    return fullExcerpt(turns);
  }

  const segments: ExcerptSegment[] = [];
  const textParts: string[] = [];
  merged.forEach(([s, e], wi) => {
    if (wi > 0) segments.push({ kind: "gap" });
    for (let i = s; i <= e; i++) {
      segments.push({ kind: "turn", speaker: turns[i].speaker, text: turns[i].text });
      textParts.push(turnText(turns[i].speaker, turns[i].text));
    }
  });

  return { segments, focused: true, text: textParts.join("\n"), empty: false };
}
