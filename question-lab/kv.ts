/** Deno KV store for Question Lab configs, questions, tests, and versions. Org-scoped. */
import { nanoid } from "npm:nanoid";
import { orgKey } from "../lib/org.ts";
import type { OrgId } from "../lib/org.ts";

// -- Types ----------------------------------------------------------------

export interface QLVersion {
  text: string;
  timestamp: string;
}

export interface QLTestRun {
  findingId: string;
  rid: string;
  type: "internal" | "partner";
  startedAt: string;
}

export interface QLConfig {
  id: string;
  name: string;
  createdAt: string;
  questionIds: string[];
  type: "internal" | "partner";
  active: boolean;
  testEmailRecipients?: string[];
  testRuns?: QLTestRun[];
}

export interface QLQuestion {
  id: string;
  name: string;
  text: string;
  configId: string;
  autoYesExp: string;
  /** LLM sampling temperature (0–1.0). Lower = more deterministic. */
  temperature: number;
  /** Number of vector DB chunks to retrieve for RAG context (1–10). */
  numDocs: number;
  /** Egregious failures impact chargebacks and cannot be bonus-flipped. */
  egregious: boolean;
  /** Point value for bonus point calculation (1–100). */
  weight: number;
  versions: QLVersion[];
  testIds: string[];
}

export const QLQUESTION_DEFAULTS = {
  temperature: 0.8,
  numDocs: 4,
  egregious: false,
  weight: 5,
} as const;

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

// -- KV Helpers -----------------------------------------------------------

async function kv() {
  return await Deno.openKv(Deno.env.get("KV_URL") ?? undefined);
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
  const results = await Promise.all(ids.map((id) => getConfig(orgId, id)));
  return results.filter((cfg): cfg is QLConfig => cfg !== null);
}

export async function getConfig(orgId: OrgId, id: string): Promise<QLConfig | null> {
  const db = await kv();
  const entry = await db.get<QLConfig>(orgKey(orgId, "qlab", "config", id));
  return entry.value ?? null;
}

export async function createConfig(orgId: OrgId, name: string, type: "internal" | "partner" = "internal"): Promise<QLConfig> {
  const id = nanoid();
  const config: QLConfig = { id, name, createdAt: new Date().toISOString(), questionIds: [], type, active: false };
  const db = await kv();
  await db.set(orgKey(orgId, "qlab", "config", id), config);
  const index = await getConfigIndex(orgId);
  index.push(id);
  await setConfigIndex(orgId, index);
  return config;
}

export async function updateConfig(
  orgId: OrgId,
  id: string,
  updates: { name?: string; type?: "internal" | "partner"; active?: boolean },
): Promise<QLConfig | null> {
  const config = await getConfig(orgId, id);
  if (!config) return null;
  if (updates.name !== undefined) config.name = updates.name;
  if (updates.type !== undefined) config.type = updates.type;
  if (updates.active !== undefined) config.active = updates.active;
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

// -- Bulk Import ----------------------------------------------------------

/** Fast delete: wipe a config + all its questions in batched atomics. No per-question read. */
export async function bulkDeleteConfig(orgId: OrgId, id: string): Promise<void> {
  const db = await kv();
  const config = await getConfig(orgId, id);
  if (!config) return;

  // Batch-delete all questions (no need to read each one, just delete keys)
  const keys = config.questionIds.map((qId) => orgKey(orgId, "qlab", "question", qId));
  for (let i = 0; i < keys.length; i += 8) {
    const batch = keys.slice(i, i + 8);
    let atomic = db.atomic();
    for (const k of batch) atomic = atomic.delete(k);
    await atomic.commit();
  }

  // Delete config + update index
  await db.delete(orgKey(orgId, "qlab", "config", id));
  const index = await getConfigIndex(orgId);
  await setConfigIndex(orgId, index.filter((i) => i !== id));
}

/** Get just config names quickly — reads index + configs but returns only id+name. */
export async function listConfigNames(orgId: OrgId): Promise<Array<{ id: string; name: string }>> {
  const db = await kv();
  const ids = await getConfigIndex(orgId);
  // Parallel reads
  const entries = await Promise.all(ids.map((id) => db.get<QLConfig>(orgKey(orgId, "qlab", "config", id))));
  return entries.filter((e) => e.value).map((e) => ({ id: e.value!.id, name: e.value!.name }));
}

/** Create a config with all its questions in minimal KV operations. */
export async function bulkImportConfig(
  orgId: OrgId,
  name: string,
  type: "internal" | "partner",
  questions: Array<{ name: string; text: string; autoYesExp: string; temperature?: number; numDocs?: number; egregious?: boolean; weight?: number }>,
): Promise<{ configId: string; questionCount: number }> {
  const db = await kv();
  const configId = nanoid();
  const questionIds: string[] = [];
  const questionObjects: Array<{ key: Deno.KvKey; value: QLQuestion }> = [];

  for (const q of questions) {
    if (!q.name || !q.text) continue;
    const qId = nanoid();
    questionIds.push(qId);
    questionObjects.push({
      key: orgKey(orgId, "qlab", "question", qId),
      value: { id: qId, name: q.name, text: q.text, configId, autoYesExp: q.autoYesExp || "", temperature: q.temperature ?? QLQUESTION_DEFAULTS.temperature, numDocs: q.numDocs ?? QLQUESTION_DEFAULTS.numDocs, egregious: q.egregious ?? QLQUESTION_DEFAULTS.egregious, weight: q.weight ?? QLQUESTION_DEFAULTS.weight, versions: [], testIds: [] },
    });
  }

  const config: QLConfig = { id: configId, name, createdAt: new Date().toISOString(), questionIds, type, active: false };

  // Write config + questions in one pass of batched atomics
  // First batch: config + first few questions
  const allSets: Array<{ key: Deno.KvKey; value: unknown }> = [
    { key: orgKey(orgId, "qlab", "config", configId), value: config },
    ...questionObjects,
  ];
  for (let i = 0; i < allSets.length; i += 8) {
    const batch = allSets.slice(i, i + 8);
    let atomic = db.atomic();
    for (const item of batch) atomic = atomic.set(item.key, item.value);
    await atomic.commit();
  }

  // Update config index
  const indexEntry = await db.get<string[]>(orgKey(orgId, "qlab", "config-index"));
  const index = indexEntry.value ?? [];
  index.push(configId);
  await db.set(orgKey(orgId, "qlab", "config-index"), index);

  return { configId, questionCount: questionIds.length };
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
  const results = await Promise.all(config.questionIds.map((id) => getQuestion(orgId, id)));
  return results.filter((q): q is QLQuestion => q !== null);
}

/** Get all unique question names across all configs (for bulk egregious UI). */
export async function getAllQuestionNames(orgId: OrgId): Promise<Array<{ name: string; count: number; egregious: boolean }>> {
  const configs = await listConfigs(orgId);
  // Parallel fetch all configs' questions at once
  const allQuestions = await Promise.all(configs.map((cfg) => getQuestionsForConfig(orgId, cfg.id)));
  const nameMap = new Map<string, { count: number; egregious: boolean }>();
  for (const questions of allQuestions) {
    for (const q of questions) {
      const existing = nameMap.get(q.name);
      if (existing) {
        existing.count++;
        if (q.egregious) existing.egregious = true;
      } else {
        nameMap.set(q.name, { count: 1, egregious: q.egregious ?? false });
      }
    }
  }
  return [...nameMap.entries()]
    .map(([name, { count, egregious }]) => ({ name, count, egregious }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Set egregious flag on ALL questions matching a given name across all configs. */
export async function bulkSetEgregious(orgId: OrgId, questionName: string, egregious: boolean): Promise<number> {
  const db = await kv();
  const configs = await listConfigs(orgId);
  const allQuestions = await Promise.all(configs.map((cfg) => getQuestionsForConfig(orgId, cfg.id)));
  const toUpdate: QLQuestion[] = [];
  for (const questions of allQuestions) {
    for (const q of questions) {
      if (q.name === questionName && q.egregious !== egregious) {
        q.egregious = egregious;
        toUpdate.push(q);
      }
    }
  }
  // Batch write in parallel
  await Promise.all(toUpdate.map((q) => db.set(orgKey(orgId, "qlab", "question", q.id), q)));
  return toUpdate.length;
}

export async function createQuestion(orgId: OrgId, configId: string, name: string, text: string): Promise<QLQuestion | null> {
  const config = await getConfig(orgId, configId);
  if (!config) return null;
  const id = nanoid();
  const question: QLQuestion = { id, name, text, configId, autoYesExp: "", temperature: QLQUESTION_DEFAULTS.temperature, numDocs: QLQUESTION_DEFAULTS.numDocs, egregious: QLQUESTION_DEFAULTS.egregious, weight: QLQUESTION_DEFAULTS.weight, versions: [], testIds: [] };
  const db = await kv();
  await db.set(orgKey(orgId, "qlab", "question", id), question);
  config.questionIds.push(id);
  await db.set(orgKey(orgId, "qlab", "config", configId), config);
  return question;
}

export async function updateQuestion(
  orgId: OrgId,
  id: string,
  updates: { name?: string; text?: string; autoYesExp?: string; temperature?: number; numDocs?: number; egregious?: boolean; weight?: number },
): Promise<QLQuestion | null> {
  const question = await getQuestion(orgId, id);
  if (!question) return null;
  if (updates.text && updates.text !== question.text) {
    question.versions.unshift({ text: question.text, timestamp: new Date().toISOString() });
    question.text = updates.text;
  }
  if (updates.name !== undefined) question.name = updates.name;
  if (updates.autoYesExp !== undefined) question.autoYesExp = updates.autoYesExp;
  if (updates.temperature !== undefined) question.temperature = Math.max(0, Math.min(1, updates.temperature));
  if (updates.numDocs !== undefined) question.numDocs = Math.max(1, Math.min(10, Math.round(updates.numDocs)));
  if (updates.egregious !== undefined) question.egregious = updates.egregious;
  if (updates.weight !== undefined) question.weight = Math.max(1, Math.min(100, Math.round(updates.weight)));
  // Backfill defaults for questions created before these fields existed
  if (question.temperature === undefined) question.temperature = QLQUESTION_DEFAULTS.temperature;
  if (question.numDocs === undefined) question.numDocs = QLQUESTION_DEFAULTS.numDocs;
  if (question.egregious === undefined) question.egregious = QLQUESTION_DEFAULTS.egregious;
  if (question.weight === undefined) question.weight = QLQUESTION_DEFAULTS.weight;
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

// -- Destination / Office Assignments ------------------------------------

/** Get all internal (date-leg) assignments: destinationId → configName */
export async function getInternalAssignments(orgId: OrgId): Promise<Record<string, string>> {
  const db = await kv();
  const entry = await db.get<Record<string, string>>(orgKey(orgId, "qlab", "internal-assignments"));
  return entry.value ?? {};
}

/** Set or clear a destination's Question Lab config assignment. */
export async function setInternalAssignment(orgId: OrgId, destinationId: string, configName: string | null): Promise<void> {
  const db = await kv();
  const assignments = await getInternalAssignments(orgId);
  if (configName === null) {
    delete assignments[destinationId];
  } else {
    assignments[destinationId] = configName;
  }
  await db.set(orgKey(orgId, "qlab", "internal-assignments"), assignments);
}

/** Get human-readable names for destination IDs: destinationId → name */
export async function getInternalNames(orgId: OrgId): Promise<Record<string, string>> {
  const db = await kv();
  const entry = await db.get<Record<string, string>>(orgKey(orgId, "qlab", "internal-names"));
  return entry.value ?? {};
}

/** Set or clear a destination's human-readable name. */
export async function setInternalName(orgId: OrgId, destinationId: string, name: string | null): Promise<void> {
  const db = await kv();
  const names = await getInternalNames(orgId);
  if (name === null) {
    delete names[destinationId];
  } else {
    names[destinationId] = name;
  }
  await db.set(orgKey(orgId, "qlab", "internal-names"), names);
}

/** Get all partner (package) assignments: officeName → configName */
export async function getPartnerAssignments(orgId: OrgId): Promise<Record<string, string>> {
  const db = await kv();
  const entry = await db.get<Record<string, string>>(orgKey(orgId, "qlab", "partner-assignments"));
  return entry.value ?? {};
}

/** Set or clear an office's Question Lab config assignment. */
export async function setPartnerAssignment(orgId: OrgId, officeName: string, configName: string | null): Promise<void> {
  const db = await kv();
  const assignments = await getPartnerAssignments(orgId);
  if (configName === null) {
    delete assignments[officeName];
  } else {
    assignments[officeName] = configName;
  }
  await db.set(orgKey(orgId, "qlab", "partner-assignments"), assignments);
}

// -- Test Audit Helpers --------------------------------------------------

export async function addTestRun(orgId: OrgId, configId: string, run: QLTestRun): Promise<void> {
  const config = await getConfig(orgId, configId);
  if (!config) return;
  if (!config.testRuns) config.testRuns = [];
  config.testRuns.unshift(run);
  if (config.testRuns.length > 10) config.testRuns = config.testRuns.slice(0, 10);
  const db = await kv();
  await db.set(orgKey(orgId, "qlab", "config", configId), config);
}

export async function updateTestEmailRecipients(orgId: OrgId, configId: string, emails: string[]): Promise<QLConfig | null> {
  const config = await getConfig(orgId, configId);
  if (!config) return null;
  config.testEmailRecipients = emails;
  const db = await kv();
  await db.set(orgKey(orgId, "qlab", "config", configId), config);
  return config;
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
    temperature: q.temperature ?? QLQUESTION_DEFAULTS.temperature,
    numDocs: q.numDocs ?? QLQUESTION_DEFAULTS.numDocs,
    egregious: q.egregious ?? QLQUESTION_DEFAULTS.egregious,
    weight: q.weight ?? QLQUESTION_DEFAULTS.weight,
  }));
}
