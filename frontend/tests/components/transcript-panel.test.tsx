import { assert, assertEquals } from "@std/assert";
import { renderHTML, assertContains, assertNotContains } from "../helpers/render.ts";
import { emitTranscriptLines, TranscriptPanel } from "../../components/TranscriptPanel.tsx";
import { findEvidenceLine } from "../../lib/transcript-excerpt.ts";

Deno.test("TranscriptPanel — empty snippet renders empty state", () => {
  const html = renderHTML(<TranscriptPanel snippet="" />);
  assertContains(html, "No transcript available");
});

Deno.test("TranscriptPanel — renders line count", () => {
  const html = renderHTML(<TranscriptPanel snippet={"[AGENT]: Hello\n[CUSTOMER]: Hi\n[AGENT]: How can I help?"} />);
  assertContains(html, "3 lines");
});

// The component normalizes [AGENT] → "team"/"TEAM MEMBER" and
// [CUSTOMER] → "guest"/"GUEST" to match the rest of the audit UI.
Deno.test("TranscriptPanel — detects AGENT speaker (rendered as TEAM MEMBER)", () => {
  const html = renderHTML(<TranscriptPanel snippet={"[AGENT]: Hello there"} />);
  assertContains(html, "t-speaker-team");
  assertContains(html, "TEAM MEMBER");
});

Deno.test("TranscriptPanel — detects CUSTOMER speaker (rendered as GUEST)", () => {
  const html = renderHTML(<TranscriptPanel snippet={"[CUSTOMER]: Hi there"} />);
  assertContains(html, "t-speaker-guest");
  assertContains(html, "GUEST");
});

Deno.test("TranscriptPanel — non-speaker lines render without label", () => {
  const html = renderHTML(<TranscriptPanel snippet={"Just a plain line"} />);
  assertNotContains(html, "transcript-speaker");
  assertContains(html, "Just a plain line");
});

// When AssemblyAI fails to separate speakers, raw is a single un-segmented
// line. Even though times are indexed to raw, we must NOT render that brick —
// the times can't align anyway, so prefer the speaker-split diarized transcript.
Deno.test("TranscriptPanel — single-line raw brick falls back to diarized despite times", () => {
  const transcript = {
    raw: "[AGENT]: hi there that's correct wonderful as a reminder the tax resolves resort fees welcome aboard",
    diarized: "[AGENT]: hi there\n[CUSTOMER]: that's correct\n[AGENT]: as a reminder the tax resolves resort fees\n[CUSTOMER]: okay\n[AGENT]: welcome aboard",
    utteranceTimes: [0], // one utterance → one time → useless for alignment
  };
  const html = renderHTML(<TranscriptPanel transcript={transcript} />);
  // Diarized (5 turns) rendered, not the 1-line brick.
  assertContains(html, "5 lines");
  assertContains(html, "t-speaker-guest");
});

Deno.test("TranscriptPanel — properly-segmented raw with times still uses raw", () => {
  const transcript = {
    raw: "[AGENT]: line one\n[CUSTOMER]: line two\n[AGENT]: line three",
    diarized: "[AGENT]: different one\n[CUSTOMER]: different two",
    utteranceTimes: [0, 1000, 2000],
  };
  const html = renderHTML(<TranscriptPanel transcript={transcript} />);
  // raw is segmented → keep raw (times align to it).
  assertContains(html, "line one");
  assertNotContains(html, "different one");
});

// ── Index alignment with the remediation evidence jump ───────────────────────
//
// The remediation page resolves a failed question's evidence to a line index
// server-side (findEvidenceLine) and the island then looks that index up as
// `data-line-idx` in this panel's DOM. Blank-line skipping, consecutive-dupe
// suppression and raw-vs-diarized source selection all shift those indices, so
// both sides MUST walk the same list. These pin that contract.

Deno.test("emitTranscriptLines — matches the rendered data-line-idx positions", () => {
  const transcript = {
    // Blank line + a consecutive duplicate: both shift naive indices.
    raw: "[AGENT]: Hello there, this is Matthew.\n\n[CUSTOMER]: Okay.\n[CUSTOMER]: Okay.\n[AGENT]: The refundable deposit is returned on arrival.",
    diarized: "",
    utteranceTimes: [0, 1000, 2000, 3000],
  };
  const emitted = emitTranscriptLines(transcript);
  const html = renderHTML(<TranscriptPanel transcript={transcript} />);
  emitted.forEach(({ line }, idx) => {
    assertContains(html, `data-line-idx="${idx}"`);
    // The line at index N in the emitted list is the line rendered at N.
    const content = line.replace(/^\[[A-Z ]+\]:\s*/, "");
    assertContains(html, content);
  });
  // The duplicate "Okay." collapsed, so 5 raw lines render as 3.
  assertEquals(emitted.length, 3);
});

Deno.test("findEvidenceLine index resolves to the right rendered line", () => {
  const transcript = {
    raw: "[AGENT]: Hello there, this is Matthew.\n\n[CUSTOMER]: Okay.\n[CUSTOMER]: Okay.\n[AGENT]: The refundable deposit is returned on arrival.",
    diarized: "",
    utteranceTimes: [0, 1000, 2000, 3000],
  };
  const lines = emitTranscriptLines(transcript).map((e) => e.line);
  const idx = findEvidenceLine({
    lines,
    defense: 'The agent says "the refundable deposit is returned on arrival".',
  });
  // Index 2 in the RENDERED list — index 4 in the raw text. A naive raw-line
  // index would scroll the manager to the wrong line (or off the end).
  assertEquals(idx, 2);
  assert(lines[idx!].includes("refundable deposit"));
});
