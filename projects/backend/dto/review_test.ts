import { assertEquals } from "@std/assert";
import {
  ReviewItemSchema,
  ReviewDecisionSchema,
  ReviewerLeaderboardEntrySchema,
  ReviewerDashboardDataSchema,
} from "./review.ts";

Deno.test("ReviewItem schema snapshot", () => {
  const fixture = {
    findingId: "finding-001",
    questionIndex: 0,
    header: "Was the agent polite?",
    populated: "Did the agent greet John?",
    thinking: "The agent said hello.",
    defense: "Transcript line 2.",
    answer: "Yes",
  };
  const parsed = ReviewItemSchema.parse(fixture);
  assertEquals(parsed, fixture);
});

Deno.test("ReviewDecision schema snapshot", () => {
  const fixture = {
    findingId: "finding-001",
    questionIndex: 0,
    header: "Was the agent polite?",
    populated: "Did the agent greet John?",
    thinking: "The agent said hello.",
    defense: "Transcript line 2.",
    answer: "Yes",
    decision: "confirm" as const,
    reviewer: "alice",
    decidedAt: 1700000000000,
  };
  const parsed = ReviewDecisionSchema.parse(fixture);
  assertEquals(parsed, fixture);
});

Deno.test("ReviewDecision schema snapshot — flip decision", () => {
  const fixture = {
    findingId: "finding-002",
    questionIndex: 1,
    header: "Did the agent resolve the issue?",
    populated: "Did the agent resolve Bob's issue?",
    thinking: "Issue was not resolved.",
    defense: "Transcript shows unresolved.",
    answer: "No",
    decision: "flip" as const,
    reviewer: "bob",
    decidedAt: 1700000001000,
  };
  const parsed = ReviewDecisionSchema.parse(fixture);
  assertEquals(parsed, fixture);
});

Deno.test("ReviewerLeaderboardEntry schema snapshot", () => {
  const fixture = {
    reviewer: "alice",
    decisions: 42,
    confirms: 38,
    flips: 4,
    flipRate: "9.52%",
  };
  const parsed = ReviewerLeaderboardEntrySchema.parse(fixture);
  assertEquals(parsed, fixture);
});

Deno.test("ReviewerDashboardData schema snapshot", () => {
  const fixture = {
    queue: { pending: 10, decided: 90 },
    personal: {
      totalDecisions: 42,
      confirmCount: 38,
      flipCount: 4,
      avgDecisionSpeedMs: 3200,
    },
    byReviewer: [
      {
        reviewer: "alice",
        decisions: 42,
        confirms: 38,
        flips: 4,
        flipRate: "9.52%",
      },
    ],
    recentDecisions: [
      {
        findingId: "finding-001",
        questionIndex: 0,
        header: "Was the agent polite?",
        populated: "Did the agent greet John?",
        thinking: "The agent said hello.",
        defense: "Transcript line 2.",
        answer: "Yes",
        decision: "confirm" as const,
        reviewer: "alice",
        decidedAt: 1700000000000,
      },
    ],
  };
  const parsed = ReviewerDashboardDataSchema.parse(fixture);
  assertEquals(parsed, fixture);
});
