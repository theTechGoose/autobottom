import { assertEquals } from "@std/assert";
import {
  JudgeItemSchema,
  JudgeDecisionSchema,
  AppealRecordSchema,
  AppealStatsSchema,
  AppealHistorySchema,
} from "./judge.ts";

Deno.test("JudgeItem schema snapshot — required fields only", () => {
  const fixture = {
    findingId: "finding-001",
    questionIndex: 0,
    header: "Was the agent polite?",
    populated: "Did the agent greet John?",
    thinking: "The agent said hello.",
    defense: "Transcript line 2.",
    answer: "Yes",
  };
  const parsed = JudgeItemSchema.parse(fixture);
  assertEquals(parsed, fixture);
});

Deno.test("JudgeItem schema snapshot — with optional appealType", () => {
  const fixture = {
    findingId: "finding-002",
    questionIndex: 1,
    header: "Did the agent resolve the issue?",
    populated: "Did the agent resolve Bob's issue?",
    thinking: "Issue was escalated.",
    defense: "Transcript shows escalation.",
    answer: "No",
    appealType: "logic",
  };
  const parsed = JudgeItemSchema.parse(fixture);
  assertEquals(parsed, fixture);
});

Deno.test("JudgeDecision schema snapshot — required fields only", () => {
  const fixture = {
    findingId: "finding-001",
    questionIndex: 0,
    header: "Was the agent polite?",
    populated: "Did the agent greet John?",
    thinking: "The agent said hello.",
    defense: "Transcript line 2.",
    answer: "Yes",
    decision: "uphold" as const,
    judge: "carol",
    decidedAt: 1700000000000,
  };
  const parsed = JudgeDecisionSchema.parse(fixture);
  assertEquals(parsed, fixture);
});

Deno.test("JudgeDecision schema snapshot — with optional reason and appealType", () => {
  const fixture = {
    findingId: "finding-002",
    questionIndex: 1,
    header: "Did the agent resolve the issue?",
    populated: "Did the agent resolve Bob's issue?",
    thinking: "Issue was not resolved.",
    defense: "Transcript shows unresolved.",
    answer: "No",
    appealType: "logic",
    decision: "overturn" as const,
    reason: "logic" as const,
    judge: "dave",
    decidedAt: 1700000001000,
  };
  const parsed = JudgeDecisionSchema.parse(fixture);
  assertEquals(parsed, fixture);
});

Deno.test("AppealRecord schema snapshot — required fields only", () => {
  const fixture = {
    findingId: "finding-001",
    appealedAt: 1700000000000,
    status: "pending" as const,
  };
  const parsed = AppealRecordSchema.parse(fixture);
  assertEquals(parsed, fixture);
});

Deno.test("AppealRecord schema snapshot — all optional fields filled", () => {
  const fixture = {
    findingId: "finding-001",
    appealedAt: 1700000000000,
    status: "complete" as const,
    judgedBy: "carol",
    auditor: "alice",
    comment: "Transcript clearly shows resolution.",
  };
  const parsed = AppealRecordSchema.parse(fixture);
  assertEquals(parsed, fixture);
});

Deno.test("AppealStats schema snapshot", () => {
  const fixture = {
    totalAppeals: 20,
    overturned: 5,
    upheld: 15,
  };
  const parsed = AppealStatsSchema.parse(fixture);
  assertEquals(parsed, fixture);
});

Deno.test("AppealHistory schema snapshot", () => {
  const fixture = {
    findingId: "finding-001",
    auditor: "alice",
    judgedBy: "carol",
    originalScore: 80,
    finalScore: 90,
    overturns: 2,
    timestamp: 1700000000000,
  };
  const parsed = AppealHistorySchema.parse(fixture);
  assertEquals(parsed, fixture);
});
