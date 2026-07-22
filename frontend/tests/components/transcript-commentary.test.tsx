/** Render-surface tripwires for the 4oL3fw_Coxvzpx7El_qip incident.
 *
 *  The stored `diarized` transcript for that audit was not a transcript — it was
 *  the diarization model answering a critique: a markdown review table, a
 *  "## Corrected transcription" heading, the real transcript inside a code
 *  fence, and a "### What was changed / added" changelog. It rendered verbatim
 *  on the audit report AND in the review queue, where a reviewer read it while
 *  grading.
 *
 *  These tests assert the two render surfaces show the TRANSCRIPT and never the
 *  commentary — for stored-bad data, with no repair sweep having run. The read
 *  side has to hold on its own, because the sweep can only reach rows it knows
 *  about. */

import { assertContains, assertNotContains, renderHTML } from "../helpers/render.ts";
import { TranscriptPanel } from "../../components/TranscriptPanel.tsx";
import { AuditReport } from "../../components/AuditReport.tsx";

const F = "```";

const TURNS = [
  "[AGENT]: All right, I am back on that recorded line. Give me one second while I pull up your script.",
  "[CUSTOMER]: Sure, take your time.",
  "[AGENT]: And you are arriving August first and departing August fourth, is that correct?",
  "[CUSTOMER]: Yes, that is correct.",
  "[AGENT]: Can you verify your street address for me?",
  "[CUSTOMER]: It is 412 Willow Lane, Springfield.",
  "[AGENT]: Are you married or single?",
  "[CUSTOMER]: I am married.",
  "[AGENT]: Are you a United States or Canadian citizen?",
  "[CUSTOMER]: Yes, United States.",
  "[AGENT]: Before I let you go, how was my service today?",
  "[CUSTOMER]: It was great, thank you.",
].join("\n");

const RAW = TURNS.replace(/^\[(?:AGENT|CUSTOMER)\]:\s*/gm, "");

const COMMENTARY = [
  "**Review of the original transcription**",
  "",
  "| # | Original line | Issue identified |",
  "|---|---|---|",
  "| 1 | **[CUSTOMER]** All right. | This is actually the agent's opening statement. |",
  "",
  "**Summary of problems**",
  "",
  "1. **Mis-labelled opening line** - should be **[AGENT]**.",
  "",
  "## Corrected transcription",
  "",
  "Below is a revised version that obeys the required format:",
  "",
  F,
  TURNS,
  F,
  "",
  "### What was changed / added",
  "1. **Opening line** re-labelled as **[AGENT]**.",
].join("\n");

/** Every marker that must never reach a rendered page. */
const FORBIDDEN = [
  "Review of the original transcription",
  "Summary of problems",
  "Corrected transcription",
  "What was changed",
  "Issue identified",
  "Mis-labelled",
  "|---|",
];

Deno.test("TranscriptPanel — a stored commentary reply renders as the transcript, not the critique", () => {
  const html = renderHTML(<TranscriptPanel transcript={{ raw: RAW, diarized: COMMENTARY }} />);
  for (const marker of FORBIDDEN) assertNotContains(html, marker);
  // The real turns are what's shown.
  assertContains(html, "I am back on that recorded line");
  assertContains(html, "It was great, thank you.");
  assertContains(html, "TEAM MEMBER");
  assertContains(html, "GUEST");
});

Deno.test("AuditReport — a stored commentary reply renders as the transcript, not the critique", () => {
  const finding = {
    id: "fid-commentary",
    findingStatus: "finished",
    recordingIdField: "VoGenie",
    record: { RecordId: "492997", VoGenie: "27621414", VoName: "VO MB - Carlarae Greer" },
    answeredQuestions: [{ header: "Q1", answer: "Yes" }],
    rawTranscript: RAW,
    diarizedTranscript: COMMENTARY,
  };
  const html = renderHTML(<AuditReport finding={finding} id="fid-commentary" />);
  for (const marker of FORBIDDEN) assertNotContains(html, marker);
  assertContains(html, "I am back on that recorded line");
  assertContains(html, "[TEAM MEMBER]");
});

Deno.test("AuditReport — speaker line renders one colon, not two", () => {
  // The badge span used to be followed by a literal ":" while slice() already
  // kept the line's own separator, rendering "[TEAM MEMBER] :: All right…".
  const finding = {
    id: "fid-colon",
    findingStatus: "finished",
    recordingIdField: "VoGenie",
    record: { RecordId: "1", VoGenie: "2", VoName: "VO MB - Someone" },
    answeredQuestions: [{ header: "Q1", answer: "Yes" }],
    rawTranscript: RAW,
    diarizedTranscript: TURNS,
  };
  const html = renderHTML(<AuditReport finding={finding} id="fid-colon" />);
  assertNotContains(html, "</span>:: ");
  assertContains(html, "[TEAM MEMBER]</span>: All right, I am back");
});

Deno.test("TranscriptPanel — a stored refusal falls back to the raw transcript", () => {
  const refusal =
    "[AGENT]: Sure! Please share the audio file or the raw text of the conversation " +
    "you'd like transcribed, and I'll return a complete transcription with the required " +
    "speaker labels ([CUSTOMER] and [AGENT]) for you to evaluate.";
  const html = renderHTML(<TranscriptPanel transcript={{ raw: RAW, diarized: refusal }} />);
  assertNotContains(html, "Please share the audio file");
  assertContains(html, "I am back on that recorded line");
});
