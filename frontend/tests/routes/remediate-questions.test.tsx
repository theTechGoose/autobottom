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
import { renderQuestionList, renderRemediateAction } from "../../routes/manager/remediate/[findingId].tsx";
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

// A pass never carries a jump target, whatever its reasoning says.
Deno.test("renderQuestionList — passing questions are never jumpable", () => {
  const html = renderHTML(renderQuestionList([
    q({ header: "Greeting", answer: "Yes", defense: 'The agent says "my name is Matthew".' }),
  ], TRANSCRIPT));
  assertNotContains(html, "data-rem-line-idx");
  assertNotContains(html, "No matching moment");
});

// The hint has to be honest about how many are actually clickable — the old
// copy promised every failed question would jump.
Deno.test("renderQuestionList — hint counts only the jumpable failures", () => {
  const html = renderHTML(renderQuestionList([
    q({ header: "Deposit", answer: "No", defense: '"the refundable deposit of two hundred dollars is returned"' }),
    q({ header: "MCC", answer: "No", defense: 'No mention of "Monster Cruise Club" anywhere.' }),
    q({ header: "Taxes", answer: "No", defense: "There is no mention of taxes. No line includes the word tax." }),
  ], TRANSCRIPT));
  assertContains(html, "3 failed");
  assertContains(html, "1 of 3");
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

// Failures sort to the top but keep their original question numbers.
Deno.test("renderQuestionList — failures first, original numbering preserved", () => {
  const html = renderHTML(renderQuestionList([
    q({ header: "First Pass", answer: "Yes" }),
    q({ header: "Second Fail", answer: "No", defense: "no mention of anything relevant" }),
  ], TRANSCRIPT));
  const failPos = html.indexOf("Second Fail");
  const passPos = html.indexOf("First Pass");
  assertEquals(failPos < passPos, true);
  // The failure is question 2 and still renders as 2.
  assertContains(html, ">2<");
});

// An "Error" answer is neither a pass nor a failure — it must not be treated as
// a failed question (no red row, no jump, no missing-match note).
Deno.test("renderQuestionList — Error answers are not treated as failures", () => {
  const html = renderHTML(renderQuestionList([
    q({ header: "Timed Out", answer: "Error", thinking: "LLM timed out after 25s" }),
  ], TRANSCRIPT));
  assertNotContains(html, "rem-q-failed");
  assertNotContains(html, "No matching moment");
  assertContains(html, "pill-blue");
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
