/** Smoke tests for question-lab repository. */
import { assertEquals, assert } from "#assert";
import {
  listConfigs, createConfig, getConfig, updateConfig, deleteConfig,
  createQuestion, getQuestion, updateQuestion, deleteQuestion, getQuestionsForConfig, restoreVersion,
  createTest, getTestsForQuestion, deleteTest,
  addTestRun, getTestRuns,
  getInternalAssignments, setInternalAssignment, getPartnerAssignments, setPartnerAssignment,
  getAllQuestionNames, bulkSetEgregious,
} from "./mod.ts";

const kvOpts = { sanitizeResources: false, sanitizeOps: false };
const ORG = "test-org-" + crypto.randomUUID().slice(0, 8);

Deno.test({ name: "config — create, get, list, update, delete", ...kvOpts, fn: async () => {
  const cfg = await createConfig(ORG, "Test Config", "internal");
  assert(cfg.id);
  assertEquals(cfg.name, "Test Config");
  const got = await getConfig(ORG, cfg.id);
  assertEquals(got?.name, "Test Config");
  const list = await listConfigs(ORG);
  assert(list.some((c) => c.id === cfg.id));
  const updated = await updateConfig(ORG, cfg.id, { name: "Renamed" });
  assertEquals(updated?.name, "Renamed");
  await deleteConfig(ORG, cfg.id);
  assertEquals(await getConfig(ORG, cfg.id), null);
}});

Deno.test({ name: "question — create, get, update with versioning, delete", ...kvOpts, fn: async () => {
  const cfg = await createConfig(ORG, "Q Config");
  const q = await createQuestion(ORG, cfg.id, "Income", "Was income disclosed?");
  assert(q.id);
  const updated = await updateQuestion(ORG, q.id, { text: "Was income properly disclosed?" });
  assert(updated?.versions?.length === 1); // original version saved
  assertEquals(updated?.text, "Was income properly disclosed?");
  const questions = await getQuestionsForConfig(ORG, cfg.id);
  assert(questions.some((q) => q.name === "Income"));
  await deleteQuestion(ORG, q.id);
  assertEquals(await getQuestion(ORG, q.id), null);
}});

Deno.test({ name: "question — restore version", ...kvOpts, fn: async () => {
  const cfg = await createConfig(ORG, "Version Config");
  const q = await createQuestion(ORG, cfg.id, "Test", "Original text");
  await updateQuestion(ORG, q.id, { text: "V2 text" });
  const restored = await restoreVersion(ORG, q.id, 0);
  assertEquals(restored?.text, "Original text");
}});

Deno.test({ name: "test — create, list, delete", ...kvOpts, fn: async () => {
  const cfg = await createConfig(ORG, "Test Config");
  const q = await createQuestion(ORG, cfg.id, "Q1", "Question text");
  const t = await createTest(ORG, q.id, "Input text", "Yes");
  assert(t.id);
  const tests = await getTestsForQuestion(ORG, q.id);
  assert(tests.length >= 1);
  await deleteTest(ORG, t.id);
}});

Deno.test({ name: "assignments — internal and partner", ...kvOpts, fn: async () => {
  await setInternalAssignment(ORG, "dest-1", "Config A");
  await setPartnerAssignment(ORG, "East Office", "Config B");
  const internal = await getInternalAssignments(ORG);
  assertEquals(internal["dest-1"], "Config A");
  const partner = await getPartnerAssignments(ORG);
  assertEquals(partner["East Office"], "Config B");
  // Remove assignment
  await setInternalAssignment(ORG, "dest-1", null);
  assertEquals((await getInternalAssignments(ORG))["dest-1"], undefined);
}});

Deno.test({ name: "test runs — add and list reverse-chronological", ...kvOpts, fn: async () => {
  const cfg = await createConfig(ORG, "Run Cfg");
  const q = await createQuestion(ORG, cfg.id, "RunQ", "Question?");
  const t1 = Date.now();
  await addTestRun(ORG, {
    configId: cfg.id, questionId: q.id, result: "pass",
    expectedAnswer: "Yes", actualAnswer: "Yes", runAt: t1,
  });
  await addTestRun(ORG, {
    configId: cfg.id, questionId: q.id, result: "fail",
    expectedAnswer: "Yes", actualAnswer: "No", runAt: t1 + 1000,
  });
  const all = await getTestRuns(ORG, { configId: cfg.id });
  assertEquals(all.length, 2);
  assertEquals(all[0].result, "fail");
  assertEquals(all[1].result, "pass");
  const filtered = await getTestRuns(ORG, { questionId: q.id, limit: 1 });
  assertEquals(filtered.length, 1);
}});

Deno.test({ name: "bulk egregious — updates matching questions", ...kvOpts, fn: async () => {
  const cfg = await createConfig(ORG, "Bulk Config");
  await createQuestion(ORG, cfg.id, "Income", "Q1");
  await createQuestion(ORG, cfg.id, "Income", "Q2");
  await createQuestion(ORG, cfg.id, "Other", "Q3");
  const count = await bulkSetEgregious(ORG, "Income", true);
  assertEquals(count, 2);
}});

Deno.test({ name: "test runs — questionId filter excludes other questions' runs", ...kvOpts, fn: async () => {
  const ORG2 = "test-runs-q-" + crypto.randomUUID().slice(0, 8);
  const cfg = await createConfig(ORG2, "Filter Cfg");
  const q1 = await createQuestion(ORG2, cfg.id, "Q1", "?");
  const q2 = await createQuestion(ORG2, cfg.id, "Q2", "?");
  const base = Date.now();
  await addTestRun(ORG2, { configId: cfg.id, questionId: q1.id, result: "pass", expectedAnswer: "Yes", actualAnswer: "Yes", runAt: base });
  await addTestRun(ORG2, { configId: cfg.id, questionId: q2.id, result: "fail", expectedAnswer: "Yes", actualAnswer: "No",  runAt: base + 100 });
  await addTestRun(ORG2, { configId: cfg.id, questionId: q2.id, result: "pass", expectedAnswer: "No",  actualAnswer: "No",  runAt: base + 200 });

  const onlyQ2 = await getTestRuns(ORG2, { questionId: q2.id });
  assertEquals(onlyQ2.length, 2);
  assert(onlyQ2.every((r) => r.questionId === q2.id));

  const onlyQ1 = await getTestRuns(ORG2, { questionId: q1.id });
  assertEquals(onlyQ1.length, 1);
  assertEquals(onlyQ1[0].result, "pass");
}});

Deno.test({ name: "test runs — empty result for unknown configId", ...kvOpts, fn: async () => {
  const ORG3 = "test-runs-empty-" + crypto.randomUUID().slice(0, 8);
  assertEquals((await getTestRuns(ORG3, { configId: "no-such-config" })).length, 0);
}});

Deno.test({ name: "test runs — preserves thinking + defense fields", ...kvOpts, fn: async () => {
  const ORG4 = "test-runs-detail-" + crypto.randomUUID().slice(0, 8);
  const cfg = await createConfig(ORG4, "Detail Cfg");
  const q = await createQuestion(ORG4, cfg.id, "DetailQ", "?");
  await addTestRun(ORG4, {
    configId: cfg.id, questionId: q.id, result: "fail",
    expectedAnswer: "Yes", actualAnswer: "No",
    thinking: "model thought no",
    defense: "explicit denial in transcript",
    runAt: Date.now(),
  });
  const runs = await getTestRuns(ORG4, { configId: cfg.id });
  assertEquals(runs.length, 1);
  assertEquals(runs[0].thinking, "model thought no");
  assertEquals(runs[0].defense, "explicit denial in transcript");
}});
