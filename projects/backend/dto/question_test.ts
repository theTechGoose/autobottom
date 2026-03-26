import { assertEquals } from "@std/assert";
import {
  AnsweredQuestionSchema,
  LlmQuestionAnswerSchema,
  QuestionSchema,
  QuestionSeedSchema,
} from "./question.ts";

Deno.test("QuestionSeed schema snapshot — required fields only", () => {
  const fixture = {
    header: "Was the agent polite?",
    unpopulated: "Did the agent greet the customer?",
    populated: "Did the agent greet John?",
    autoYesExp: "",
  };
  const parsed = QuestionSeedSchema.parse(fixture);
  assertEquals(parsed, fixture);
});

Deno.test("LlmQuestionAnswer schema snapshot", () => {
  const fixture = {
    answer: "Yes",
    thinking: "The agent said hello at the start.",
    defense: "Transcript line 2 shows greeting.",
  };
  const parsed = LlmQuestionAnswerSchema.parse(fixture);
  assertEquals(parsed, fixture);
});

Deno.test("Question schema snapshot — minimal astResults", () => {
  const fixture = {
    header: "Was the agent polite?",
    unpopulated: "Did the agent greet the customer?",
    populated: "Did the agent greet John?",
    autoYesExp: "",
    astResults: {},
    autoYesVal: false,
    autoYesMsg: "default",
  };
  const parsed = QuestionSchema.parse(fixture);
  assertEquals(parsed, fixture);
});

Deno.test("Question schema snapshot — all optional fields filled", () => {
  const fixture = {
    header: "Was the agent polite?",
    unpopulated: "Did the agent greet the customer?",
    populated: "Did the agent greet John?",
    autoYesExp: "greeting",
    astResults: {
      ast: [[{ question: "q1", flip: false }]],
      notResults: [[false]],
      andResults: [true],
      orResult: true,
    },
    resolvedAst: [{ question: "q1", flip: false }],
    autoYesVal: true,
    autoYesMsg: "Auto-yes triggered by greeting",
  };
  const parsed = QuestionSchema.parse(fixture);
  assertEquals(parsed, fixture);
});

Deno.test("AnsweredQuestion schema snapshot — required fields only", () => {
  const fixture = {
    header: "Was the agent polite?",
    unpopulated: "Did the agent greet the customer?",
    populated: "Did the agent greet John?",
    autoYesExp: "",
    astResults: {},
    autoYesVal: false,
    autoYesMsg: "default",
    answer: "Yes",
    thinking: "Agent greeted.",
    defense: "Line 2.",
  };
  const parsed = AnsweredQuestionSchema.parse(fixture);
  assertEquals(parsed, fixture);
});

Deno.test("AnsweredQuestion schema snapshot — with snippet", () => {
  const fixture = {
    header: "Was the agent polite?",
    unpopulated: "Did the agent greet the customer?",
    populated: "Did the agent greet John?",
    autoYesExp: "",
    astResults: {
      orResult: true,
    },
    autoYesVal: false,
    autoYesMsg: "default",
    answer: "No",
    thinking: "No greeting found.",
    defense: "Transcript has no greeting.",
    snippet: "Hello, how can I help you?",
  };
  const parsed = AnsweredQuestionSchema.parse(fixture);
  assertEquals(parsed, fixture);
});
