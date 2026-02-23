/** Deno KV store for Question Lab configs, questions, tests, and versions. */
import { nanoid } from "npm:nanoid";

// ── Types ────────────────────────────────────────────────────────────

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

// ── KV Helpers ───────────────────────────────────────────────────────

async function kv() {
  return await Deno.openKv();
}

// ── Config Index ─────────────────────────────────────────────────────

async function getConfigIndex(): Promise<string[]> {
  const db = await kv();
  const entry = await db.get<string[]>(["qlab", "config-index"]);
  return entry.value ?? [];
}

async function setConfigIndex(ids: string[]) {
  const db = await kv();
  await db.set(["qlab", "config-index"], ids);
}

// ── Config CRUD ──────────────────────────────────────────────────────

export async function listConfigs(): Promise<QLConfig[]> {
  const ids = await getConfigIndex();
  const results: QLConfig[] = [];
  for (const id of ids) {
    const cfg = await getConfig(id);
    if (cfg) results.push(cfg);
  }
  return results;
}

export async function getConfig(id: string): Promise<QLConfig | null> {
  const db = await kv();
  const entry = await db.get<QLConfig>(["qlab", "config", id]);
  return entry.value ?? null;
}

export async function createConfig(name: string): Promise<QLConfig> {
  const id = nanoid();
  const config: QLConfig = { id, name, createdAt: new Date().toISOString(), questionIds: [] };
  const db = await kv();
  await db.set(["qlab", "config", id], config);
  const index = await getConfigIndex();
  index.push(id);
  await setConfigIndex(index);
  return config;
}

export async function updateConfig(id: string, name: string): Promise<QLConfig | null> {
  const config = await getConfig(id);
  if (!config) return null;
  config.name = name;
  const db = await kv();
  await db.set(["qlab", "config", id], config);
  return config;
}

export async function deleteConfig(id: string): Promise<void> {
  const config = await getConfig(id);
  if (!config) return;
  for (const qId of config.questionIds) {
    await deleteQuestion(qId);
  }
  const db = await kv();
  await db.delete(["qlab", "config", id]);
  const index = await getConfigIndex();
  await setConfigIndex(index.filter((i) => i !== id));
}

// ── Question CRUD ────────────────────────────────────────────────────

export async function getQuestion(id: string): Promise<QLQuestion | null> {
  const db = await kv();
  const entry = await db.get<QLQuestion>(["qlab", "question", id]);
  return entry.value ?? null;
}

export async function getQuestionsForConfig(configId: string): Promise<QLQuestion[]> {
  const config = await getConfig(configId);
  if (!config) return [];
  const results: QLQuestion[] = [];
  for (const id of config.questionIds) {
    const q = await getQuestion(id);
    if (q) results.push(q);
  }
  return results;
}

export async function createQuestion(configId: string, name: string, text: string): Promise<QLQuestion | null> {
  const config = await getConfig(configId);
  if (!config) return null;
  const id = nanoid();
  const question: QLQuestion = { id, name, text, configId, autoYesExp: "", versions: [], testIds: [] };
  const db = await kv();
  await db.set(["qlab", "question", id], question);
  config.questionIds.push(id);
  await db.set(["qlab", "config", configId], config);
  return question;
}

export async function updateQuestion(
  id: string,
  updates: { name?: string; text?: string; autoYesExp?: string },
): Promise<QLQuestion | null> {
  const question = await getQuestion(id);
  if (!question) return null;
  if (updates.text && updates.text !== question.text) {
    question.versions.unshift({ text: question.text, timestamp: new Date().toISOString() });
    question.text = updates.text;
  }
  if (updates.name !== undefined) question.name = updates.name;
  if (updates.autoYesExp !== undefined) question.autoYesExp = updates.autoYesExp;
  const db = await kv();
  await db.set(["qlab", "question", id], question);
  return question;
}

export async function deleteQuestion(id: string): Promise<void> {
  const question = await getQuestion(id);
  if (!question) return;
  for (const tId of question.testIds) {
    await deleteTest(tId);
  }
  const db = await kv();
  await db.delete(["qlab", "question", id]);
  const config = await getConfig(question.configId);
  if (config) {
    config.questionIds = config.questionIds.filter((qId) => qId !== id);
    await db.set(["qlab", "config", question.configId], config);
  }
}

export async function restoreVersion(id: string, versionIndex: number): Promise<QLQuestion | null> {
  const question = await getQuestion(id);
  if (!question) return null;
  if (versionIndex < 0 || versionIndex >= question.versions.length) return null;
  const versionToRestore = question.versions[versionIndex];
  question.versions.splice(versionIndex, 1);
  question.versions.unshift({ text: question.text, timestamp: new Date().toISOString() });
  question.text = versionToRestore.text;
  const db = await kv();
  await db.set(["qlab", "question", id], question);
  return question;
}

// ── Test CRUD ────────────────────────────────────────────────────────

export async function getTest(id: string): Promise<QLTest | null> {
  const db = await kv();
  const entry = await db.get<QLTest>(["qlab", "test", id]);
  return entry.value ?? null;
}

export async function getTestsForQuestion(questionId: string): Promise<QLTest[]> {
  const question = await getQuestion(questionId);
  if (!question) return [];
  const results: QLTest[] = [];
  for (const id of question.testIds) {
    const t = await getTest(id);
    if (t) results.push(t);
  }
  return results;
}

export async function createTest(
  questionId: string,
  snippet: string,
  expected: "yes" | "no",
): Promise<QLTest | null> {
  const question = await getQuestion(questionId);
  if (!question) return null;
  const id = nanoid();
  const test: QLTest = {
    id, questionId, snippet, expected,
    lastResult: null, lastAnswer: null, lastThinking: null, lastDefense: null, lastRunAt: null,
  };
  const db = await kv();
  await db.set(["qlab", "test", id], test);
  question.testIds.push(id);
  await db.set(["qlab", "question", questionId], question);
  return test;
}

export async function updateTest(
  id: string,
  updates: { snippet?: string; expected?: "yes" | "no" },
): Promise<QLTest | null> {
  const test = await getTest(id);
  if (!test) return null;
  if (updates.snippet !== undefined) test.snippet = updates.snippet;
  if (updates.expected !== undefined) test.expected = updates.expected;
  const db = await kv();
  await db.set(["qlab", "test", id], test);
  return test;
}

export async function updateTestResult(
  id: string,
  result: "pass" | "fail",
  answer: string,
  thinking: string,
  defense: string,
): Promise<void> {
  const test = await getTest(id);
  if (!test) return;
  test.lastResult = result;
  test.lastAnswer = answer;
  test.lastThinking = thinking;
  test.lastDefense = defense;
  test.lastRunAt = new Date().toISOString();
  const db = await kv();
  await db.set(["qlab", "test", id], test);
}

export async function deleteTest(id: string): Promise<void> {
  const test = await getTest(id);
  if (!test) return;
  const db = await kv();
  await db.delete(["qlab", "test", id]);
  const question = await getQuestion(test.questionId);
  if (question) {
    question.testIds = question.testIds.filter((tId) => tId !== id);
    await db.set(["qlab", "question", test.questionId], question);
  }
}

// ── Serve ────────────────────────────────────────────────────────────

export async function serveConfig(configNameOrId: string) {
  let config = await getConfig(configNameOrId);
  if (!config) {
    const all = await listConfigs();
    config = all.find((c) => c.name === configNameOrId) ?? null;
  }
  if (!config) return [];
  const questions = await getQuestionsForConfig(config.id);
  return questions.map((q) => ({
    header: q.name,
    unpopulated: q.text,
    populated: q.text,
    autoYesExp: q.autoYesExp,
  }));
}
