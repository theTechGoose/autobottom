import { assertEquals } from "@std/assert";
import { makeUserPrompt, parseLlmJson } from "./mod.ts";

// ---------------------------------------------------------------------------
// makeUserPrompt
// ---------------------------------------------------------------------------

Deno.test("makeUserPrompt: includes the question in the output", () => {
  const result = makeUserPrompt("Was the agent polite?", "Agent: Hi there!");
  assertEquals(result.includes("Was the agent polite?"), true);
});

Deno.test("makeUserPrompt: includes the transcript in the output", () => {
  const result = makeUserPrompt("Was the agent polite?", "Agent: Hi there!");
  assertEquals(result.includes("Agent: Hi there!"), true);
});

Deno.test("makeUserPrompt: contains the divorce/separation note", () => {
  const result = makeUserPrompt("Are they married?", "CUSTOMER: I am married.");
  assertEquals(result.includes("divorced"), true);
  assertEquals(result.includes("separated"), true);
});

Deno.test("makeUserPrompt: question appears before transcript", () => {
  const result = makeUserPrompt("Q?", "T here.");
  const qPos = result.indexOf("Q?");
  const tPos = result.indexOf("T here.");
  assertEquals(qPos < tPos, true);
});

Deno.test("makeUserPrompt: empty question is handled", () => {
  const result = makeUserPrompt("", "Some transcript.");
  assertEquals(result.includes("Question:"), true);
  assertEquals(result.includes("Some transcript."), true);
});

Deno.test("makeUserPrompt: empty transcript is handled", () => {
  const result = makeUserPrompt("Any questions?", "");
  assertEquals(result.includes("Any questions?"), true);
  assertEquals(result.includes("Transcription Fragment(s):"), true);
});

// ---------------------------------------------------------------------------
// parseLlmJson — valid JSON
// ---------------------------------------------------------------------------

Deno.test("parseLlmJson: parses clean JSON string", () => {
  const input = '{"answer":"Yes","thinking":"step","defense":"quote"}';
  const result = parseLlmJson(input, { answer: "Error!", thinking: "", defense: "" });
  assertEquals(result.answer, "Yes");
  assertEquals(result.thinking, "step");
  assertEquals(result.defense, "quote");
});

Deno.test("parseLlmJson: extracts JSON embedded in surrounding text", () => {
  const input = 'Here is my response:\n{"answer":"No","thinking":"because","defense":"cited"}\n\nEnd.';
  const result = parseLlmJson(input, { answer: "Error!", thinking: "", defense: "" });
  assertEquals(result.answer, "No");
  assertEquals(result.defense, "cited");
});

Deno.test("parseLlmJson: extracts JSON even with leading/trailing prose", () => {
  const input = 'Sure! Here you go: {"answer":"Yes","thinking":"ok","defense":"x"} Done.';
  const result = parseLlmJson(input, { answer: "Error!", thinking: "", defense: "" });
  assertEquals(result.answer, "Yes");
});

// ---------------------------------------------------------------------------
// parseLlmJson — fallback on invalid input
// ---------------------------------------------------------------------------

Deno.test("parseLlmJson: returns fallback for completely non-JSON string", () => {
  const fallback = { answer: "Error!", thinking: "Error!", defense: "Error!" };
  const result = parseLlmJson("This is just plain text.", fallback);
  assertEquals(result.answer, "Error!");
  assertEquals(result.thinking, "Error!");
});

Deno.test("parseLlmJson: returns fallback for empty string", () => {
  const fallback = { answer: "Error!", thinking: "Error!", defense: "Error!" };
  const result = parseLlmJson("", fallback);
  assertEquals(result, fallback);
});

Deno.test("parseLlmJson: returns fallback for malformed JSON", () => {
  const fallback = { answer: "Error!", thinking: "Error!", defense: "Error!" };
  const result = parseLlmJson("{answer: yes}", fallback); // not valid JSON
  assertEquals(result, fallback);
});

// ---------------------------------------------------------------------------
// parseLlmJson — generic type support
// ---------------------------------------------------------------------------

Deno.test("parseLlmJson: works with boolean fields", () => {
  const input = '{"isCorrect":true,"thinking":"ok","feedback":null}';
  const result = parseLlmJson<{ isCorrect: boolean; thinking: string; feedback: string | null }>(
    input,
    { isCorrect: false, thinking: "", feedback: null },
  );
  assertEquals(result.isCorrect, true);
  assertEquals(result.feedback, null);
});

Deno.test("parseLlmJson: nested JSON object is parsed correctly", () => {
  const input = '{"outer":{"inner":42}}';
  const result = parseLlmJson<{ outer: { inner: number } }>(input, { outer: { inner: 0 } });
  assertEquals(result.outer.inner, 42);
});
