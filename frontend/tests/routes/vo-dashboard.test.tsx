/** Render tests for the VO dashboard's two tables and the manager queue's
 *  "Reviewed by TM" column. */
import { assert } from "@std/assert";
import { renderHTML, assertContains, assertNotContains } from "../helpers/render.ts";
import {
  renderVoQueueTable, renderVoReviewedTable, renderVoReviewAction, type VoQueueItem,
} from "../../routes/api/vo/queue.tsx";
import { renderQueueTable } from "../../routes/api/manager/queue.tsx";

function item(over: Partial<VoQueueItem> = {}): VoQueueItem {
  return {
    findingId: "fid-1", voName: "Dana Lee", status: "pending", totalQuestions: 10, failedCount: 2,
    failedQuestions: ["Correct Dates"], department: "VBA PM", completedAt: Date.now(), ...over,
  };
}
const reviewed = (over: Partial<VoQueueItem> = {}) => item({
  tmReview: { findingId: "fid-1", department: "VBA PM", note: "Checked the dates with Dana", reviewedBy: "vbapmvo@monsterrg.com", reviewedAt: Date.now() },
  ...over,
});

Deno.test("REQ-035: a To Review row offers Review and never Remediate or Skip", () => {
  const html = renderHTML(renderVoQueueTable([item()]));
  assertContains(html, ">Review<");
  assertNotContains(html, "Remediate");
  assertNotContains(html, "Skip");
});

Deno.test("REQ-035: a Reviewed row shows the write-up and who wrote it, with no Review button", () => {
  const html = renderHTML(renderVoReviewedTable([reviewed()]));
  assertContains(html, "Checked the dates with Dana");
  assertContains(html, "vbapmvo");
  assertNotContains(html, ">Review<");
});

Deno.test("REQ-035: the detail page offers Review on an unreviewed audit and a stamp on a reviewed one", () => {
  const open = renderHTML(renderVoReviewAction({ item: item(), findingId: "fid-1", returnTo: "/vo" }).action);
  assertContains(open, ">Review<");
  const done = renderHTML(renderVoReviewAction({ item: reviewed(), findingId: "fid-1", returnTo: "/vo" }).action);
  assertContains(done, "Reviewed by vbapmvo@monsterrg.com");
  assertNotContains(done, "<button");
});

Deno.test("REQ-036: the Reviewed side has a Remediated checkbox, ticked only once the manager remediated", () => {
  const notYet = renderHTML(renderVoReviewedTable([reviewed()]));
  assertContains(notYet, "Remediated");
  assert(/<input[^>]*type="checkbox"[^>]*data-remediated="false"/.test(notYet), "unticked before remediation");
  assert(!/data-remediated="false"[^>]*checked/.test(notYet));
  const done = renderHTML(renderVoReviewedTable([reviewed({ status: "remediated" })]));
  assert(/<input[^>]*type="checkbox"[^>]*checked[^>]*data-remediated="true"|data-remediated="true"[^>]*checked/.test(done), "ticked after remediation");
  assert(/<input[^>]*disabled/.test(done), "read-only for the VO");
});

Deno.test("REQ-037: an appealed audit on the Reviewed side says so", () => {
  const html = renderHTML(renderVoReviewedTable([item({ appealState: "appealed" }), item({ findingId: "f2", appealState: "re-audited" })]));
  assertContains(html, "Appealed");
  assertContains(html, "Re-Audited");
});

Deno.test("REQ-038: the manager's queue has a Reviewed by TM column with the write-up readable", () => {
  const html = renderHTML(renderQueueTable([reviewed()], { compact: true }));
  assertContains(html, "Reviewed by TM");
  assert(/<input[^>]*type="checkbox"[^>]*checked/.test(html), "ticked for a reviewed audit");
  assertContains(html, "Checked the dates with Dana");
});

Deno.test("REQ-038: the manager can still remediate and skip a TM-reviewed audit", () => {
  const html = renderHTML(renderQueueTable([reviewed()], { compact: true }));
  assertContains(html, "Remediate");
  assertContains(html, "Skip");
});

Deno.test("REQ-038: an audit with no TM review shows an empty box and no write-up", () => {
  const html = renderHTML(renderQueueTable([item()], { compact: true }));
  assertContains(html, "Reviewed by TM");
  assert(!/<input[^>]*type="checkbox"[^>]*checked/.test(html));
});

Deno.test("REQ-041: nothing on the VO tables says 'agent'", () => {
  const html = renderHTML(renderVoQueueTable([item()])) + renderHTML(renderVoQueueTable([]))
    + renderHTML(renderVoReviewedTable([reviewed()])) + renderHTML(renderVoReviewedTable([]))
    + renderHTML(renderVoReviewAction({ item: item(), findingId: "fid-1", returnTo: "/vo" }).modal);
  assert(!/agent/i.test(html), "found 'agent' in VO markup");
});
