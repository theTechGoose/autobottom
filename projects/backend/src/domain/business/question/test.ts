import { assertEquals } from "@std/assert";
import { answerQuestion, createQuestion, QuestionService } from "./mod.ts";
import type { ILlmQuestionAnswer, IQuestionSeed } from "../../../../../dto/question.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SEED: IQuestionSeed = {
  header: "Was the agent polite?",
  unpopulated: "Was the agent polite?",
  populated: "Was the agent polite during the call?",
  autoYesExp: "auto-yes-expr",
};

function makeAnswer(raw: string): ILlmQuestionAnswer {
  return { answer: raw, thinking: "thinking text", defense: "defense text" };
}

// ---------------------------------------------------------------------------
// QuestionService class — createQuestion
// ---------------------------------------------------------------------------

Deno.test("QuestionService.createQuestion — fills defaults when optional fields absent", () => {
  const svc = new QuestionService();
  const q = svc.createQuestion(SEED);
  assertEquals(q.autoYesVal, false);
  assertEquals(q.autoYesMsg, "default, this should never happen");
  assertEquals(q.astResults, {});
});

Deno.test("QuestionService.createQuestion — preserves seed fields verbatim", () => {
  const svc = new QuestionService();
  const q = svc.createQuestion(SEED);
  assertEquals(q.header, SEED.header);
  assertEquals(q.unpopulated, SEED.unpopulated);
  assertEquals(q.populated, SEED.populated);
  assertEquals(q.autoYesExp, SEED.autoYesExp);
});

Deno.test("QuestionService.createQuestion — respects overrides for optional fields", () => {
  const svc = new QuestionService();
  const q = svc.createQuestion({ ...SEED, autoYesVal: true, autoYesMsg: "custom msg" });
  assertEquals(q.autoYesVal, true);
  assertEquals(q.autoYesMsg, "custom msg");
});

// ---------------------------------------------------------------------------
// wrapper: createQuestion
// ---------------------------------------------------------------------------

Deno.test("createQuestion wrapper — fills defaults when optional fields absent", () => {
  const q = createQuestion(SEED);
  assertEquals(q.autoYesVal, false);
  assertEquals(q.autoYesMsg, "default, this should never happen");
  assertEquals(q.astResults, {});
});

Deno.test("createQuestion wrapper — preserves seed fields verbatim", () => {
  const q = createQuestion(SEED);
  assertEquals(q.header, SEED.header);
  assertEquals(q.unpopulated, SEED.unpopulated);
  assertEquals(q.populated, SEED.populated);
  assertEquals(q.autoYesExp, SEED.autoYesExp);
});

Deno.test("createQuestion wrapper — respects overrides for optional fields", () => {
  const q = createQuestion({ ...SEED, autoYesVal: true, autoYesMsg: "custom msg" });
  assertEquals(q.autoYesVal, true);
  assertEquals(q.autoYesMsg, "custom msg");
});

// ---------------------------------------------------------------------------
// answerQuestion / normalizeAnswer (tested via answerQuestion)
// ---------------------------------------------------------------------------

Deno.test("answerQuestion — normalizes 'yes' → 'Yes'", () => {
  const q = createQuestion(SEED);
  assertEquals(answerQuestion(q, makeAnswer("yes")).answer, "Yes");
});

Deno.test("answerQuestion — normalizes 'YES' → 'Yes'", () => {
  const q = createQuestion(SEED);
  assertEquals(answerQuestion(q, makeAnswer("YES")).answer, "Yes");
});

Deno.test("answerQuestion — normalizes 'y' → 'Yes'", () => {
  const q = createQuestion(SEED);
  assertEquals(answerQuestion(q, makeAnswer("y")).answer, "Yes");
});

Deno.test("answerQuestion — normalizes 'true' → 'Yes'", () => {
  const q = createQuestion(SEED);
  assertEquals(answerQuestion(q, makeAnswer("true")).answer, "Yes");
});

Deno.test("answerQuestion — normalizes '1' → 'Yes'", () => {
  const q = createQuestion(SEED);
  assertEquals(answerQuestion(q, makeAnswer("1")).answer, "Yes");
});

Deno.test("answerQuestion — normalizes 'no' → 'No'", () => {
  const q = createQuestion(SEED);
  assertEquals(answerQuestion(q, makeAnswer("no")).answer, "No");
});

Deno.test("answerQuestion — normalizes 'NO' → 'No'", () => {
  const q = createQuestion(SEED);
  assertEquals(answerQuestion(q, makeAnswer("NO")).answer, "No");
});

Deno.test("answerQuestion — normalizes 'n' → 'No'", () => {
  const q = createQuestion(SEED);
  assertEquals(answerQuestion(q, makeAnswer("n")).answer, "No");
});

Deno.test("answerQuestion — normalizes 'false' → 'No'", () => {
  const q = createQuestion(SEED);
  assertEquals(answerQuestion(q, makeAnswer("false")).answer, "No");
});

Deno.test("answerQuestion — normalizes '0' → 'No'", () => {
  const q = createQuestion(SEED);
  assertEquals(answerQuestion(q, makeAnswer("0")).answer, "No");
});

Deno.test("answerQuestion — unknown answer falls back to 'No'", () => {
  const q = createQuestion(SEED);
  assertEquals(answerQuestion(q, makeAnswer("maybe")).answer, "No");
});

Deno.test("answerQuestion — preserves thinking and defense fields", () => {
  const q = createQuestion(SEED);
  const answered = answerQuestion(q, makeAnswer("yes"));
  assertEquals(answered.thinking, "thinking text");
  assertEquals(answered.defense, "defense text");
});

Deno.test("answerQuestion — returned object retains all IQuestion fields", () => {
  const q = createQuestion(SEED);
  const answered = answerQuestion(q, makeAnswer("yes"));
  assertEquals(answered.header, SEED.header);
  assertEquals(answered.populated, SEED.populated);
  assertEquals(answered.autoYesVal, false);
});
