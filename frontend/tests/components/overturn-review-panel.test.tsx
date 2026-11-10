/** The Overturn Review panel (REQ-047..049, REQ-051). */
import { assertEquals } from "@std/assert";
import { renderHTML, assertContains, assertNotContains } from "../helpers/render.ts";
import { OverturnReviewPanel, type OverturnReviewItem } from "../../components/OverturnReviewPanel.tsx";

const item: OverturnReviewItem = {
  findingId: "fid-1",
  judge: "judge@x.com",
  heldAt: Date.UTC(2026, 10, 9, 20, 17),
  auditor: "vo@x.com",
  appealComment: "The guest said yes at 2:10",
  recordId: "900200",
  transcript: null,
  questions: [
    { questionIndex: 0, header: "TimeShare Owner", populated: "Does the guest own a timeshare?", botAnswer: "No", decision: "overturn", judge: "judge@x.com", judgeReason: "error", reviewer: "rev0@x.com" },
    { questionIndex: 1, header: "Correct Dates", botAnswer: "No", decision: "uphold", judge: "judge@x.com", judgeReason: "Dates were wrong", reviewer: "rev1@x.com" },
    { questionIndex: 2, header: "Correct Location", botAnswer: "No", decision: "overturn", judge: "judge@x.com", judgeReason: "logic", reviewer: "rev2@x.com",
      verdict: { verdict: "reverse", note: "Location was never stated", by: "team@x.com", at: 1 } },
  ],
};

const render = (over: Partial<Parameters<typeof OverturnReviewPanel>[0]> = {}) =>
  renderHTML(<OverturnReviewPanel item={item} remaining={2} enabled waiting={[{ findingId: "fid-1", heldAt: 1, judge: "judge@x.com" }, { findingId: "fid-2", heldAt: 2, judge: "j2@x.com" }]} isAdmin={false} {...over} />);

Deno.test("REQ-048: shows the reviewer who failed each question, the judge's call and the appeal comment", () => {
  const html = render();
  assertContains(html, "TimeShare Owner");
  assertContains(html, "rev0@x.com");
  assertContains(html, "judge@x.com");
  assertContains(html, "Bot error");
  assertContains(html, "The guest said yes at 2:10");
  assertContains(html, "900200");
  assertContains(html, "2 waiting");
  assertContains(html, 'href="/judge/overturn-review?findingId=fid-2"');
  assertContains(html, "fid-2 ·");
});

Deno.test("REQ-047: a mixed appeal's upheld questions show as context with no team call to make", () => {
  const html = render();
  const upheld = html.slice(html.indexOf('data-qi="1"'), html.indexOf('data-qi="2"'));
  assertContains(upheld, "Upheld by judge");
  assertContains(upheld, "Dates were wrong");
  assertNotContains(upheld, "Confirm overturn");
});

Deno.test("REQ-049: an open overturn offers Confirm, and Reverse with a required note", () => {
  const html = render();
  const open = html.slice(html.indexOf('data-qi="0"'), html.indexOf('data-qi="1"'));
  assertContains(open, "Confirm overturn");
  assertContains(open, "Reverse");
  assertEquals(/<textarea[^>]*name="note"[^>]*required/.test(open), true, "the reversal note is required");
});

Deno.test("REQ-049: a decided overturn shows the team's call instead of the buttons", () => {
  const html = render();
  const done = html.slice(html.indexOf('data-qi="2"'));
  assertContains(done, "Reversed by team@x.com");
  assertContains(done, "Location was never stated");
  assertNotContains(done, "Confirm overturn");
});

Deno.test("REQ-048: an empty queue says so", () => {
  const html = render({ item: null, remaining: 0, waiting: [] });
  assertContains(html, "No overturned appeals are waiting");
});

Deno.test("REQ-051: only an admin sees the on/off switch", () => {
  assertNotContains(render(), "ovr-toggle");
  const admin = render({ isAdmin: true });
  assertContains(admin, "ovr-toggle");
  assertContains(admin, "Turn off");
  assertContains(render({ isAdmin: true, enabled: false }), "Turn on");
});

Deno.test("REQ-051: while switched off the page says overturns close right away", () => {
  assertContains(render({ enabled: false }), "Overturn Review is off");
});
