import { assert, assertEquals } from "@std/assert";
import {
  buildFocusedExcerpt,
  extractDefenseTokens,
  parseTranscriptTurns,
} from "../../lib/transcript-excerpt.ts";

// A realistic diarized transcript: speaker-split, the bug's defense quote lives
// in one [AGENT] turn near the end. The early turns are far from it.
const DIARIZED = [
  "[AGENT]: All righty, I'm back. So my name is Matthew. We'll be doing your verification now.",
  "[CUSTOMER]: That's correct.",
  "[AGENT]: Wonderful. 903-421-1348. And that is a cell phone. Is that accurate, Bobby?",
  "[CUSTOMER]: Correct.",
  "[AGENT]: The price you agree to pay for this heavily discounted promotion is just $1,800. Is that correct?",
  "[CUSTOMER]: Correct.",
  "[AGENT]: As a reminder, the tax on your own resolves any resort fees. Refundable deposits are due when you set your dates.",
  "[CUSTOMER]: Okay.",
  "[AGENT]: We do abide by all state and federal laws. Welcome aboard.",
].join("\n");

// The brick: AssemblyAI failed to separate speakers, so the whole call is one
// un-segmented [AGENT] line. This is what gets stored as the raw snippet. Padded
// well past the default char-window radius (700) on both sides so a focused
// window is strictly shorter than the whole brick. Filler carries no defense
// tokens so the match anchors on the real phrase.
const FILLER = "and so on with more pleasantries ".repeat(40); // ~1300 chars
const BRICK =
  `[AGENT]: All righty, I'm back. 903-421-1348. ${FILLER} As a reminder, the tax on your own resolves any resort fees. Refundable deposits are due when you set your dates. ${FILLER} Welcome aboard.`;

const DEFENSE = '"As a reminder, the tax on your own resolves any resort fees."';

Deno.test("parseTranscriptTurns — labels, dedup, blank-line drop", () => {
  const turns = parseTranscriptTurns("[AGENT]: hi there\n[CUSTOMER]: hello\n\n[CUSTOMER]: hello\nplain line");
  assertEquals(turns, [
    { speaker: "team", text: "hi there" },
    { speaker: "guest", text: "hello" },
    // consecutive exact-duplicate "hello" suppressed; blank dropped
    { speaker: null, text: "plain line" },
  ]);
});

Deno.test("parseTranscriptTurns — tolerates colon-less and bare tags", () => {
  const turns = parseTranscriptTurns("[AGENT] hi\n[TEAM MEMBER]: yo\nCUSTOMER: hey\n[GUEST] sup");
  assertEquals(turns.map((t) => t.speaker), ["team", "team", "guest", "guest"]);
  assertEquals(turns.map((t) => t.text), ["hi", "yo", "hey", "sup"]);
});

Deno.test("extractDefenseTokens — prefers quoted span, drops stopwords/short", () => {
  const tokens = extractDefenseTokens(DEFENSE);
  assert(tokens.includes("reminder"));
  assert(tokens.includes("resolves"));
  assert(tokens.includes("resort"));
  assert(tokens.includes("fees"));
  assert(!tokens.includes("the"), "stopword leaked");
  assert(!tokens.includes("tax"), "<4 char token leaked"); // 3 chars
  assert(!tokens.includes("your"), "stopword leaked");
});

Deno.test("extractDefenseTokens — empty / no-op defenses yield no tokens", () => {
  assertEquals(extractDefenseTokens(""), []);
  assertEquals(extractDefenseTokens("N/A"), []);
  // Pure prose with only stopwords/short words
  assertEquals(extractDefenseTokens("the and you are not"), []);
});

Deno.test("buildFocusedExcerpt — diarized + defense → focused window around the match", () => {
  const ex = buildFocusedExcerpt({ diarized: DIARIZED, raw: BRICK, snippet: BRICK, defense: DEFENSE });
  assert(!ex.empty);
  assert(ex.focused, "expected a narrowed excerpt");
  assert(ex.text.includes("resolves any resort fees"), "must contain the matched turn");
  // Context window (±1) includes the immediately-adjacent turns…
  assert(ex.text.includes("Refundable deposits") || ex.text.includes("Okay."));
  // …but NOT the far-away opening turns.
  assert(!ex.text.includes("All righty"), "should not include far turns");
  assert(!ex.text.includes("903-421-1348"), "should not include far turns");
  // Segments are speaker-split turns, never one brick.
  assert(ex.segments.every((s) => s.kind === "gap" || s.kind === "turn"));
  assert(ex.segments.some((s) => s.kind === "turn" && s.speaker === "team"));
});

Deno.test("buildFocusedExcerpt — prefers diarized over a raw brick", () => {
  const ex = buildFocusedExcerpt({ diarized: DIARIZED, raw: BRICK, snippet: BRICK, defense: DEFENSE });
  // Diarized has many turns; if it had fallen back to the 1-line brick it would
  // be a single segment.
  const turnCount = ex.segments.filter((s) => s.kind === "turn").length;
  assert(turnCount >= 2, `expected multiple turns, got ${turnCount}`);
});

Deno.test("buildFocusedExcerpt — no confident match → full transcript, not focused", () => {
  const ex = buildFocusedExcerpt({ diarized: DIARIZED, defense: '"totally unrelated phrasing xyzzy plugh"' });
  assert(!ex.focused, "no match should not narrow");
  assert(ex.text.includes("All righty"), "full transcript shown");
  assert(ex.text.includes("Welcome aboard"));
});

Deno.test("buildFocusedExcerpt — empty defense → full transcript, not focused", () => {
  const ex = buildFocusedExcerpt({ diarized: DIARIZED, defense: "" });
  assert(!ex.focused);
  assert(ex.text.includes("All righty"));
  assert(ex.text.includes("Welcome aboard"));
});

Deno.test("buildFocusedExcerpt — brick + no diarized → char-window focus, not whole brick", () => {
  const ex = buildFocusedExcerpt({ raw: BRICK, snippet: BRICK, defense: DEFENSE });
  assert(!ex.empty);
  assert(ex.focused, "char-window should narrow the brick");
  assert(ex.text.includes("resolves any resort fees"));
  assert(ex.text.length < BRICK.length, "must be shorter than the full brick");
  assert(ex.text.includes("…"), "elision marker expected");
});

Deno.test("buildFocusedExcerpt — brick + no diarized + no defense → whole block, not focused", () => {
  const ex = buildFocusedExcerpt({ raw: BRICK, snippet: BRICK, defense: "" });
  assert(!ex.focused);
  assert(ex.segments.length === 1 && ex.segments[0].kind === "turn");
});

Deno.test("buildFocusedExcerpt — no source at all → empty", () => {
  const ex = buildFocusedExcerpt({ defense: DEFENSE });
  assert(ex.empty);
  assertEquals(ex.segments, []);
});

Deno.test("parseTranscriptTurns — words starting with a role name are NOT mistaken for tags", () => {
  const turns = parseTranscriptTurns(
    "Agentina booked the trip\nCustomers love the deal\nGuesthouse rates apply\nAgent disclosed the fees",
  );
  // None of these have a bracket or a delimiter after the role word → all plain.
  assertEquals(turns.map((t) => t.speaker), [null, null, null, null]);
  assertEquals(turns[0].text, "Agentina booked the trip"); // first word intact
  assertEquals(turns[3].text, "Agent disclosed the fees");
});

Deno.test("parseTranscriptTurns — bare role with a delimiter still parses", () => {
  const turns = parseTranscriptTurns("AGENT: hello there\nCUSTOMER - hi back");
  assertEquals(turns.map((t) => t.speaker), ["team", "guest"]);
  assertEquals(turns.map((t) => t.text), ["hello there", "hi back"]);
});

Deno.test("parseTranscriptTurns — compound-snippet separator lines are dropped", () => {
  const turns = parseTranscriptTurns("[AGENT]: part one\n---\n[CUSTOMER]: part two\n===");
  assertEquals(turns.length, 2);
  assert(!turns.some((t) => /^[-=]+$/.test(t.text)), "separator must not become a turn");
});

Deno.test("buildFocusedExcerpt — recurring (non-distinctive) tokens don't balloon the excerpt", () => {
  // "married"/"spouse"/"bobby" recur across a scripted verification call.
  const diarized = Array.from({ length: 12 }, (_, i) =>
    i === 5
      ? "[AGENT]: Bobby, are you and your spouse married? Marital status married confirmed."
      : `[AGENT]: Bobby and the married spouse chat, turn ${i} married spouse filler`).join("\n");
  const ex = buildFocusedExcerpt({ diarized, defense: '"are you and your spouse married"' });
  // Every token recurs in >50% of turns → all dropped → honest full transcript,
  // never a "focused" excerpt that is actually most of the call.
  assert(!ex.focused, "ubiquitous tokens must not produce a fake-focused balloon");
});

Deno.test("buildFocusedExcerpt — over-broad coverage falls back to full (not a misleading excerpt)", () => {
  // A distinctive token salted into most turns → would cover the whole call.
  const diarized = Array.from({ length: 10 }, (_, i) =>
    `[AGENT]: turn ${i} mentions the xyzzytoken here`).join("\n");
  const ex = buildFocusedExcerpt({ diarized, defense: '"xyzzytoken disclosure"' });
  assert(!ex.focused, "coverage cap should prevent a near-full 'focused' excerpt");
});

Deno.test("buildFocusedExcerpt — clause-split quote across adjacent turns still focuses", () => {
  const diarized = [
    "[AGENT]: opening",
    "[CUSTOMER]: ok",
    "[AGENT]: The taxes",
    "[AGENT]: on your unit resolves",
    "[AGENT]: any resort fees today",
    "[CUSTOMER]: understood",
    "[AGENT]: moving on to the next topic entirely",
    "[CUSTOMER]: sure",
  ].join("\n");
  // The quote is split one-clause-per-turn; no single turn clears threshold 2.
  const ex = buildFocusedExcerpt({ diarized, defense: '"the taxes on your unit resolves any resort fees"', contextTurns: 0 });
  assert(ex.focused, "2-turn sliding fallback should still narrow");
  assert(ex.text.includes("resort fees"));
  assert(!ex.text.includes("opening"), "far turn excluded");
});

Deno.test("buildFocusedExcerpt — short (≤6-turn) call still narrows with default contextTurns", () => {
  // The bug's domain is short calls. A 5-turn diarized call with a single
  // disclosure turn must focus (window of 3), not dump to full via the cap.
  const diarized = [
    "[AGENT]: Hi, verifying your booking today.",
    "[CUSTOMER]: Sounds good.",
    "[AGENT]: Resort fees are extra and collected at check-in by the property.",
    "[CUSTOMER]: Understood.",
    "[AGENT]: Great, you're all set. Welcome aboard.",
  ].join("\n");
  const ex = buildFocusedExcerpt({ diarized, defense: '"resort fees are extra and collected at check-in"' });
  assert(ex.focused, "5-turn call should narrow, not dump to full");
  assert(ex.text.includes("Resort fees are extra"));
  assert(!ex.text.includes("Welcome aboard"), "tail turn elided");
});

Deno.test("buildFocusedExcerpt — short call keeps a token that recurs twice (DF floor)", () => {
  // 3-turn call, sole distinctive token "refunds" in 2 of 3 turns: must NOT be
  // dropped as 'non-distinctive' — it's the only evidence anchor.
  const diarized = [
    "[AGENT]: There are absolutely no refunds on this package.",
    "[CUSTOMER]: Okay, understood.",
    "[AGENT]: Just confirming the no refunds policy once more.",
  ].join("\n");
  const ex = buildFocusedExcerpt({ diarized, defense: '"no refunds on this package"', contextTurns: 0 });
  assert(ex.focused || ex.text.includes("refunds"), "token recurring twice in a 3-turn call must survive");
  assert(ex.text.includes("refunds"));
});

Deno.test("extractDefenseTokens — pathological smart-quote run stays fast (no ReDoS)", () => {
  const evil = "“".repeat(40000);
  const start = performance.now();
  const tokens = extractDefenseTokens(evil);
  const elapsed = performance.now() - start;
  assert(elapsed < 250, `expected <250ms, took ${elapsed.toFixed(0)}ms`);
  // No 6+ char span ever closes → no tokens. A regression to the backtracking
  // regex would blow the time bound (or hang) before reaching this assert.
  assertEquals(tokens, []);
});

Deno.test("buildFocusedExcerpt — snippet-only source (no raw, no diarized) still renders", () => {
  // A finding persisted before diarize ran, or one whose rawTranscript wasn't
  // stored but the graded snippet was. Contract: snippet is the last-resort
  // source — "snippet present ⇒ something renders", never empty.
  const ex = buildFocusedExcerpt({ snippet: BRICK, defense: DEFENSE });
  assert(!ex.empty, "snippet must be used as a fallback source");
  assert(ex.text.includes("resolves any resort fees"), "snippet content must reach the output");
  assert(ex.focused, "single-line snippet brick narrows via char-window");
});

Deno.test("buildFocusedExcerpt — snippet-only source, no defense → whole block, not empty", () => {
  const ex = buildFocusedExcerpt({ snippet: BRICK, defense: "" });
  assert(!ex.empty);
  assert(ex.segments.length === 1 && ex.segments[0].kind === "turn");
});

Deno.test("buildFocusedExcerpt — focused text carries speaker labels for clean copy", () => {
  const ex = buildFocusedExcerpt({ diarized: DIARIZED, raw: BRICK, snippet: BRICK, defense: DEFENSE });
  assert(ex.text.includes("[TEAM MEMBER]") || ex.text.includes("[GUEST]"), "copy text should be speaker-labeled");
  assert(!ex.text.includes("⋯"), "gap marker must never leak into copy text");
});

Deno.test("buildFocusedExcerpt — two distant matches → two windows with a gap", () => {
  const diarized = [
    "[AGENT]: opening pleasantries here",
    "[CUSTOMER]: ok",
    "[AGENT]: filler one",
    "[CUSTOMER]: filler two",
    "[AGENT]: the cancellation policy has no refunds whatsoever",
    "[CUSTOMER]: filler three",
    "[AGENT]: more filler padding text",
    "[CUSTOMER]: filler four",
    "[AGENT]: your confirmation number is 5772699 final",
    "[CUSTOMER]: got it",
  ].join("\n");
  // Two quoted regions, far apart in the transcript.
  const defense = '"cancellation policy has no refunds" and "confirmation number is 5772699"';
  const ex = buildFocusedExcerpt({ diarized, defense, contextTurns: 0 });
  assert(ex.focused);
  const gaps = ex.segments.filter((s) => s.kind === "gap").length;
  assertEquals(gaps, 1, "two distant windows separated by exactly one gap");
  assert(ex.text.includes("cancellation policy"));
  assert(ex.text.includes("confirmation number"));
  assert(!ex.text.includes("opening pleasantries"));
});
