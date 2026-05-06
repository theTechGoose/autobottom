/** Smoke tests for AssemblyAI adapter — tests pure role identification logic. */

import { assertEquals } from "#assert";
import { identifyRoles, processTranscriptResult } from "./mod.ts";

Deno.test("identifyRoles — most talkative speaker is AGENT", () => {
  const utterances = [
    { speaker: "A", text: "Hello", start: 0, end: 5000 },      // 5s
    { speaker: "B", text: "Hi", start: 5000, end: 6000 },      // 1s
    { speaker: "A", text: "How can I help", start: 6000, end: 15000 }, // 9s
    { speaker: "B", text: "I need info", start: 15000, end: 17000 },  // 2s
  ];
  const labeled = identifyRoles(utterances);
  assertEquals(labeled[0].role, "[AGENT]");   // Speaker A talks more (14s)
  assertEquals(labeled[1].role, "[CUSTOMER]"); // Speaker B talks less (3s)
});

Deno.test("identifyRoles — empty returns empty", () => {
  assertEquals(identifyRoles([]).length, 0);
  assertEquals(identifyRoles(undefined as any).length, 0);
});

Deno.test("identifyRoles — sorted by start time", () => {
  const utterances = [
    { speaker: "B", text: "Second", start: 2000, end: 3000 },
    { speaker: "A", text: "First", start: 0, end: 1000 },
    { speaker: "A", text: "Third", start: 4000, end: 10000 },
  ];
  const labeled = identifyRoles(utterances);
  assertEquals(labeled[0].text, "First");
  assertEquals(labeled[1].text, "Second");
  assertEquals(labeled[2].text, "Third");
});

Deno.test("processTranscriptResult — snip filter works", () => {
  const transcript = {
    text: "full text",
    utterances: [
      { speaker: "A", text: "Before", start: 0, end: 1000 },
      { speaker: "A", text: "During", start: 5000, end: 8000 },
      { speaker: "B", text: "After", start: 10000, end: 12000 },
    ],
  };
  const result = processTranscriptResult(transcript, 4000, 9000);
  assertEquals(result.utterances.length, 1);
  assertEquals(result.utterances[0].text, "During");
});
