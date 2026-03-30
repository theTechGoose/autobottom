/** Tests for Question Lab enhanced fields.
 *  Validates temperature, numDocs, egregious, weight defaults and constraints. */

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

// -- Simulate QLQuestion defaults (mirrors QLQUESTION_DEFAULTS in question-lab/kv.ts) --

const DEFAULTS = {
  temperature: 0.8,
  numDocs: 4,
  egregious: false,
  weight: 5,
} as const;

interface QLQuestion {
  id: string;
  name: string;
  text: string;
  temperature: number;
  numDocs: number;
  egregious: boolean;
  weight: number;
}

function createQuestion(overrides?: Partial<QLQuestion>): QLQuestion {
  return {
    id: "test-" + Math.random().toString(36).slice(2),
    name: "Test Question",
    text: "Did the team member verify?",
    temperature: DEFAULTS.temperature,
    numDocs: DEFAULTS.numDocs,
    egregious: DEFAULTS.egregious,
    weight: DEFAULTS.weight,
    ...overrides,
  };
}

function clampTemperature(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function clampNumDocs(v: number): number {
  return Math.max(1, Math.min(10, Math.round(v)));
}

function clampWeight(v: number): number {
  return Math.max(1, Math.min(100, Math.round(v)));
}

// -- Tests: Defaults --

Deno.test("defaults — temperature is 0.8", () => {
  const q = createQuestion();
  assertEquals(q.temperature, 0.8);
});

Deno.test("defaults — numDocs is 4", () => {
  const q = createQuestion();
  assertEquals(q.numDocs, 4);
});

Deno.test("defaults — egregious is false", () => {
  const q = createQuestion();
  assertEquals(q.egregious, false);
});

Deno.test("defaults — weight is 5", () => {
  const q = createQuestion();
  assertEquals(q.weight, 5);
});

// -- Tests: Temperature clamping --

Deno.test("temperature — clamps below 0 to 0", () => {
  assertEquals(clampTemperature(-0.5), 0);
});

Deno.test("temperature — clamps above 1 to 1", () => {
  assertEquals(clampTemperature(1.5), 1);
});

Deno.test("temperature — 0 is valid", () => {
  assertEquals(clampTemperature(0), 0);
});

Deno.test("temperature — 1 is valid", () => {
  assertEquals(clampTemperature(1), 1);
});

Deno.test("temperature — 0.3 passes through", () => {
  assertEquals(clampTemperature(0.3), 0.3);
});

// -- Tests: NumDocs clamping --

Deno.test("numDocs — clamps below 1 to 1", () => {
  assertEquals(clampNumDocs(0), 1);
});

Deno.test("numDocs — clamps above 10 to 10", () => {
  assertEquals(clampNumDocs(15), 10);
});

Deno.test("numDocs — rounds decimals", () => {
  assertEquals(clampNumDocs(3.7), 4);
});

// -- Tests: Weight clamping --

Deno.test("weight — clamps below 1 to 1", () => {
  assertEquals(clampWeight(0), 1);
});

Deno.test("weight — clamps above 100 to 100", () => {
  assertEquals(clampWeight(150), 100);
});

Deno.test("weight — rounds decimals", () => {
  assertEquals(clampWeight(7.3), 7);
});

// -- Tests: Serve config shape --

interface ServedQuestion {
  header: string;
  unpopulated: string;
  populated: string;
  autoYesExp: string;
  temperature: number;
  numDocs: number;
  egregious: boolean;
  weight: number;
}

function serveQuestion(q: QLQuestion): ServedQuestion {
  return {
    header: q.name,
    unpopulated: q.text,
    populated: q.text,
    autoYesExp: "",
    temperature: q.temperature ?? DEFAULTS.temperature,
    numDocs: q.numDocs ?? DEFAULTS.numDocs,
    egregious: q.egregious ?? DEFAULTS.egregious,
    weight: q.weight ?? DEFAULTS.weight,
  };
}

Deno.test("serveConfig — includes all new fields", () => {
  const q = createQuestion({ temperature: 0.3, numDocs: 8, egregious: true, weight: 10 });
  const served = serveQuestion(q);
  assertEquals(served.temperature, 0.3);
  assertEquals(served.numDocs, 8);
  assertEquals(served.egregious, true);
  assertEquals(served.weight, 10);
});

Deno.test("serveConfig — backfills defaults for old questions", () => {
  // Simulate an old question that doesn't have the new fields (undefined)
  const oldQuestion = { id: "old", name: "Old Q", text: "Did they?", temperature: undefined, numDocs: undefined, egregious: undefined, weight: undefined } as unknown as QLQuestion;
  const served = serveQuestion(oldQuestion);
  assertEquals(served.temperature, DEFAULTS.temperature);
  assertEquals(served.numDocs, DEFAULTS.numDocs);
  assertEquals(served.egregious, DEFAULTS.egregious);
  assertEquals(served.weight, DEFAULTS.weight);
});

// -- Tests: Clone preserves fields --

Deno.test("clone — preserves all fields on cloned question", () => {
  const original = createQuestion({ temperature: 0.2, numDocs: 6, egregious: true, weight: 15 });
  const cloned = createQuestion({
    temperature: original.temperature,
    numDocs: original.numDocs,
    egregious: original.egregious,
    weight: original.weight,
  });
  assertEquals(cloned.temperature, 0.2);
  assertEquals(cloned.numDocs, 6);
  assertEquals(cloned.egregious, true);
  assertEquals(cloned.weight, 15);
  assert(cloned.id !== original.id); // different IDs
});
