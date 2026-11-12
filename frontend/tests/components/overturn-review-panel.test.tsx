/** The Overturn Review panel (REQ-047..049) and its Data Maintenance switch
 *  (REQ-051). */
import { assertEquals } from "@std/assert";
import { renderHTML, assertContains, assertNotContains } from "../helpers/render.ts";
import { OverturnReviewPanel, type OverturnReviewItem } from "../../components/OverturnReviewPanel.tsx";
import { OverturnReviewSwitch } from "../../routes/api/admin/modal/maintenance/overturn-review.tsx";
import { OverturnReviewColumns, OverturnReviewView } from "../../lib/overturn-review.tsx";

/** As the backend sends it: overturned questions first, then upheld. */
const item: OverturnReviewItem = {
  findingId: "fid-1",
  judge: "judge@x.com",
  heldAt: Date.UTC(2026, 10, 9, 20, 17),
  auditor: "vo@x.com",
  appealComment: "The guest said yes at 2:10",
  recordId: "900200",
  recordMeta: { guestName: "Pat Guest" },
  transcript: null,
  questions: [
    { questionIndex: 0, header: "TimeShare Owner", populated: "Does the guest own a timeshare?", botAnswer: "No", decision: "overturn", judge: "judge@x.com", reviewer: "rev0@x.com" },
    { questionIndex: 2, header: "Correct Location", botAnswer: "No", decision: "overturn", judge: "judge@x.com", reviewer: "rev2@x.com",
      verdict: { verdict: "reverse", note: "Location was never stated", by: "team@x.com", at: 1 } },
    { questionIndex: 1, header: "Correct Dates", botAnswer: "No", decision: "uphold", judge: "judge@x.com", reviewer: "rev1@x.com" },
  ],
};

const waiting = [{ findingId: "fid-1", heldAt: 1, judge: "judge@x.com" }, { findingId: "fid-2", heldAt: 2, judge: "j2@x.com" }];
const render = (over: Partial<Parameters<typeof OverturnReviewPanel>[0]> = {}) =>
  renderHTML(<OverturnReviewPanel item={item} remaining={2} enabled waiting={waiting} {...over} />);

Deno.test("REQ-048: the panel is the reviewer queue's verdict panel — header, question, reviewer and judge chips", () => {
  const html = render();
  assertContains(html, "verdict-panel");
  assertContains(html, "verdict-audit-header");
  assertContains(html, "Pat Guest");
  assertContains(html, "900200");
  assertContains(html, "2 OVERTURNED");
  assertContains(html, "2</span> appeals waiting");
  assertContains(html, "The guest said yes at 2:10");
  assertContains(html, "TimeShare Owner");
  assertContains(html, "Reviewer <span class=\"mono\">rev0@x.com");
  assertContains(html, "Judge <span class=\"mono\">judge@x.com");
  assertContains(html, 'href="/judge/overturn-review?findingId=fid-2"');
});

Deno.test("REQ-048 AMENDMENT: the judge's overturn reason is not shown", () => {
  const html = render();
  assertNotContains(html, "Bot error");
  assertNotContains(html, "the bot got it wrong");
});

Deno.test("REQ-048 AMENDMENT: overturned questions list at the top, upheld ones after", () => {
  const html = render();
  const order = [...html.matchAll(/data-qi="(\d+)"/g)].map((m) => m[1]);
  assertEquals(order, ["0", "2", "1"]);
  assertContains(html.slice(html.indexOf('data-qi="1"')), "Upheld");
});

Deno.test("REQ-049 AMENDMENT: an open overturn has exactly two options — Keep Overturn and Reverse Overturn (which opens the comment modal)", () => {
  const html = render();
  const footer = html.slice(html.indexOf("verdict-footer"));
  assertContains(footer, "Keep Overturn");
  assertContains(footer, "Reverse Overturn");
  assertContains(footer, 'data-action="overturn-reverse"');
  assertEquals((footer.match(/<button/g) ?? []).length, 2, "two buttons, nothing else");
  assertNotContains(footer, "<textarea");
});

Deno.test("REQ-049: a decided overturn shows the team's call instead of the buttons", () => {
  const html = render({ questionIndex: 2 });
  const footer = html.slice(html.indexOf("verdict-footer"));
  assertContains(footer, "reversed by team@x.com");
  assertContains(footer, "Location was never stated");
  assertNotContains(footer, "Keep Overturn");
});

Deno.test("REQ-047: a mixed appeal's upheld question has no call to make", () => {
  const footer = render({ questionIndex: 1 }).slice(render({ questionIndex: 1 }).indexOf("verdict-footer"));
  assertContains(footer, "Upheld by the judge");
  assertNotContains(footer, "Keep Overturn");
});

Deno.test("REQ-048: an empty queue says so", () => {
  assertContains(render({ item: null, remaining: 0, waiting: [] }), "No overturned appeals are waiting");
});

Deno.test("REQ-051 AMENDMENT: the queue page carries no on/off switch", () => {
  assertNotContains(render(), "ovr-toggle");
  assertNotContains(render(), "Turn off");
});

Deno.test("REQ-051: while switched off the queue says overturns close right away", () => {
  assertContains(render({ enabled: false }), "Overturn Review is off");
});

Deno.test("REQ-051 AMENDMENT: the Data Maintenance switch shows the state and the opposite action", () => {
  const on = renderHTML(<OverturnReviewSwitch enabled waiting={3} />);
  assertContains(on, "Turn off");
  assertContains(on, "3 appeals are waiting");
  assertContains(on, 'hx-post="/api/admin/modal/maintenance/overturn-review"');
  assertContains(renderHTML(<OverturnReviewSwitch enabled={false} waiting={1} />), "Turn on");
});

Deno.test("REQ-048 AMENDMENT 2: the waiting count sits above the record info", () => {
  const html = render();
  const count = html.indexOf("appeals waiting");
  const record = html.indexOf("verdict-audit-header");
  assertEquals(count > -1 && count < record, true, "count before the Guest / TM / Record block");
});

Deno.test("REQ-048 AMENDMENT 3: no Bot No / Judge Overturned badge", () => {
  for (const html of [render(), render({ questionIndex: 1 })]) {
    assertNotContains(html, "verdict-badge");
    assertNotContains(html, "JUDGE OVERTURNED");
    assertNotContains(html, "JUDGE UPHELD");
  }
});

Deno.test("REQ-049 AMENDMENT 2: the appeal-sent confirmation is a bottom-right toast, never in the info panel", () => {
  const data = { item, remaining: 1, enabled: true, waiting };
  const html = renderHTML(<OverturnReviewColumns data={data} finalizedId="fid-0" />);
  const panel = html.slice(html.indexOf('id="ovr-panel"'), html.indexOf('class="queue-right"'));
  assertNotContains(panel, "fid-0");
  const toast = html.slice(html.indexOf('id="ovr-toast"'));
  assertContains(toast, 'hx-swap-oob="true"');
  assertContains(toast, "toast");
  assertContains(toast, "fid-0");
  assertNotContains(renderHTML(<OverturnReviewColumns data={data} />), "fid-0 ");
});

Deno.test("REQ-052: the Overturn Review page mounts the queue's bottom-bar audio player and its audio hotkeys", () => {
  const html = renderHTML(
    <OverturnReviewView data={{ item, remaining: 2, enabled: true, waiting }} email="judge@x.com" />,
  );
  assertContains(html, 'class="bottom-bar"');
  assertContains(html, "bb-play");
  assertContains(html, "bb-waveform");
  assertContains(html, 'data-hotkeys="audio"');
  assertNotContains(html, 'data-hotkeys="judge"');
  // The bar reads the appeal on screen from #hx-findingId after every swap.
  assertContains(html, 'id="hx-findingId" value="fid-1"');
});
