/** Frontend tests for the manager remediation detail page.
 *
 *  THE BUG THESE PIN: clicking a failed question jumped to a transcript line
 *  with nothing to do with it. The jump used to be a client-side guess — first
 *  line sharing any 3 substrings of the bot's reasoning prose won — so on a
 *  "this was never disclosed" failure, where the reasoning describes what is
 *  ABSENT, some unrelated line near the top always cleared that bar.
 *
 *  We exercise `renderQuestionList` directly: it's what the SSR page calls, and
 *  it owns both the evidence lookup and the markup the island reads. The second
 *  half covers `renderRemediateAction` — the close-out control this page now
 *  carries so a manager can finish the job without going back to the queue. */
import { assert, assertEquals } from "@std/assert";
import { assertContains, assertNotContains, renderHTML } from "../helpers/render.ts";
import { renderQuestionList, renderRecordDetails, renderRemediateAction, renderRemediationNote } from "../../routes/manager/remediate/[findingId].tsx";
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

// A failure the bot backed with a real transcript quote → jumpable, and pointed
// at the line that actually carries the quote (index 3 in the rendered list).
Deno.test("renderQuestionList — quoted evidence gets the right line index", () => {
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
  assertContains(html, "rem-q-jumpable");
});

// The reported bug, end to end: a "never mentioned" failure must NOT jump.
Deno.test("renderQuestionList — 'never mentioned' failure is not jumpable and says so", () => {
  const html = renderHTML(renderQuestionList([
    q({
      header: "MCC Recurring Charges Disclosed?",
      answer: "No",
      defense:
        'There is no mention of "Monster Cruise Club", membership fees, or any statement indicating a recurring yearly charge.',
    }),
  ], TRANSCRIPT));

  assertNotContains(html, "data-rem-line-idx");
  assertNotContains(html, "rem-q-jumpable");
  assertContains(html, "No matching moment in the call");
});

// Passes are not rendered at all — on a 25-question audit with one failure they
// buried the one row the manager opened the page for.
Deno.test("renderQuestionList — passing questions are not listed", () => {
  const html = renderHTML(renderQuestionList([
    q({ header: "Greeting", answer: "Yes", defense: 'The agent says "my name is Matthew".' }),
  ], TRANSCRIPT));
  assertNotContains(html, "Greeting");
  assertNotContains(html, "pill-green");
  assertNotContains(html, "data-rem-line-idx");
  assertNotContains(html, "No matching moment");
  // The pass still counts toward the total, so the heading stays honest.
  assertContains(html, "0 of 1");
  assertContains(html, "Nothing failed on this audit.");
});

// The hint has to be honest about how many are actually clickable — the old
// copy promised every failed question would jump.
Deno.test("renderQuestionList — hint counts only the jumpable failures", () => {
  const html = renderHTML(renderQuestionList([
    q({ header: "Deposit", answer: "No", defense: '"the refundable deposit of two hundred dollars is returned"' }),
    q({ header: "MCC", answer: "No", defense: 'No mention of "Monster Cruise Club" anywhere.' }),
    q({ header: "Taxes", answer: "No", defense: "There is no mention of taxes. No line includes the word tax." }),
  ], TRANSCRIPT));
  assertContains(html, "Failed Questions (3 of 3)");
  assertContains(html, "jump to it (1 of 3)");
});

// No per-line times = nothing to seek to, so no row may advertise a jump and no
// row should nag about a missing match either.
Deno.test("renderQuestionList — without utterance times nothing is jumpable", () => {
  const html = renderHTML(renderQuestionList([
    q({ header: "Deposit", answer: "No", defense: '"the refundable deposit of two hundred dollars is returned"' }),
  ], { raw: RAW, diarized: "", utteranceTimes: [] }));
  assertNotContains(html, "data-rem-line-idx");
  assertNotContains(html, "No matching moment");
});

// Only failures are listed, and they keep their ORIGINAL question numbers — a
// manager cross-checking against the full report needs "question 2", not "row 1".
Deno.test("renderQuestionList — only failures listed, original numbering preserved", () => {
  const html = renderHTML(renderQuestionList([
    q({ header: "First Pass", answer: "Yes" }),
    q({ header: "Second Fail", answer: "No", defense: "no mention of anything relevant" }),
  ], TRANSCRIPT));
  assertNotContains(html, "First Pass");
  assertContains(html, "Second Fail");
  // The failure is question 2 and still renders as 2.
  assertContains(html, ">2<");
  assertContains(html, "1 of 2");
});

// An "Error" answer is neither a pass nor a failure. It must not get a failure
// row, but it must not vanish with the passes either — a bot outage that left
// questions ungraded is something the manager has to be able to see.
Deno.test("renderQuestionList — ungraded questions are counted, not listed as failures", () => {
  const html = renderHTML(renderQuestionList([
    q({ header: "Timed Out", answer: "Error", thinking: "LLM timed out after 25s" }),
    q({ header: "Real Fail", answer: "No", defense: "no mention of anything relevant" }),
  ], TRANSCRIPT));
  assertNotContains(html, "Timed Out");
  assertNotContains(html, "pill-blue");
  assertContains(html, "1 question could not be graded");
  // The genuine failure is still there, and the count excludes the ungraded one.
  assertContains(html, "Real Fail");
  assertContains(html, "1 of 2");
});

Deno.test("renderQuestionList — ungraded count pluralizes", () => {
  const html = renderHTML(renderQuestionList([
    q({ header: "A", answer: "Error" }),
    q({ header: "B", answer: "Error" }),
  ], TRANSCRIPT));
  assertContains(html, "2 questions could not be graded");
});

// ── Remediate action (close the failure from the detail page) ────────────────
//
// Remediation status lives on the QUEUE ITEM, not the finding, so these pin the
// three states off that. The button and modal are returned together on purpose:
// a modal with no button is unreachable, a button with no modal is dead.


const ACTION_ARGS = {
  findingId: "fid-123",
  userEmail: "manager@monsterrg.com",
  teamMember: "Jordan Reyes",
  returnTo: "/manager?as=ops%40monsterrg.com",
};

Deno.test("renderRemediateAction — pending item gets a button AND its modal", () => {
  const { action, modal } = renderRemediateAction({
    ...ACTION_ARGS,
    queueItem: { findingId: "fid-123", status: "pending" },
  });
  // renderRemediateAction returns nulls for an item with nothing to close out,
  // so narrow before rendering — and pin that a pending item yields both.
  assert(action, "a pending item must render an action control");
  assert(modal, "a pending item must render its remediate modal");

  const actionHtml = renderHTML(action);
  assertContains(actionHtml, "Remediate");
  assertContains(actionHtml, "remediate-modal");

  const modalHtml = renderHTML(modal);
  assertContains(modalHtml, 'hx-post="/api/manager/remediate"');
  // findingId is baked in — the queue's modal needs JS to set it, this one doesn't.
  assertContains(modalHtml, 'value="fid-123"');
  assertContains(modalHtml, 'value="manager@monsterrg.com"');
  // returnTo carries the ?as= view back, instead of dumping them on /manager.
  assertContains(modalHtml, "as=ops%40monsterrg.com");
  assertContains(modalHtml, "Jordan Reyes");
});

Deno.test("renderRemediateAction — already remediated shows who, and NO modal", () => {
  const { action, modal } = renderRemediateAction({
    ...ACTION_ARGS,
    queueItem: {
      findingId: "fid-123",
      status: "remediated",
      remediatedBy: "lead@monsterrg.com",
      notes: "Coached on tax disclosure.",
    },
  });
  assert(action, "a remediated item still renders who closed it out");
  const html = renderHTML(action);
  assertContains(html, "Remediated by lead@monsterrg.com");
  assertNotContains(html, "<button");
  // Re-submitting would re-fire the manager webhook and re-award XP.
  assertEquals(modal, null);
});

Deno.test("renderRemediateAction — no queue item means nothing to close", () => {
  const { action, modal } = renderRemediateAction({ ...ACTION_ARGS, queueItem: null });
  assertEquals(action, null);
  assertEquals(modal, null);
});

/* ── Record Details ───────────────────────────────────────────────────────
   Managers had no way to tell WHICH booking a failed call was about — the page
   showed record ID, recording ID and type and nothing else, while the review
   and judge queues both carry a full Record Details grid. These pin that the
   remediation view now renders the same grid, off the same shared builder. */

Deno.test("renderRecordDetails — date-leg shows guest, destination and travel dates", () => {
  const html = renderHTML(renderRecordDetails({
    record: {
      GuestName: "Sam Guest",
      "33": "Pat Guest",
      "49": "Married",
      DestinationDisplay: "Cancun",
      "8": "2026-09-01",
      "10": "2026-09-08",
      "297": "Suite / 4",
      "460": "1200",
    },
    recordingIdField: "RecordingId",
  }));
  assertContains(html, "Record Details");
  assertContains(html, "Sam Guest");
  assertContains(html, "Pat Guest");
  assertContains(html, "Cancun");
  assertContains(html, "2026-09-01");
  assertContains(html, "Suite / 4");
  // WGS sold (fid 460 populated), MCC not (594 absent).
  assertContains(html, "☑ WGS");
  assertContains(html, "☐ MCC");
});

Deno.test("renderRecordDetails — package uses the partner field set", () => {
  const html = renderHTML(renderRecordDetails({
    record: { GuestName: "Sam Guest", OfficeName: "ODS WFH", "145": "3499.00", "345": "1" },
    recordingIdField: "GenieNumber",
  }));
  assertContains(html, "ODS WFH");
  assertContains(html, "$3499.00");
  assertContains(html, "☑ MCC");
  // Date-leg-only labels must not appear on a package.
  assertNotContains(html, "Departure");
  assertNotContains(html, "Spouse Name");
});

Deno.test("renderRecordDetails — an empty record renders nothing, not a grid of dashes", () => {
  assertEquals(renderRecordDetails({ record: {}, recordingIdField: "RecordingId" }), null);
  assertEquals(renderRecordDetails({}), null);
});

/* ── Remediation note panel ───────────────────────────────────────────────
   The note is the record of what a manager DID about a failure. It used to
   render nowhere but a `title` tooltip; it now leads the left panel on a
   closed-out audit, which is where the Completed tab's Notes column sends
   you. Nothing shows while an item is still pending — there is no note yet. */

Deno.test("renderRemediationNote — a closed-out item shows the note, who and when", () => {
  const html = renderHTML(renderRemediationNote({
    findingId: "fid-1",
    status: "remediated",
    remediatedBy: "lead@monsterrg.com",
    remediatedAt: 1_700_000_000_000,
    notes: "Walked Marcus through the 11% disclosure and re-scripted his close.",
  }));
  assertContains(html, "Walked Marcus through the 11% disclosure");
  assertContains(html, "lead@monsterrg.com");
  assertContains(html, "rem-note-panel");
});

Deno.test("renderRemediationNote — nothing renders for a pending or absent item", () => {
  assertEquals(renderRemediationNote({ findingId: "fid-1", status: "pending", notes: "n/a" }), null);
  assertEquals(renderRemediationNote(null), null);
});

Deno.test("renderRemediationNote — a closed-out item with no note says so", () => {
  // Blank rather than absent: the panel still has to explain the audit was
  // closed, or it reads as a rendering failure.
  const html = renderHTML(renderRemediationNote({
    findingId: "fid-1", status: "remediated", remediatedBy: "lead@monsterrg.com", notes: "   ",
  }));
  assertContains(html, "No notes were recorded");
  assertContains(html, "lead@monsterrg.com");
});
