/** Deno KV store for Question Lab configs, questions, tests, and versions. Org-scoped. */
import { nanoid } from "npm:nanoid";
import { orgKey } from "../../../../lib/org.ts";
import type { OrgId } from "../../../../lib/org.ts";

// -- Types ----------------------------------------------------------------

export interface QLVersion {
  text: string;
  timestamp: string;
}

export interface QLConfig {
  id: string;
  name: string;
  createdAt: string;
  questionIds: string[];
}

export interface QLQuestion {
  id: string;
  name: string;
  text: string;
  configId: string;
  autoYesExp: string;
  versions: QLVersion[];
  testIds: string[];
}

export interface QLTest {
  id: string;
  questionId: string;
  snippet: string;
  expected: "yes" | "no";
  lastResult: null | "pass" | "fail";
  lastAnswer: null | string;
  lastThinking: null | string;
  lastDefense: null | string;
  lastRunAt: null | string;
}

import { kvFactory } from "../../data/kv/factory.ts";

// -- KV Helpers -----------------------------------------------------------

async function kv() {
  return await kvFactory();
}

// -- Config Index ---------------------------------------------------------

async function getConfigIndex(orgId: OrgId): Promise<string[]> {
  const db = await kv();
  const entry = await db.get<string[]>(orgKey(orgId, "qlab", "config-index"));
  return entry.value ?? [];
}

async function setConfigIndex(orgId: OrgId, ids: string[]) {
  const db = await kv();
  await db.set(orgKey(orgId, "qlab", "config-index"), ids);
}

// -- Config CRUD ----------------------------------------------------------

export async function listConfigs(orgId: OrgId): Promise<QLConfig[]> {
  const ids = await getConfigIndex(orgId);
  const results: QLConfig[] = [];
  for (const id of ids) {
    const cfg = await getConfig(orgId, id);
    if (cfg) results.push(cfg);
  }
  return results;
}

export async function getConfig(orgId: OrgId, id: string): Promise<QLConfig | null> {
  const db = await kv();
  const entry = await db.get<QLConfig>(orgKey(orgId, "qlab", "config", id));
  return entry.value ?? null;
}

export async function createConfig(orgId: OrgId, name: string): Promise<QLConfig> {
  const id = nanoid();
  const config: QLConfig = { id, name, createdAt: new Date().toISOString(), questionIds: [] };
  const db = await kv();
  await db.set(orgKey(orgId, "qlab", "config", id), config);
  const index = await getConfigIndex(orgId);
  index.push(id);
  await setConfigIndex(orgId, index);
  return config;
}

export async function updateConfig(orgId: OrgId, id: string, name: string): Promise<QLConfig | null> {
  const config = await getConfig(orgId, id);
  if (!config) return null;
  config.name = name;
  const db = await kv();
  await db.set(orgKey(orgId, "qlab", "config", id), config);
  return config;
}

export async function deleteConfig(orgId: OrgId, id: string): Promise<void> {
  const config = await getConfig(orgId, id);
  if (!config) return;
  for (const qId of config.questionIds) {
    await deleteQuestion(orgId, qId);
  }
  const db = await kv();
  await db.delete(orgKey(orgId, "qlab", "config", id));
  const index = await getConfigIndex(orgId);
  await setConfigIndex(orgId, index.filter((i) => i !== id));
}

// -- Question CRUD --------------------------------------------------------

export async function getQuestion(orgId: OrgId, id: string): Promise<QLQuestion | null> {
  const db = await kv();
  const entry = await db.get<QLQuestion>(orgKey(orgId, "qlab", "question", id));
  return entry.value ?? null;
}

export async function getQuestionsForConfig(orgId: OrgId, configId: string): Promise<QLQuestion[]> {
  const config = await getConfig(orgId, configId);
  if (!config) return [];
  const results: QLQuestion[] = [];
  for (const id of config.questionIds) {
    const q = await getQuestion(orgId, id);
    if (q) results.push(q);
  }
  return results;
}

export async function createQuestion(orgId: OrgId, configId: string, name: string, text: string): Promise<QLQuestion | null> {
  const config = await getConfig(orgId, configId);
  if (!config) return null;
  const id = nanoid();
  const question: QLQuestion = { id, name, text, configId, autoYesExp: "", versions: [], testIds: [] };
  const db = await kv();
  await db.set(orgKey(orgId, "qlab", "question", id), question);
  config.questionIds.push(id);
  await db.set(orgKey(orgId, "qlab", "config", configId), config);
  return question;
}

export async function updateQuestion(
  orgId: OrgId,
  id: string,
  updates: { name?: string; text?: string; autoYesExp?: string },
): Promise<QLQuestion | null> {
  const question = await getQuestion(orgId, id);
  if (!question) return null;
  if (updates.text && updates.text !== question.text) {
    question.versions.unshift({ text: question.text, timestamp: new Date().toISOString() });
    question.text = updates.text;
  }
  if (updates.name !== undefined) question.name = updates.name;
  if (updates.autoYesExp !== undefined) question.autoYesExp = updates.autoYesExp;
  const db = await kv();
  await db.set(orgKey(orgId, "qlab", "question", id), question);
  return question;
}

export async function deleteQuestion(orgId: OrgId, id: string): Promise<void> {
  const question = await getQuestion(orgId, id);
  if (!question) return;
  for (const tId of question.testIds) {
    await deleteTest(orgId, tId);
  }
  const db = await kv();
  await db.delete(orgKey(orgId, "qlab", "question", id));
  const config = await getConfig(orgId, question.configId);
  if (config) {
    config.questionIds = config.questionIds.filter((qId) => qId !== id);
    await db.set(orgKey(orgId, "qlab", "config", question.configId), config);
  }
}

export async function restoreVersion(orgId: OrgId, id: string, versionIndex: number): Promise<QLQuestion | null> {
  const question = await getQuestion(orgId, id);
  if (!question) return null;
  if (versionIndex < 0 || versionIndex >= question.versions.length) return null;
  const versionToRestore = question.versions[versionIndex];
  question.versions.splice(versionIndex, 1);
  question.versions.unshift({ text: question.text, timestamp: new Date().toISOString() });
  question.text = versionToRestore.text;
  const db = await kv();
  await db.set(orgKey(orgId, "qlab", "question", id), question);
  return question;
}

// -- Test CRUD ------------------------------------------------------------

export async function getTest(orgId: OrgId, id: string): Promise<QLTest | null> {
  const db = await kv();
  const entry = await db.get<QLTest>(orgKey(orgId, "qlab", "test", id));
  return entry.value ?? null;
}

export async function getTestsForQuestion(orgId: OrgId, questionId: string): Promise<QLTest[]> {
  const question = await getQuestion(orgId, questionId);
  if (!question) return [];
  const results: QLTest[] = [];
  for (const id of question.testIds) {
    const t = await getTest(orgId, id);
    if (t) results.push(t);
  }
  return results;
}

export async function createTest(
  orgId: OrgId,
  questionId: string,
  snippet: string,
  expected: "yes" | "no",
): Promise<QLTest | null> {
  const question = await getQuestion(orgId, questionId);
  if (!question) return null;
  const id = nanoid();
  const test: QLTest = {
    id, questionId, snippet, expected,
    lastResult: null, lastAnswer: null, lastThinking: null, lastDefense: null, lastRunAt: null,
  };
  const db = await kv();
  await db.set(orgKey(orgId, "qlab", "test", id), test);
  question.testIds.push(id);
  await db.set(orgKey(orgId, "qlab", "question", questionId), question);
  return test;
}

export async function updateTest(
  orgId: OrgId,
  id: string,
  updates: { snippet?: string; expected?: "yes" | "no" },
): Promise<QLTest | null> {
  const test = await getTest(orgId, id);
  if (!test) return null;
  if (updates.snippet !== undefined) test.snippet = updates.snippet;
  if (updates.expected !== undefined) test.expected = updates.expected;
  const db = await kv();
  await db.set(orgKey(orgId, "qlab", "test", id), test);
  return test;
}

export async function updateTestResult(
  orgId: OrgId,
  id: string,
  result: "pass" | "fail",
  answer: string,
  thinking: string,
  defense: string,
): Promise<void> {
  const test = await getTest(orgId, id);
  if (!test) return;
  test.lastResult = result;
  test.lastAnswer = answer;
  test.lastThinking = thinking;
  test.lastDefense = defense;
  test.lastRunAt = new Date().toISOString();
  const db = await kv();
  await db.set(orgKey(orgId, "qlab", "test", id), test);
}

export async function deleteTest(orgId: OrgId, id: string): Promise<void> {
  const test = await getTest(orgId, id);
  if (!test) return;
  const db = await kv();
  await db.delete(orgKey(orgId, "qlab", "test", id));
  const question = await getQuestion(orgId, test.questionId);
  if (question) {
    question.testIds = question.testIds.filter((tId) => tId !== id);
    await db.set(orgKey(orgId, "qlab", "question", test.questionId), question);
  }
}

// -- Serve ----------------------------------------------------------------

export async function serveConfig(orgId: OrgId, configNameOrId: string) {
  let config = await getConfig(orgId, configNameOrId);
  if (!config) {
    const all = await listConfigs(orgId);
    config = all.find((c) => c.name === configNameOrId) ?? null;
  }
  if (!config) return [];
  const questions = await getQuestionsForConfig(orgId, config.id);
  return questions.map((q) => ({
    header: q.name,
    unpopulated: q.text,
    populated: q.text,
    autoYesExp: q.autoYesExp,
  }));
}
