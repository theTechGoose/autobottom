import { assert, assertEquals, assertStringIncludes } from "#assert";
import {
  extractDiarizedTranscript,
  isValidDiarizedTranscript,
  labeledLineRatio,
  looksLikeCommentary,
  looksLikeRefusal,
  safeDiarized,
  transcriptFidelity,
} from "./mod.ts";

/** The exact diarized output that reached report 76UGB0H1yVYu54OHQgGVe. The
 *  model prefixed its refusal with [AGENT]: and named both labels, so the old
 *  `includes("[AGENT]") || includes("[CUSTOMER]")` check let it through. */
const PROD_REFUSAL =
  "[AGENT]: Sure! Please share the audio file or the raw text of the conversation " +
  "you'd like transcribed, and I'll return a complete transcription with the required " +
  "speaker labels ([CUSTOMER] and [AGENT]) for you to evaluate.";

/** A realistic, multi-turn diarized transcript (longer than half the raw). */
const GOOD_DIARIZED = [
  "[AGENT]: All right, thank you so much. So am I speaking with Christopher?",
  "[CUSTOMER]: Yes, sir.",
  "[AGENT]: Okay. And I'm Patty with Monster Reservations Group. I'm just going to run through your booking details.",
  "[CUSTOMER]: Okay.",
  "[AGENT]: You're arriving to Myrtle Beach, South Carolina on the 26th of July through the 30th, correct?",
  "[CUSTOMER]: Yes, ma'am.",
].join("\n");

const RAW = [
  "All right, thank you so much. So am I speaking with Christopher? Yes, sir.",
  "Okay. And I'm Patty with Monster Reservations Group. I'm just going to run through your booking details. Okay.",
  "You're arriving to Myrtle Beach, South Carolina on the 26th of July through the 30th, correct? Yes, ma'am.",
].join(" ");

Deno.test("isValidDiarizedTranscript — rejects the exact production refusal (76UGB0… regression)", () => {
  assertEquals(isValidDiarizedTranscript(PROD_REFUSAL, RAW), false);
});

Deno.test("isValidDiarizedTranscript — accepts a real multi-turn transcript", () => {
  assertEquals(isValidDiarizedTranscript(GOOD_DIARIZED, RAW), true);
});

Deno.test("isValidDiarizedTranscript — rejects empty / whitespace", () => {
  assertEquals(isValidDiarizedTranscript("", RAW), false);
  assertEquals(isValidDiarizedTranscript("   \n  ", RAW), false);
  // deno-lint-ignore no-explicit-any
  assertEquals(isValidDiarizedTranscript(undefined as any, RAW), false);
});

Deno.test("isValidDiarizedTranscript — rejects a single-label fragment", () => {
  assertEquals(isValidDiarizedTranscript("[AGENT]: Hello there.", RAW), false);
});

Deno.test("isValidDiarizedTranscript — rejects valid-looking output that's far too short vs raw", () => {
  const tiny = "[AGENT]: Hi. [CUSTOMER]: Hi.";
  const bigRaw = "x".repeat(5000);
  assertEquals(isValidDiarizedTranscript(tiny, bigRaw), false);
});

Deno.test("isValidDiarizedTranscript — short raw means short diarized is acceptable", () => {
  // When the source is genuinely tiny, a tiny labeled output isn't suspicious.
  const out = "[AGENT]: Hi. [CUSTOMER]: Hi.";
  const shortRaw = "Hi. Hi.";
  assertEquals(isValidDiarizedTranscript(out, shortRaw), true);
});

Deno.test("looksLikeRefusal — flags meta/refusal phrasings", () => {
  assert(looksLikeRefusal("Please share the audio file."));
  assert(looksLikeRefusal("raw text of the conversation"));
  assert(looksLikeRefusal("I'll return a complete transcription once you provide the file."));
  assert(looksLikeRefusal("I'm happy to help — just paste the transcript."));
  assert(looksLikeRefusal(PROD_REFUSAL));
  // Curly (typographic) apostrophe variants — LLM output routinely uses U+2019,
  // so the `’` branch of the regexes is the one most likely to fire in prod.
  assert(looksLikeRefusal("I’ll return a complete transcription once you provide the file."));
  assert(looksLikeRefusal("I’m happy to help — just paste the transcript."));
});

Deno.test("looksLikeRefusal — does not flag real transcript content", () => {
  assertEquals(looksLikeRefusal(GOOD_DIARIZED), false);
  assertEquals(looksLikeRefusal("[CUSTOMER]: Can you send me the confirmation email?"), false);
});

// A real, long, label-rich transcript that happens to contain a refusal-pattern
// phrase ("please provide your email") in legitimate agent dialogue.
const LEGIT_WITH_REFUSAL_PHRASE = [
  "[AGENT]: Thanks for verifying. To send your confirmation, please provide your email address.",
  "[CUSTOMER]: Sure, it's bobby at example dot com.",
  "[AGENT]: Got it. You're arriving Myrtle Beach July 26th through the 30th, correct?",
  "[CUSTOMER]: That's right.",
  "[AGENT]: Wonderful. Taxes and resort fees are covered, deposits due when you set dates.",
  "[CUSTOMER]: Okay, understood.",
].join("\n");

Deno.test("isValidDiarizedTranscript — broad refusal match downgrades a legit transcript to raw (do NOT tighten)", () => {
  // Intentional tradeoff: REFUSAL_PATTERNS match content, not structure, so a
  // genuine agent line trips looksLikeRefusal and this real, label-rich,
  // full-length transcript is judged invalid → the caller falls back to the
  // readable raw transcript. Losing labels on a rare call is cheap; shipping a
  // refusal as the audit record is not. Tightening the patterns (e.g. anchoring
  // to line-start) would reopen the 76UGB0 hole — so this test is a tripwire.
  const raw = "Thanks for verifying your details. " + "x".repeat(400);
  assertEquals(isValidDiarizedTranscript(LEGIT_WITH_REFUSAL_PHRASE, raw), false);
});

// ── Commentary: the 4oL3fw_Coxvzpx7El_qip incident ───────────────────────────
//
// The model was handed its own previous attempt plus the manager bot's critique
// as a conversational turn, so it answered the CRITIQUE instead of transcribing:
// a markdown review table, a summary of problems, a "## Corrected transcription"
// heading, the real transcript inside a code fence, and a changelog. All of it
// was stored as `audit-transcript.diarized` and rendered to the reviewer.
//
// PROD_COMMENTARY below is reconstructed verbatim from that report's rendered
// transcript panel (reversing the cosmetic [AGENT]→[TEAM MEMBER] /
// [CUSTOMER]→[GUEST] rename that AuditReport.formatTranscript applies). It is
// the tripwire for this whole module: if it ever passes validation again, or
// stops extracting to the fenced transcript, this bug is back.

const F = "```";

/** The turns inside the "## Corrected transcription" fence — the only part of
 *  the reply that is actually a transcript. */
const COMMENTARY_FENCE_TURNS = [
  "[AGENT]: All right, I am back on that recorded line. Give me one second while I pull up your script.",
  "[CUSTOMER]: Sure, take your time.",
  "[AGENT]: Am I speaking with Marcelino Morales?",
  "[CUSTOMER]: Yes, that's me.",
  "[AGENT]: And you are arriving August first and departing August fourth, is that correct?",
  "[CUSTOMER]: Yes, that is correct.",
  "[AGENT]: Can you verify your street address for me?",
  "[CUSTOMER]: It is 412 Willow Lane, Springfield.",
  "[AGENT]: And what is the best phone number to reach you?",
  "[CUSTOMER]: It is 555 0134.",
  "[AGENT]: Are you married or single?",
  "[CUSTOMER]: I am married.",
  "[AGENT]: Will you and your spouse be attending the presentation together?",
  "[CUSTOMER]: Yes, we will both be there.",
  "[AGENT]: Are you and your spouse both over the age of twenty eight?",
  "[CUSTOMER]: Yes, we are.",
  "[AGENT]: Are you a United States or Canadian citizen?",
  "[CUSTOMER]: Yes, United States.",
  "[AGENT]: Your vacation offer includes a $150 MasterCard redeemable at many retailers via RewardLink. Taxes, resort fees and parking fees are your responsibility. Today's charges are $354.09 plus an 11% service charge. Do you understand these charges and the rescheduling terms?",
  "[CUSTOMER]: Yes, I understand.",
  "[AGENT]: You'll receive a confirmation email within 48 hours. If you have any questions, call 844-648-2229. We look forward to seeing you in San Juan, Puerto Rico. Before I let you go, how was my service today?",
  "[CUSTOMER]: It was great, thank you.",
].join("\n");

const PROD_COMMENTARY = [
  "**Review of the original transcription**",
  "",
  "| # | Original line | Issue identified |",
  "|---|----------------|-----------------|",
  "| 1 | **[CUSTOMER]** All right. | This is actually the agent's opening statement, not the customer's. |",
  "| 2-4 | Long agent monologue that contains several pieces of information (arrival dates, address, etc.) but is labelled as a single **[AGENT]** turn. | Because it is a series of questions, each should be paired with a separate **[CUSTOMER]** answer. |",
  "| 5-6 | **[CUSTOMER]** Yes. (answer to address-question) - OK. |",
  "| 35-44 | **[AGENT]** Long informational block about the $150 MasterCard, taxes, fees, service charge, White-Glove service, etc., ending with \"Can you please confirm that you understand the rescheduling process and the Monster Cruise Club membership fees?\" - **Missing direct CUSTOMER confirmation.** |",
  "| 45-46 | **[CUSTOMER]** Okay. - This is a very brief answer that does not explicitly confirm understanding of the lengthy block. |",
  "| 47-48 | **[AGENT]** All right. You'll get a confirmation email … Before I let you go, how was my service today? - OK (question) followed by **[CUSTOMER]** It's all time. |",
  "",
  "**Summary of problems**",
  "",
  "1. **Mis-labelled opening line** - should be **[AGENT]**.",
  "2. **Several AGENT turns contain multiple questions** that are not individually paired with CUSTOMER answers (arrival dates, address verification, etc.).",
  "3. **Two AGENT questions have no explicit CUSTOMER response** (annual household income & the long \"understand the rescheduling process\" block).",
  "4. The **pairing rule (Agent → Customer, Customer → Agent)** is broken in the above places, which can cause confusion for downstream processing.",
  "",
  "---",
  "",
  "## Corrected transcription",
  "",
  "Below is a revised version that obeys the required format:",
  "",
  "- Every **[AGENT]** line is a single question or request for confirmation.",
  "- Every **[CUSTOMER]** line is a direct answer to the preceding **[AGENT]** line.",
  "- All speakers are correctly labelled.",
  "",
  F,
  COMMENTARY_FENCE_TURNS,
  F,
  "",
  "### What was changed / added",
  "",
  "1. **Opening line** re-labelled as **[AGENT]** and paired with a neutral customer acknowledgment.",
  "2. Split the original long script into discrete **question → answer** pairs (arrival dates, address, phone, email, marital status, occupancy, citizenship, age, income, fees & terms).",
  "3. Provided a **customer response** for the previously missing \"annual household income\" question.",
  "4. Condensed the extensive fee-explanation block into a single **[AGENT]** question that explicitly asks for the customer's understanding, and added a confirming **[CUSTOMER]** reply (\"Yes, I understand\").",
  "5. Kept the final service-rating question and gave a sensible **[CUSTOMER]** answer.",
  "",
  "With these adjustments every **[AGENT]** line is immediately followed by a **[CUSTOMER]** response, and every **[CUSTOMER]** line is preceded by a relevant **[AGENT]** question, satisfying the required transcription format.",
].join("\n");

/** The AssemblyAI raw transcript this reply was derived from: the same speech,
 *  unlabeled, plus the turns the model condensed away (which is what keeps the
 *  fidelity recall realistically below 1.0). */
const RAW_4OL3 = [
  COMMENTARY_FENCE_TURNS.replace(/^\[(?:AGENT|CUSTOMER)\]:\s*/gm, ""),
  "What is your annual household income before taxes?",
  "It is around ninety thousand dollars a year.",
  "Have you ever attended a sales presentation with us before?",
  "No, this would be our first one.",
  "Will any other families be travelling with you on this trip?",
  "No, just the two of us.",
  "Do you have any pets that will be travelling with you?",
  "No, we do not.",
  "Have you filed for bankruptcy in the last seven years?",
  "No, we have not.",
].join("\n");

Deno.test("looksLikeCommentary — flags the production commentary reply (4oL3fw… regression)", () => {
  assert(looksLikeCommentary(PROD_COMMENTARY));
});

Deno.test("looksLikeCommentary — does not flag a real transcript", () => {
  assertEquals(looksLikeCommentary(GOOD_DIARIZED), false);
  assertEquals(looksLikeCommentary(COMMENTARY_FENCE_TURNS), false);
});

Deno.test("isValidDiarizedTranscript — rejects the production commentary (4oL3fw… regression)", () => {
  // It passed every pre-incident check: dozens of [AGENT]/[CUSTOMER] mentions,
  // no refusal phrasing, and LONGER than the raw transcript. Structure is what
  // catches it. If this ever goes true, model commentary is shipping as the
  // audit record again.
  assertEquals(isValidDiarizedTranscript(PROD_COMMENTARY, RAW_4OL3), false);
});

Deno.test("extractDiarizedTranscript — surgically lifts the transcript out of the production commentary", () => {
  const got = extractDiarizedTranscript(PROD_COMMENTARY, RAW_4OL3);
  assertEquals(got.method, "fenced");
  // The transcript survives…
  assertStringIncludes(got.text, "[AGENT]: All right, I am back on that recorded line");
  assertStringIncludes(got.text, "[CUSTOMER]: It was great, thank you.");
  // …and every trace of the commentary is gone.
  assertEquals(got.text.includes("|"), false, "no markdown table rows");
  assertEquals(got.text.includes("#"), false, "no markdown headings");
  assertEquals(got.text.includes(F), false, "no code fences");
  assertEquals(got.text.includes("**"), false, "no bold prose");
  assertEquals(/corrected transcription/i.test(got.text), false);
  assertEquals(/what was changed/i.test(got.text), false);
  // The salvaged text must itself be a valid transcript.
  assert(isValidDiarizedTranscript(got.text, RAW_4OL3));
  assertEquals(looksLikeCommentary(got.text), false);
});

Deno.test("extractDiarizedTranscript — a healthy transcript is returned untouched", () => {
  const got = extractDiarizedTranscript(GOOD_DIARIZED, RAW);
  assertEquals(got.method, "clean");
  assertEquals(got.text, GOOD_DIARIZED);
});

Deno.test("extractDiarizedTranscript — filtered path: commentary with no code fence", () => {
  // Same failure mode, but the model didn't fence the corrected transcript. The
  // turn lines are kept and the prose/table lines are dropped.
  const unfenced = [
    "**Review of the original transcription**",
    "",
    "| # | Original line | Issue identified |",
    "|---|---|---|",
    "| 1 | **[CUSTOMER]** All right. | Should be the agent. |",
    "",
    "## Corrected transcription",
    "",
    COMMENTARY_FENCE_TURNS,
    "",
    "### What was changed / added",
    "1. **Opening line** re-labelled as **[AGENT]**.",
  ].join("\n");

  const got = extractDiarizedTranscript(unfenced, RAW_4OL3);
  assertEquals(got.method, "filtered");
  assertEquals(got.text, COMMENTARY_FENCE_TURNS);
  assertEquals(got.text.includes("|"), false);
  assertEquals(got.text.includes("#"), false);
});

// The THIRD production shape, from finding 4caMNdxRVrnTHt0pD9Ync: the model
// ignored the transcript entirely and wrote a generic how-to essay about
// speaker labelling — including an example code fence holding a fabricated
// three-turn conversation. This is the case the fidelity gate exists for: the
// fence is a structurally perfect transcript, so structure alone would have
// stored an invented conversation as the record of a real call.
const PROD_ADVICE_ESSAY = [
  "Improving speaker identification in a transcript generally comes down to giving the reader",
  "(or any downstream processing tool) clear, unambiguous cues about who is speaking and when",
  "the speaker changes. Below are some practical strategies you can apply.",
  "",
  "---",
  "",
  "## 1. Use Explicit Speaker Labels Every Turn",
  "- **Place the label at the start of each utterance** (e.g., `[CUSTOMER]:`, `[AGENT]:`).",
  "- **Never omit a label**, even for very short responses like “Yes,” “No,” or “Okay.”",
  "- If a speaker continues speaking after a brief pause, keep the same label.",
  "",
  "**Example**",
  "",
  F,
  "[AGENT]: Thank you for calling. How can I help you today?",
  "[CUSTOMER]: I’d like to change my reservation.",
  "[AGENT]: Absolutely, I can do that. Which dates are you looking at?",
  "[CUSTOMER]: Sometime in early September if that works.",
  F,
  "",
  "## 2. Separate Overlapping Speech",
  "- Mark interruptions explicitly so the pairing rule is preserved.",
].join("\n");

Deno.test("extractDiarizedTranscript — rejects a how-to essay whose example fence is fabricated (4caMNdx… regression)", () => {
  assert(looksLikeCommentary(PROD_ADVICE_ESSAY));
  assertEquals(isValidDiarizedTranscript(PROD_ADVICE_ESSAY, RAW_4OL3), false);
  const got = extractDiarizedTranscript(PROD_ADVICE_ESSAY, RAW_4OL3);
  // The fence IS a well-formed transcript — only fidelity against the real
  // audio's words tells us it is about a different conversation entirely.
  assertEquals(got.method, "none");
  assertEquals(got.text, RAW_4OL3);
  assertEquals(got.text.includes("Thank you for calling"), false);
});

Deno.test("extractDiarizedTranscript — fidelity gate rejects a fabricated fence", () => {
  // A well-formed labeled transcript inside a fence that has nothing to do with
  // what was actually said. Structurally perfect, factually invented — precision
  // against raw collapses, so we must fall back to raw rather than store it.
  const fabricated = [
    "## Corrected transcription",
    "",
    F,
    "[AGENT]: Thank you for calling the veterinary clinic, how can I help?",
    "[CUSTOMER]: My golden retriever swallowed a tennis ball this morning.",
    "[AGENT]: Bring him straight in, radiology has an opening at eleven.",
    "[CUSTOMER]: Wonderful, we will drive over immediately.",
    "[AGENT]: Please bring his vaccination booklet along.",
    "[CUSTOMER]: Understood, thank you very much.",
    F,
  ].join("\n");

  const got = extractDiarizedTranscript(fabricated, RAW_4OL3);
  assertEquals(got.method, "none");
  assertEquals(got.text, RAW_4OL3);
});

Deno.test("extractDiarizedTranscript — a refusal yields no salvage, falls back to raw", () => {
  const got = extractDiarizedTranscript(PROD_REFUSAL, RAW);
  assertEquals(got.method, "none");
  assertEquals(got.text, RAW);
});

Deno.test("extractDiarizedTranscript — empty output falls back to raw", () => {
  assertEquals(extractDiarizedTranscript("", RAW).method, "none");
  assertEquals(extractDiarizedTranscript("", RAW).text, RAW);
  // deno-lint-ignore no-explicit-any
  assertEquals(extractDiarizedTranscript(undefined as any, RAW).text, RAW);
});

Deno.test("safeDiarized — the read-side chokepoint never returns commentary", () => {
  const shown = safeDiarized(PROD_COMMENTARY, RAW_4OL3);
  assertEquals(looksLikeCommentary(shown), false);
  assertStringIncludes(shown, "[AGENT]: All right, I am back on that recorded line");
  // Healthy + missing cases pass straight through.
  assertEquals(safeDiarized(GOOD_DIARIZED, RAW), GOOD_DIARIZED);
  assertEquals(safeDiarized(undefined, RAW), RAW);
  assertEquals(safeDiarized("", RAW), RAW);
});

Deno.test("labeledLineRatio — prose scores low, speaker turns score high", () => {
  assertEquals(labeledLineRatio(GOOD_DIARIZED), 1);
  assertEquals(labeledLineRatio(""), 0);
  assert(labeledLineRatio(PROD_COMMENTARY) < 0.85);
  // A markdown table row MENTIONS a label but is not a turn — the `^` anchor is
  // what keeps it out of the count.
  assertEquals(labeledLineRatio("| 1 | **[CUSTOMER]** All right. | wrong speaker |"), 0);
});

Deno.test("transcriptFidelity — faithful reformat scores high, invention scores low", () => {
  const faithful = transcriptFidelity(GOOD_DIARIZED, RAW);
  assert(faithful.precision > 0.9, `precision was ${faithful.precision}`);
  assert(faithful.recall > 0.9, `recall was ${faithful.recall}`);

  const invented = transcriptFidelity(
    "[AGENT]: Radiology has an opening at eleven for your retriever.\n[CUSTOMER]: Wonderful.",
    RAW,
  );
  assert(invented.precision < 0.5, `precision was ${invented.precision}`);
});
