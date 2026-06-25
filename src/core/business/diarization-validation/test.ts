import { assert, assertEquals } from "#assert";
import { isValidDiarizedTranscript, looksLikeRefusal } from "./mod.ts";

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
});

Deno.test("looksLikeRefusal — does not flag real transcript content", () => {
  assertEquals(looksLikeRefusal(GOOD_DIARIZED), false);
  assertEquals(looksLikeRefusal("[CUSTOMER]: Can you send me the confirmation email?"), false);
});
