import { renderHTML, assertContains, assertNotContains } from "../helpers/render.ts";
import { assert, assertEquals } from "@std/assert";
import { AuditReport } from "../../components/AuditReport.tsx";

function baseFinding(over: Record<string, unknown> = {}) {
  return {
    id: "fid-test",
    findingStatus: "finished",
    recordingIdField: "VoGenie",
    record: { RecordId: "999", VoGenie: "27200000", VoName: "DS MB - Chastity Jones" },
    answeredQuestions: [
      { header: "Q1", answer: "Yes" },
      { header: "Q2", answer: "Yes" },
    ],
    rawTranscript: "[AGENT] hi\n[CUSTOMER] hello",
    diarizedTranscript: "[AGENT] hi\n[CUSTOMER] hello",
    ...over,
  };
}

Deno.test("AuditReport — single recording shows 'Recording ID' singular", () => {
  const html = renderHTML(<AuditReport finding={baseFinding({ genieIds: ["27200000"] })} id="fid-test" />);
  assertContains(html, "Recording ID");
  assertNotContains(html, "Recording IDs");
  assertContains(html, "27200000");
});

Deno.test("AuditReport — multi recording shows 'Recording IDs' plural with comma list", () => {
  const html = renderHTML(<AuditReport
    finding={baseFinding({ genieIds: ["27200000", "27200001"], s3RecordingKeys: ["a.mp3", "b.mp3"] })}
    id="fid-test"
  />);
  assertContains(html, "Recording IDs");
  assertContains(html, "27200000, 27200001");
});

Deno.test("AuditReport — Team Member strips 'DEST - ' prefix from VoName", () => {
  const html = renderHTML(<AuditReport finding={baseFinding()} id="fid-test" />);
  assertContains(html, "Chastity Jones");
  // The full prefixed string must NOT appear in the Team Member field
  assertNotContains(html, "DS MB - Chastity Jones");
});

Deno.test("AuditReport — VoName without ' - ' renders unchanged", () => {
  const html = renderHTML(<AuditReport
    finding={baseFinding({ record: { RecordId: "999", VoName: "Simple Name" } })}
    id="fid-test"
  />);
  assertContains(html, "Simple Name");
});

Deno.test("AuditReport — date pulled from finding.job.timestamp formatted ET", () => {
  // 2026-04-29T20:38:00Z → 4:38 PM ET on 4/29/26
  const html = renderHTML(<AuditReport
    finding={baseFinding({ job: { timestamp: "2026-04-29T20:38:00Z" } })}
    id="fid-test"
  />);
  assertContains(html, "4/29/26");
});

Deno.test("AuditReport — missing job.timestamp falls back to em-dash", () => {
  const html = renderHTML(<AuditReport finding={baseFinding()} id="fid-test" />);
  // "Date" label is followed by the field value in the metadata grid; em-dash should render.
  assertContains(html, "Date");
});

// Reviewer handle-time (⏱) is internal performance data — admin only.
const timedFinding = () =>
  baseFinding({ answeredQuestions: [{ header: "Q1", answer: "Yes", reviewHandleMs: 6000 }] });

Deno.test("AuditReport — reviewer handle-time badge shows for admin", () => {
  const html = renderHTML(<AuditReport finding={timedFinding()} id="fid-test" isAdmin={true} />);
  assertContains(html, "⏱");
});

Deno.test("AuditReport — reviewer handle-time badge hidden for non-admin", () => {
  const html = renderHTML(<AuditReport finding={timedFinding()} id="fid-test" isAdmin={false} />);
  assertNotContains(html, "⏱");
});

// ── Transcript Context: the brick-wall bug ─────────────────────────────────
// Repro: a short call where AssemblyAI failed to separate speakers, so the raw
// transcript (== the bot's snippet) is one un-segmented [AGENT] line — a brick.
// Groq's diarize produced a proper speaker-split transcript. The per-question
// "Transcript Context" must render a FOCUSED, speaker-split excerpt from the
// diarized transcript, not the raw brick.
const DIARIZED_FIXTURE = [
  "[AGENT]: All righty, I'm back. My name is Matthew, doing your verification.",
  "[CUSTOMER]: That's correct.",
  "[AGENT]: Wonderful. 903-421-1348. Is that accurate, Bobby?",
  "[CUSTOMER]: Correct.",
  "[AGENT]: As a reminder, the tax on your own resolves any resort fees. Refundable deposits are due when you set your dates.",
  "[CUSTOMER]: Okay.",
  "[AGENT]: We abide by all state and federal laws. Welcome aboard.",
].join("\n");

const BRICK_RAW =
  "[AGENT]: All righty, I'm back. That's correct. Wonderful. 903-421-1348. Is that accurate, Bobby? Correct. As a reminder, the tax on your own resolves any resort fees. Refundable deposits are due when you set your dates. Welcome aboard.";

const brickFinding = () =>
  baseFinding({
    rawTranscript: BRICK_RAW,
    diarizedTranscript: DIARIZED_FIXTURE,
    answeredQuestions: [
      {
        header: "Did the TM disclose taxes and resort fees?",
        answer: "No",
        // snippet stored by step-ask-all == the raw brick (short transcript path)
        snippet: BRICK_RAW,
        defense: '"As a reminder, the tax on your own resolves any resort fees."',
        thinking: "I read the transcription to find any statement about taxes and resort fees.",
      },
    ],
  });

// Count non-overlapping occurrences of a substring.
function count(html: string, needle: string): number {
  let n = 0, i = 0;
  for (;;) {
    const idx = html.indexOf(needle, i);
    if (idx < 0) return n;
    n++;
    i = idx + needle.length;
  }
}

Deno.test("AuditReport — Transcript Context renders a focused diarized excerpt, not the brick", () => {
  const html = renderHTML(<AuditReport finding={brickFinding()} id="fid-test" />);
  assertContains(html, "Transcript Context");
  // Text from the matched turn (not in the defense quote) appears in the top
  // transcript AND the focused excerpt area → at least twice.
  assert(count(html, "Refundable deposits are due") >= 2, "matched turn must be in the focused excerpt");
  // …and the "relevant excerpt" hint signals it was narrowed.
  assertContains(html, "relevant excerpt");
  // Far-away turns belong to the top transcript ONLY (count 1). If the snippet
  // had dumped the whole brick / whole transcript these would appear ≥2×.
  assertEquals(count(html, "doing your verification"), 1, "far turn must not be in the excerpt");
  assertEquals(count(html, "903-421-1348"), 1, "far turn must not be in the excerpt");
});

Deno.test("AuditReport — Copy payload (data-copy) is clean speaker-labeled text", () => {
  const html = renderHTML(<AuditReport finding={brickFinding()} id="fid-test" />);
  // copySnippet reads getAttribute('data-copy') — assert its contents directly.
  const m = html.match(/data-copy="([^"]*)"/);
  assert(m, "data-copy attribute must be present on the snippet container");
  // HTML-decode the few entities preact emits in attribute values.
  const payload = m![1]
    .replace(/&#10;/g, "\n").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  assert(/\[TEAM MEMBER\]|\[GUEST\]/.test(payload), "copy text should carry speaker labels");
  assert(payload.includes("\n"), "copy text should be newline-joined turns");
  assert(!payload.includes("⋯"), "gap marker must never leak into copy text");
});

Deno.test("AuditReport — Transcript Context is speaker-split (no single un-labeled brick)", () => {
  const html = renderHTML(<AuditReport finding={brickFinding()} id="fid-test" />);
  // The focused excerpt around the reminder turn includes its adjacent guest
  // turns, rendered with speaker labels.
  assertContains(html, "rpt-snip-line");
  assertContains(html, "[GUEST]");
});

Deno.test("AuditReport — Transcript Context falls back to full split transcript when defense doesn't match", () => {
  const finding = brickFinding();
  // Defense quotes nothing that appears in the transcript → no confident match.
  (finding.answeredQuestions as Array<Record<string, unknown>>)[0].defense = '"nonexistent phrase zzzqqq"';
  const html = renderHTML(<AuditReport finding={finding} id="fid-test" />);
  assertContains(html, "Transcript Context");
  // Full diarized transcript shown (readable), and NOT tagged as a narrowed excerpt.
  assertContains(html, "Welcome aboard");
  assertNotContains(html, "relevant excerpt");
});

// ── Diarization refusal must never reach the report (76UGB0… regression) ─────
// The diarize model occasionally returns a meta/refusal reply that happens to
// contain [AGENT]/[CUSTOMER], so the old `includes()` check rendered it. The
// report must validate the diarized field and fall back to the raw transcript.
const PROD_REFUSAL =
  "[AGENT]: Sure! Please share the audio file or the raw text of the conversation " +
  "you'd like transcribed, and I'll return a complete transcription with the required " +
  "speaker labels ([CUSTOMER] and [AGENT]) for you to evaluate.";

const REAL_RAW =
  "Thanks for calling Monster Reservations Group. You're arriving to Myrtle Beach " +
  "on July 26th through the 30th, correct? Yes, that's right.";

Deno.test("AuditReport — diarization refusal falls back to the raw transcript, never rendered", () => {
  const html = renderHTML(<AuditReport
    finding={baseFinding({ diarizedTranscript: PROD_REFUSAL, rawTranscript: REAL_RAW })}
    id="fid-test"
  />);
  assertNotContains(html, "Please share the audio file");
  assertContains(html, "arriving to Myrtle Beach");
});

Deno.test("AuditReport — a real diarized transcript still renders with speaker labels", () => {
  const diarized =
    "[AGENT]: You're arriving to Myrtle Beach on July 26th through the 30th, correct?\n" +
    "[CUSTOMER]: Yes, that's right.";
  const html = renderHTML(<AuditReport
    finding={baseFinding({ diarizedTranscript: diarized, rawTranscript: REAL_RAW })}
    id="fid-test"
  />);
  // formatTranscript maps [AGENT]→[TEAM MEMBER]; the labeled text is rendered.
  assertContains(html, "[TEAM MEMBER]");
  assertContains(html, "arriving to Myrtle Beach");
});
