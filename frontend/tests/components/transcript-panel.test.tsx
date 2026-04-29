import { renderHTML, assertContains, assertNotContains } from "../helpers/render.ts";
import { TranscriptPanel } from "../../components/TranscriptPanel.tsx";

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
