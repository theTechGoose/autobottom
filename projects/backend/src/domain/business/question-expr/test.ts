/** Unit tests for QuestionExprService / question-expr functions. */
import { assertEquals } from "@std/assert";
import { populateQuestions, parseAst, QuestionExprService } from "./mod.ts";
import type { IQuestionSeed, IQuestion } from "../../../../dto/question.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSeed(populated: string, autoYesExp = ""): IQuestionSeed {
  return {
    header: "Test header",
    unpopulated: populated,
    populated,
    autoYesExp,
  };
}

function makeQuestion(populated: string): IQuestion {
  return {
    header: "Test header",
    unpopulated: populated,
    populated,
    autoYesExp: "",
    astResults: {},
    autoYesVal: false,
    autoYesMsg: "",
  };
}

/** Trivial fieldLookup: returns record[id]. */
function simpleLookup(id: string, record: Record<string, unknown>): unknown {
  return record[id];
}

// ---------------------------------------------------------------------------
// populateQuestions
// ---------------------------------------------------------------------------

Deno.test("populateQuestions — replaces a single {{field}} placeholder", () => {
  const seeds = [makeSeed("Hello {{1}}")];
  const record = { "1": "World" };
  const result = populateQuestions(seeds, record, simpleLookup);
  assertEquals(result[0].populated, "Hello World");
});

Deno.test("populateQuestions — replaces multiple placeholders in one question", () => {
  const seeds = [makeSeed("{{1}} loves {{2}}")];
  const record = { "1": "Alice", "2": "Deno" };
  const result = populateQuestions(seeds, record, simpleLookup);
  assertEquals(result[0].populated, "Alice loves Deno");
});

Deno.test("populateQuestions — missing field with no default leaves empty string", () => {
  const seeds = [makeSeed("Name: {{99}}")];
  const record = {};
  const result = populateQuestions(seeds, record, simpleLookup);
  assertEquals(result[0].populated, "Name: ");
});

Deno.test("populateQuestions — missing field uses inline default value", () => {
  const seeds = [makeSeed("Status: {{5 ! unknown}}")];
  const record = {};
  const result = populateQuestions(seeds, record, simpleLookup);
  assertEquals(result[0].populated, "Status: unknown");
});

Deno.test("populateQuestions — present field overrides inline default", () => {
  const seeds = [makeSeed("Status: {{5 ! unknown}}")];
  const record = { "5": "active" };
  const result = populateQuestions(seeds, record, simpleLookup);
  assertEquals(result[0].populated, "Status: active");
});

Deno.test("populateQuestions — also populates autoYesExp field", () => {
  const seeds = [makeSeed("irrelevant", "auto {{1}}")];
  const record = { "1": "yes" };
  const result = populateQuestions(seeds, record, simpleLookup);
  assertEquals(result[0].autoYesExp, "auto yes");
});

// ---------------------------------------------------------------------------
// parseAst
// ---------------------------------------------------------------------------

Deno.test("parseAst — simple (no +: prefix) wraps entire text as single node", () => {
  const q = makeQuestion("Did the agent greet the customer?");
  const result = parseAst(q);
  assertEquals(result.astResults.ast?.length, 1);
  assertEquals(result.astResults.ast?.[0].length, 1);
  assertEquals(result.astResults.ast?.[0][0].flip, false);
});

Deno.test("parseAst — prefixed expression splits on | into multiple OR branches", () => {
  const q = makeQuestion("+:branch one|branch two|branch three");
  const result = parseAst(q);
  assertEquals(result.astResults.ast?.length, 3);
});

Deno.test("parseAst — prefixed expression splits on & into AND nodes within a branch", () => {
  const q = makeQuestion("+:first&second&third");
  const result = parseAst(q);
  assertEquals(result.astResults.ast?.length, 1);
  assertEquals(result.astResults.ast?.[0].length, 3);
});

Deno.test("parseAst — ! operator sets flip=true on the node", () => {
  const q = makeQuestion("+:!negate this");
  const result = parseAst(q);
  assertEquals(result.astResults.ast?.[0][0].flip, true);
  assertEquals(result.astResults.ast?.[0][0].question.includes("!negate"), false);
});

// ---------------------------------------------------------------------------
// pullNotes (tested via QuestionExprService directly and via parseAst)
// ---------------------------------------------------------------------------

Deno.test("pullNotes — backtick-fenced note is stripped from populated and prepended to question", () => {
  const noteContent = "important context";
  const q = makeQuestion(`\`\`\`${noteContent}\`\`\`the actual question`);
  const result = parseAst(q);
  const nodeQuestion = result.astResults.ast?.[0][0].question ?? "";
  assertEquals(nodeQuestion.includes(noteContent), true);
  assertEquals(nodeQuestion.includes("```"), false);
});

Deno.test("pullNotes — text with no backtick fences produces empty notes array", () => {
  const q = makeQuestion("plain question text");
  const result = parseAst(q);
  const nodeQuestion = result.astResults.ast?.[0][0].question ?? "";
  assertEquals(nodeQuestion.trim(), "plain question text");
});

Deno.test("QuestionExprService.pullNotes — returns cleaned text and notes array directly", () => {
  const svc = new QuestionExprService();
  const { cleaned, notes } = svc.pullNotes("```ctx```actual text");
  assertEquals(cleaned, "actual text");
  assertEquals(notes, ["ctx"]);
});
