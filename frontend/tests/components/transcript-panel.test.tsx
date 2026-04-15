import { renderHTML, assertContains, assertNotContains } from "../helpers/render.ts";
import { TranscriptPanel } from "../../components/TranscriptPanel.tsx";

Deno.test("TranscriptPanel — empty snippet renders empty state", () => {
  const html = renderHTML(<TranscriptPanel snippet="" />);
  assertContains(html, "No transcript available");
});

Deno.test("TranscriptPanel — renders line count", () => {
  const html = renderHTML(<TranscriptPanel snippet={"[AGENT]: Hello\\n[CUSTOMER]: Hi\\n[AGENT]: How can I help?"} />);
  assertContains(html, "3 lines");
});

Deno.test("TranscriptPanel — detects AGENT speaker", () => {
  const html = renderHTML(<TranscriptPanel snippet={"[AGENT]: Hello there"} />);
  assertContains(html, "agent");
  assertContains(html, "AGENT");
});

Deno.test("TranscriptPanel — detects CUSTOMER speaker", () => {
  const html = renderHTML(<TranscriptPanel snippet={"[CUSTOMER]: Hi there"} />);
  assertContains(html, "customer");
  assertContains(html, "CUSTOMER");
});

Deno.test("TranscriptPanel — non-speaker lines render without label", () => {
  const html = renderHTML(<TranscriptPanel snippet={"Just a plain line"} />);
  assertNotContains(html, "transcript-speaker");
  assertContains(html, "Just a plain line");
});
