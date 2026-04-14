/** Smoke tests for judge repository. */
import { assertEquals, assert } from "#assert";
import { populateJudgeQueue, recordJudgeDecision, getJudgeStats, getAppeal, dismissFindingFromJudgeQueue } from "./mod.ts";

const kvOpts = { sanitizeResources: false, sanitizeOps: false };
const ORG = "test-org-" + crypto.randomUUID().slice(0, 8);

Deno.test({ name: "judge queue — populate and stats", ...kvOpts, fn: async () => {
  const questions = [
    { header: "Q1", populated: "P1", thinking: "T1", defense: "D1", answer: "No" },
    { header: "Q2", populated: "P2", thinking: "T2", defense: "D2", answer: "No" },
  ];
  await populateJudgeQueue(ORG, "f-judge-1", questions, "redo");
  const stats = await getJudgeStats(ORG);
  assert(stats.pending >= 2);
}});

Deno.test({ name: "judge — decide reduces pending", ...kvOpts, fn: async () => {
  const qs = [{ header: "Q", populated: "P", thinking: "T", defense: "D", answer: "No" }];
  await populateJudgeQueue(ORG, "f-judge-2", qs);
  const { remaining } = await recordJudgeDecision(ORG, "f-judge-2", 0, "uphold", "judge@test.com");
  assertEquals(remaining, 0);
}});

Deno.test({ name: "judge — dismiss removes from queue", ...kvOpts, fn: async () => {
  const qs = [{ header: "Q", populated: "P", thinking: "T", defense: "D", answer: "No" }];
  await populateJudgeQueue(ORG, "f-judge-dismiss", qs);
  const { dismissed } = await dismissFindingFromJudgeQueue(ORG, "f-judge-dismiss");
  assert(dismissed > 0);
}});
