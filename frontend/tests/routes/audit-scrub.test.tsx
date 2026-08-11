/** Frontend tests for the audit scrub view (/audit/scrub) — the audit report
 *  made playable: every question on the left, click-to-seek transcript on the
 *  right.
 *
 *  These exercise `renderQuestionList` directly: it's what the SSR page calls,
 *  and it owns both the evidence lookup and the exact markup the
 *  RemediationInteractive island reads (`data-rem-line-idx` must address the
 *  same `data-line-idx` TranscriptPanel emits, or a click jumps nowhere).
 *
 *  The remediation view has its own near-identical list (see
 *  remediate-questions.test.tsx). The two are pinned separately on purpose:
 *  that one shows FAILURES ONLY, this one shows every question, and each rule
 *  is load-bearing for its own page. */
import { assertEquals } from "@std/assert";
import { assertContains, assertNotContains, renderHTML } from "../helpers/render.ts";
import { renderQuestionList } from "../../routes/audit/scrub.tsx";
import { emitTranscriptLines } from "../../components/TranscriptPanel.tsx";

const RAW = [
  "[AGENT]: Okay.",
  "[AGENT]: All righty, I'm back. My name is Matthew and I'll be doing your verification today.",
  "[CUSTOMER]: That's correct.",
  "[AGENT]: The refundable deposit of two hundred dollars is returned to you upon arrival at the resort.",
  "[CUSTOMER]: Okay.",
  "[AGENT]: We do abide by all state and federal laws. Welcome aboard.",
].join("\n");

const TRANSCRIPT = {
  raw: RAW,
  diarized: "",
  utteranceTimes: [0, 4000, 9000, 12000, 18000, 21000],
};

function q(over: Record<string, unknown> = {}) {
  return { header: "A Question", answer: "Yes", thinking: "", defense: "", ...over };
}

// The whole point of this page vs. the remediation view: a pass is listed too,
// so someone checking "did the bot really hear the disclosure?" can reach it.
Deno.test("scrub renderQuestionList — passing questions ARE listed, with a green verdict", () => {
  const html = renderHTML(renderQuestionList([
    q({ header: "Greeting Given", answer: "Yes", defense: 'The agent says "my name is Matthew".' }),
  ], TRANSCRIPT));
  assertContains(html, "Greeting Given");
  assertContains(html, "pill-green");
  assertContains(html, "rem-q-passed");
  assertContains(html, "Questions (1)");
});

// A pass backed by a real quote is clickable — that's what makes verifying one
// possible at all.
Deno.test("scrub renderQuestionList — a quoted pass jumps to the right line", () => {
  const html = renderHTML(renderQuestionList([
    q({ header: "Greeting Given", answer: "Yes", defense: 'The agent says "my name is Matthew and I\'ll be doing your verification today".' }),
  ], TRANSCRIPT));

  const lines = emitTranscriptLines(TRANSCRIPT).map((e) => e.line);
  const expected = lines.findIndex((l) => l.includes("My name is Matthew"));
  assertContains(html, `data-rem-line-idx="${expected}"`);
  assertContains(html, "rem-q-jumpable");
});

Deno.test("scrub renderQuestionList — a quoted failure jumps to the right line", () => {
  const html = renderHTML(renderQuestionList([
    q({
      header: "Deposit Refund Explained",
      answer: "No",
      defense: 'The agent says "the refundable deposit of two hundred dollars is returned to you upon arrival".',
    }),
  ], TRANSCRIPT));

  const lines = emitTranscriptLines(TRANSCRIPT).map((e) => e.line);
  const expected = lines.findIndex((l) => l.includes("refundable deposit"));
  assertContains(html, `data-rem-line-idx="${expected}"`);
  assertContains(html, "rem-q-failed");
});

// A "this was never said" verdict describes what is ABSENT, so there is nothing
// to jump to. Guessing a line here is the exact bug that killed the old
// client-side matcher.
Deno.test("scrub renderQuestionList — a 'never mentioned' verdict is not jumpable and says so", () => {
  const html = renderHTML(renderQuestionList([
    q({
      header: "MCC Recurring Charges Disclosed?",
      answer: "No",
      defense: 'There is no mention of "Monster Cruise Club", membership fees, or any statement indicating a recurring yearly charge.',
    }),
  ], TRANSCRIPT));
  assertNotContains(html, "data-rem-line-idx");
  assertNotContains(html, "rem-q-jumpable");
  assertContains(html, "No matching moment in the call");
});

// Original numbering, so a row here and a row on the report are the same
// "question 2" — this page is opened FROM the report to check one of them.
Deno.test("scrub renderQuestionList — every question listed in original order and numbering", () => {
  const html = renderHTML(renderQuestionList([
    q({ header: "First Pass", answer: "Yes" }),
    q({ header: "Second Fail", answer: "No", defense: "no mention of anything relevant" }),
    q({ header: "Third Pass", answer: "Yes" }),
  ], TRANSCRIPT));
  assertContains(html, "First Pass");
  assertContains(html, "Second Fail");
  assertContains(html, "Third Pass");
  assertContains(html, "Questions (3)");
  assertContains(html, "1 failed");
  // Numbers render in source order.
  assertEquals(html.indexOf("First Pass") < html.indexOf("Second Fail"), true);
});

// "Error" is a bot outage, not a verdict — it must not be dressed as a pass or
// a failure (see the Groq TPM 429 ungraded-questions class of incident).
Deno.test("scrub renderQuestionList — an ungraded question renders as Error, not a verdict", () => {
  const html = renderHTML(renderQuestionList([
    q({ header: "Timed Out", answer: "Error", thinking: "LLM timed out after 25s" }),
  ], TRANSCRIPT));
  assertContains(html, "Timed Out");
  assertContains(html, "rem-q-error");
  assertContains(html, "pill-yellow");
  assertNotContains(html, "pill-green");
  assertNotContains(html, "pill-red");
  // It counts toward neither side of the tally.
  assertNotContains(html, "1 failed");
  // And it says WHY it can't be jumped to — "no matching moment" would blame
  // the call for what was a bot outage.
  assertContains(html, "couldn't grade this question");
  assertNotContains(html, "No matching moment");
});

// No per-line times = nothing to seek to. Nothing may advertise a jump, and the
// page has to say why rather than leaving dead rows.
Deno.test("scrub renderQuestionList — without utterance times nothing is jumpable, and it explains", () => {
  const html = renderHTML(renderQuestionList([
    q({ header: "Deposit", answer: "No", defense: '"the refundable deposit of two hundred dollars is returned"' }),
  ], { raw: RAW, diarized: "", utteranceTimes: [] }));
  assertNotContains(html, "data-rem-line-idx");
  assertNotContains(html, "No matching moment");
  assertContains(html, "no per-line timestamps");
});

// The hint promises a count, so it has to be the count of rows that really jump.
Deno.test("scrub renderQuestionList — the hint counts only the jumpable rows", () => {
  const html = renderHTML(renderQuestionList([
    q({ header: "Deposit", answer: "No", defense: '"the refundable deposit of two hundred dollars is returned"' }),
    q({ header: "MCC", answer: "No", defense: 'No mention of "Monster Cruise Club" anywhere.' }),
    q({ header: "Taxes", answer: "No", defense: "There is no mention of taxes. No line includes the word tax." }),
  ], TRANSCRIPT));
  assertContains(html, "Questions (3)");
  assertContains(html, "jump to it (1 of 3)");
});

Deno.test("scrub renderQuestionList — an audit with no questions says so", () => {
  const html = renderHTML(renderQuestionList([], TRANSCRIPT));
  assertContains(html, "no graded questions");
});
