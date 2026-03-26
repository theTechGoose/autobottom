import { assertEquals } from "@std/assert";
import { identifyRoles } from "./mod.ts";

// Helper to build utterances quickly
function utt(speaker: string, start: number, end: number, text = "words"): {
  speaker: string;
  start: number;
  end: number;
  text: string;
} {
  return { speaker, start, end, text };
}

// ---------------------------------------------------------------------------
// Empty / trivial input
// ---------------------------------------------------------------------------

Deno.test("identifyRoles: empty array returns empty array", () => {
  assertEquals(identifyRoles([]), []);
});

Deno.test("identifyRoles: null/undefined input returns empty array", () => {
  // deno-lint-ignore no-explicit-any
  assertEquals(identifyRoles(null as any), []);
});

// ---------------------------------------------------------------------------
// Role assignment: longest talker is [AGENT]
// ---------------------------------------------------------------------------

Deno.test("identifyRoles: speaker with most duration is labeled [AGENT]", () => {
  const utterances = [
    utt("A", 0, 5000),   // A talks 5000ms
    utt("B", 5000, 6000), // B talks 1000ms
  ];
  const result = identifyRoles(utterances);
  const agentEntry = result.find((u) => u.role === "[AGENT]");
  assertEquals(agentEntry?.text, "words");
  // A should be agent
  const aEntry = result[0]; // sorted by start, A is first
  assertEquals(aEntry.role, "[AGENT]");
});

Deno.test("identifyRoles: shorter-talking speaker is labeled [CUSTOMER]", () => {
  const utterances = [
    utt("A", 0, 5000),
    utt("B", 5000, 6000),
  ];
  const result = identifyRoles(utterances);
  const bEntry = result.find((u) => u.start === 5000);
  assertEquals(bEntry?.role, "[CUSTOMER]");
});

// ---------------------------------------------------------------------------
// Cumulative durations across multiple utterances
// ---------------------------------------------------------------------------

Deno.test("identifyRoles: accumulates duration across multiple utterances per speaker", () => {
  const utterances = [
    utt("X", 0, 1000),    // X: 1000ms
    utt("Y", 1000, 3000),  // Y: 2000ms
    utt("X", 3000, 4500),  // X: 1500ms → total 2500ms
    utt("Y", 4500, 5500),  // Y: 1000ms → total 3000ms
  ];
  // Y has more total duration → [AGENT]
  const result = identifyRoles(utterances);
  const yEntries = result.filter((u) => u.start === 1000 || u.start === 4500);
  for (const entry of yEntries) {
    assertEquals(entry.role, "[AGENT]");
  }
  const xEntries = result.filter((u) => u.start === 0 || u.start === 3000);
  for (const entry of xEntries) {
    assertEquals(entry.role, "[CUSTOMER]");
  }
});

// ---------------------------------------------------------------------------
// Single speaker (only one present)
// ---------------------------------------------------------------------------

Deno.test("identifyRoles: single speaker is labeled [AGENT] (most speaking time)", () => {
  const utterances = [
    utt("A", 0, 2000),
    utt("A", 2000, 4000),
  ];
  const result = identifyRoles(utterances);
  for (const entry of result) {
    assertEquals(entry.role, "[AGENT]");
  }
});

// ---------------------------------------------------------------------------
// Third speaker (unknown role)
// ---------------------------------------------------------------------------

Deno.test("identifyRoles: third speaker with less time than agent and customer is labeled Unknown", () => {
  const utterances = [
    utt("A", 0, 5000),    // agent
    utt("B", 5000, 7000), // customer
    utt("C", 7000, 7500), // unknown — only 500ms
  ];
  const result = identifyRoles(utterances);
  const cEntry = result.find((u) => u.start === 7000);
  assertEquals(cEntry?.role, "Unknown");
});

// ---------------------------------------------------------------------------
// Output ordering: sorted by start time
// ---------------------------------------------------------------------------

Deno.test("identifyRoles: output is sorted by start time ascending", () => {
  const utterances = [
    utt("B", 5000, 6000),
    utt("A", 0, 5000),
  ];
  const result = identifyRoles(utterances);
  assertEquals(result[0].start, 0);
  assertEquals(result[1].start, 5000);
});

// ---------------------------------------------------------------------------
// Preserves text and timing from source
// ---------------------------------------------------------------------------

Deno.test("identifyRoles: preserves text field from source utterance", () => {
  const utterances = [
    { speaker: "A", start: 0, end: 3000, text: "Hello, how can I help?" },
    { speaker: "B", start: 3000, end: 4000, text: "I need assistance." },
  ];
  const result = identifyRoles(utterances);
  assertEquals(result[0].text, "Hello, how can I help?");
  assertEquals(result[1].text, "I need assistance.");
});

Deno.test("identifyRoles: preserves start and end fields", () => {
  const utterances = [
    utt("A", 100, 900),
    utt("B", 900, 1000),
  ];
  const result = identifyRoles(utterances);
  const first = result.find((u) => u.start === 100);
  assertEquals(first?.start, 100);
  assertEquals(first?.end, 900);
});

// ---------------------------------------------------------------------------
// Zero-duration utterances (edge case)
// ---------------------------------------------------------------------------

Deno.test("identifyRoles: handles utterances with zero duration gracefully", () => {
  const utterances = [
    utt("A", 0, 0),   // 0ms
    utt("B", 0, 1),   // 1ms → agent
  ];
  const result = identifyRoles(utterances);
  assertEquals(result.length, 2);
  const bEntry = result.find((u) => u.end === 1);
  assertEquals(bEntry?.role, "[AGENT]");
});
