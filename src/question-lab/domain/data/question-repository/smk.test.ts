/** Smoke tests for question-lab repository. */
import { assertEquals, assert } from "#assert";
import {
  listConfigs, createConfig, getConfig, updateConfig, deleteConfig,
  createQuestion, getQuestion, updateQuestion, deleteQuestion, getQuestionsForConfig, restoreVersion,
  createTest, getTestsForQuestion, deleteTest,
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

Deno.test({ name: "bulk egregious — updates matching questions", ...kvOpts, fn: async () => {
  const cfg = await createConfig(ORG, "Bulk Config");
  await createQuestion(ORG, cfg.id, "Income", "Q1");
  await createQuestion(ORG, cfg.id, "Income", "Q2");
  await createQuestion(ORG, cfg.id, "Other", "Q3");
  const count = await bulkSetEgregious(ORG, "Income", true);
  assertEquals(count, 2);
}});
