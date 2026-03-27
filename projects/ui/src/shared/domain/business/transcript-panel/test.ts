import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { TranscriptPanel } from "./mod.ts";

// --- Default property values ---

Deno.test("TranscriptPanel - default diarized is empty string", () => {
  const panel = new TranscriptPanel();
  assertEquals(panel.diarized, "");
});

Deno.test("TranscriptPanel - default raw is empty string", () => {
  const panel = new TranscriptPanel();
  assertEquals(panel.raw, "");
});

// --- State defaults ---

Deno.test("TranscriptPanel - default searchOpen is false", () => {
  const panel = new TranscriptPanel();
  assertEquals(panel.searchOpen, false);
});

Deno.test("TranscriptPanel - default searchQuery is empty string", () => {
  const panel = new TranscriptPanel();
  assertEquals(panel.searchQuery, "");
});

Deno.test("TranscriptPanel - default searchMatchCount is 0", () => {
  const panel = new TranscriptPanel();
  assertEquals(panel.searchMatchCount, 0);
});

Deno.test("TranscriptPanel - default searchActiveIdx is -1", () => {
  const panel = new TranscriptPanel();
  assertEquals(panel.searchActiveIdx, -1);
});

Deno.test("TranscriptPanel - default colOffset is 0", () => {
  const panel = new TranscriptPanel();
  assertEquals(panel.colOffset, 0);
});

// --- Methods ---

Deno.test("TranscriptPanel - openSearch sets searchOpen to true", () => {
  const panel = new TranscriptPanel();
  panel.openSearch();
  assertEquals(panel.searchOpen, true);
});

Deno.test("TranscriptPanel - closeSearch sets searchOpen to false and resets query", () => {
  const panel = new TranscriptPanel();
  panel.searchOpen = true;
  panel.searchQuery = "hello";
  panel.searchMatchCount = 3;
  panel.closeSearch();
  assertEquals(panel.searchOpen, false);
  assertEquals(panel.searchQuery, "");
  assertEquals(panel.searchMatchCount, 0);
});

Deno.test("TranscriptPanel - nextMatch increments searchActiveIdx", () => {
  const panel = new TranscriptPanel();
  panel.searchMatchCount = 5;
  panel.searchActiveIdx = -1;
  panel.nextMatch();
  assertEquals(panel.searchActiveIdx, 0);
  panel.nextMatch();
  assertEquals(panel.searchActiveIdx, 1);
});

Deno.test("TranscriptPanel - nextMatch wraps around at end", () => {
  const panel = new TranscriptPanel();
  panel.searchMatchCount = 3;
  panel.searchActiveIdx = 2;
  panel.nextMatch();
  assertEquals(panel.searchActiveIdx, 0);
});

Deno.test("TranscriptPanel - nextMatch does nothing when no matches", () => {
  const panel = new TranscriptPanel();
  panel.searchMatchCount = 0;
  panel.searchActiveIdx = -1;
  panel.nextMatch();
  assertEquals(panel.searchActiveIdx, -1);
});

Deno.test("TranscriptPanel - prevMatch decrements searchActiveIdx", () => {
  const panel = new TranscriptPanel();
  panel.searchMatchCount = 5;
  panel.searchActiveIdx = 2;
  panel.prevMatch();
  assertEquals(panel.searchActiveIdx, 1);
});

Deno.test("TranscriptPanel - prevMatch wraps around at start", () => {
  const panel = new TranscriptPanel();
  panel.searchMatchCount = 3;
  panel.searchActiveIdx = 0;
  panel.prevMatch();
  assertEquals(panel.searchActiveIdx, 2);
});

Deno.test("TranscriptPanel - prevMatch does nothing when no matches", () => {
  const panel = new TranscriptPanel();
  panel.searchMatchCount = 0;
  panel.prevMatch();
  assertEquals(panel.searchActiveIdx, -1);
});

Deno.test("TranscriptPanel - scrollLeft decrements colOffset", () => {
  const panel = new TranscriptPanel();
  panel.colOffset = 3;
  panel.scrollLeft();
  assertEquals(panel.colOffset, 2);
});

Deno.test("TranscriptPanel - scrollLeft clamps at 0", () => {
  const panel = new TranscriptPanel();
  panel.colOffset = 0;
  panel.scrollLeft();
  assertEquals(panel.colOffset, 0);
});

Deno.test("TranscriptPanel - scrollRight increments colOffset", () => {
  const panel = new TranscriptPanel();
  panel.colOffset = 0;
  panel.scrollRight();
  assertEquals(panel.colOffset, 1);
});

// --- Computed: parseLines ---

Deno.test("TranscriptPanel - lines returns empty array when no transcript", () => {
  const panel = new TranscriptPanel();
  assertEquals(panel.lines, []);
});

Deno.test("TranscriptPanel - lines parses Agent speaker", () => {
  const panel = new TranscriptPanel();
  panel.diarized = "Agent: Hello, how can I help?";
  const lines = panel.lines;
  assertEquals(lines.length, 1);
  assertEquals(lines[0].speaker, "AGENT");
  assertEquals(lines[0].text, "Hello, how can I help?");
});

Deno.test("TranscriptPanel - lines parses Customer speaker", () => {
  const panel = new TranscriptPanel();
  panel.diarized = "Customer: I need help with my order.";
  const lines = panel.lines;
  assertEquals(lines.length, 1);
  assertEquals(lines[0].speaker, "CUSTOMER");
  assertEquals(lines[0].text, "I need help with my order.");
});

Deno.test("TranscriptPanel - lines parses System speaker", () => {
  const panel = new TranscriptPanel();
  panel.diarized = "System: Call connected";
  const lines = panel.lines;
  assertEquals(lines.length, 1);
  assertEquals(lines[0].speaker, "SYSTEM");
  assertEquals(lines[0].text, "Call connected");
});

Deno.test("TranscriptPanel - lines handles bracketed speaker labels", () => {
  const panel = new TranscriptPanel();
  panel.diarized = "[Agent] Thank you for calling.";
  const lines = panel.lines;
  assertEquals(lines.length, 1);
  assertEquals(lines[0].speaker, "AGENT");
  assertEquals(lines[0].text, "Thank you for calling.");
});

Deno.test("TranscriptPanel - lines parses multiple lines", () => {
  const panel = new TranscriptPanel();
  panel.diarized = "Agent: Hi\nCustomer: Hello\nSystem: Connected";
  const lines = panel.lines;
  assertEquals(lines.length, 3);
  assertEquals(lines[0].speaker, "AGENT");
  assertEquals(lines[1].speaker, "CUSTOMER");
  assertEquals(lines[2].speaker, "SYSTEM");
});

Deno.test("TranscriptPanel - lines skips blank lines", () => {
  const panel = new TranscriptPanel();
  panel.diarized = "Agent: Hi\n\n\nCustomer: Hello";
  const lines = panel.lines;
  assertEquals(lines.length, 2);
});

Deno.test("TranscriptPanel - lines handles non-speaker lines", () => {
  const panel = new TranscriptPanel();
  panel.diarized = "Some raw text without a speaker label";
  const lines = panel.lines;
  assertEquals(lines.length, 1);
  assertEquals(lines[0].speaker, undefined);
  assertEquals(lines[0].text, "Some raw text without a speaker label");
});

Deno.test("TranscriptPanel - lines falls back to raw when diarized empty", () => {
  const panel = new TranscriptPanel();
  panel.raw = "Agent: Fallback text";
  const lines = panel.lines;
  assertEquals(lines.length, 1);
  assertEquals(lines[0].speaker, "AGENT");
  assertEquals(lines[0].text, "Fallback text");
});

Deno.test("TranscriptPanel - lines prefers diarized over raw", () => {
  const panel = new TranscriptPanel();
  panel.diarized = "Agent: From diarized";
  panel.raw = "Agent: From raw";
  const lines = panel.lines;
  assertEquals(lines.length, 1);
  assertEquals(lines[0].text, "From diarized");
});
