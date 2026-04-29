/** Question Lab repository — config, question, test, assignment CRUD.
 *  Firestore-backed. */

import {
  getStored, setStored, deleteStored, listStored, listStoredWithKeys,
} from "@core/data/firestore/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

// ── Types ────────────────────────────────────────────────────────────────────

export interface QLConfig {
  id: string; name: string; type: "internal" | "partner";
  createdAt: number; updatedAt: number; testEmailRecipients?: string[];
  /** Available for assignment? Defaults to true on create.
   *  Toggleable from the config list and detail pages — matches prod's
   *  cfg-active-btn behavior. */
  active?: boolean;
}

export interface QLQuestion {
  id: string; configId: string; name: string; text: string;
  autoYesExp?: string;
  egregious?: boolean; weight?: number;
  temperature?: number; numDocs?: number;
  order?: number;
  createdAt: number; updatedAt: number;
  versions?: Array<{ text: string; updatedAt: number }>;
}

export interface QLTest {
  id: string; questionId: string; input: string; expectedAnswer: string;
  lastResult?: string; lastRunAt?: number; createdAt: number;
}

export interface QLTestRun {
  id: string;
  testId?: string;
  configId: string;
  questionId: string;
  result: "pass" | "fail";
  expectedAnswer: string;
  actualAnswer: string;
  thinking?: string;
  defense?: string;
  runAt: number;
}

// ── Config CRUD ──────────────────────────────────────────────────────────────

export async function listConfigs(orgId: OrgId): Promise<QLConfig[]> {
  return await listStored<QLConfig>("qlab-config", orgId);
}

export async function getConfig(orgId: OrgId, id: string): Promise<QLConfig | null> {
  return await getStored<QLConfig>("qlab-config", orgId, id);
}

export async function createConfig(orgId: OrgId, name: string, type: "internal" | "partner" = "internal"): Promise<QLConfig> {
  const id = crypto.randomUUID();
  const now = Date.now();
  const config: QLConfig = { id, name, type, createdAt: now, updatedAt: now, active: true };
  await setStored("qlab-config", orgId, [id], config);
  return config;
}

export async function updateConfig(orgId: OrgId, id: string, patch: Partial<QLConfig>): Promise<QLConfig | null> {
  const existing = await getConfig(orgId, id);
  if (!existing) return null;
  const updated = { ...existing, ...patch, updatedAt: Date.now() };
  await setStored("qlab-config", orgId, [id], updated);
  return updated;
}

export async function deleteConfig(orgId: OrgId, id: string): Promise<void> {
  await deleteStored("qlab-config", orgId, id);
  // Also delete all questions for this config
  const questions = await listStoredWithKeys<QLQuestion>("qlab-question", orgId);
  for (const { key, value } of questions) {
    if (value?.configId === id) await deleteStored("qlab-question", orgId, ...key);
  }
}

export async function listConfigNames(orgId: OrgId): Promise<Array<{ id: string; name: string }>> {
  const configs = await listConfigs(orgId);
  return configs.map((c) => ({ id: c.id, name: c.name }));
}

// ── Question CRUD ────────────────────────────────────────────────────────────

export async function getQuestionsForConfig(orgId: OrgId, configId: string): Promise<QLQuestion[]> {
  const all = await listStored<QLQuestion>("qlab-question", orgId);
  return all.filter((q) => q.configId === configId);
}

export async function getQuestion(orgId: OrgId, id: string): Promise<QLQuestion | null> {
  return await getStored<QLQuestion>("qlab-question", orgId, id);
}

export interface CreateQuestionExtras {
  autoYesExp?: string;
  weight?: number;
  temperature?: number;
  numDocs?: number;
  egregious?: boolean;
  order?: number;
}

export async function createQuestion(
  orgId: OrgId,
  configId: string,
  name: string,
  text: string,
  extras: CreateQuestionExtras = {},
): Promise<QLQuestion> {
  const id = crypto.randomUUID();
  const now = Date.now();
  const q: QLQuestion = {
    id, configId, name, text,
    createdAt: now, updatedAt: now, versions: [],
    ...(extras.autoYesExp ? { autoYesExp: extras.autoYesExp } : {}),
    ...(extras.weight !== undefined ? { weight: extras.weight } : {}),
    ...(extras.temperature !== undefined ? { temperature: extras.temperature } : {}),
    ...(extras.numDocs !== undefined ? { numDocs: extras.numDocs } : {}),
    ...(extras.egregious !== undefined ? { egregious: extras.egregious } : {}),
    ...(extras.order !== undefined ? { order: extras.order } : {}),
  };
  await setStored("qlab-question", orgId, [id], q);
  return q;
}

/** Delete every question belonging to a given config. Used by importConfig's
 *  overwrite path so a re-import doesn't stack on top of the old questions. */
export async function bulkDeleteQuestions(orgId: OrgId, configId: string): Promise<number> {
  const rows = await listStoredWithKeys<QLQuestion>("qlab-question", orgId);
  let deleted = 0;
  for (const { key, value } of rows) {
    if (value.configId === configId) {
      await deleteStored("qlab-question", orgId, ...key);
      deleted++;
    }
  }
  return deleted;
}

export async function updateQuestion(orgId: OrgId, id: string, patch: Partial<QLQuestion>): Promise<QLQuestion | null> {
  const existing = await getQuestion(orgId, id);
  if (!existing) return null;
  const versions = existing.versions ?? [];
  versions.push({ text: existing.text, updatedAt: existing.updatedAt });
  const updated = { ...existing, ...patch, updatedAt: Date.now(), versions };
  await setStored("qlab-question", orgId, [id], updated);
  return updated;
}

export async function deleteQuestion(orgId: OrgId, id: string): Promise<void> {
  await deleteStored("qlab-question", orgId, id);
}

export async function restoreVersion(orgId: OrgId, id: string, versionIndex: number): Promise<QLQuestion | null> {
  const q = await getQuestion(orgId, id);
  if (!q || !q.versions?.[versionIndex]) return null;
  return updateQuestion(orgId, id, { text: q.versions[versionIndex].text });
}

export async function getAllQuestionNames(orgId: OrgId): Promise<Array<{ name: string; count: number; egregious: boolean }>> {
  const all = await listStored<QLQuestion>("qlab-question", orgId);
  const nameMap = new Map<string, { count: number; egregious: boolean }>();
  for (const q of all) {
    const existing = nameMap.get(q.name);
    if (existing) existing.count++;
    else nameMap.set(q.name, { count: 1, egregious: !!q.egregious });
  }
  return Array.from(nameMap.entries()).map(([name, data]) => ({ name, ...data }));
}

export async function bulkSetEgregious(orgId: OrgId, questionName: string, egregious: boolean): Promise<number> {
  const rows = await listStoredWithKeys<QLQuestion>("qlab-question", orgId);
  let updated = 0;
  for (const { key, value } of rows) {
    if (value.name === questionName && value.egregious !== egregious) {
      await setStored("qlab-question", orgId, key, { ...value, egregious, updatedAt: Date.now() });
      updated++;
    }
  }
  return updated;
}

// ── Test CRUD ────────────────────────────────────────────────────────────────

export async function getTestsForQuestion(orgId: OrgId, questionId: string): Promise<QLTest[]> {
  const all = await listStored<QLTest>("qlab-test", orgId);
  return all.filter((t) => t.questionId === questionId);
}

export async function createTest(orgId: OrgId, questionId: string, input: string, expectedAnswer: string): Promise<QLTest> {
  const id = crypto.randomUUID();
  const t: QLTest = { id, questionId, input, expectedAnswer, createdAt: Date.now() };
  await setStored("qlab-test", orgId, [id], t);
  return t;
}

export async function deleteTest(orgId: OrgId, id: string): Promise<void> {
  await deleteStored("qlab-test", orgId, id);
}

// ── Test Runs (per-question result history) ──────────────────────────────────

export async function addTestRun(
  orgId: OrgId,
  run: Omit<QLTestRun, "id" | "runAt"> & { id?: string; runAt?: number },
): Promise<QLTestRun> {
  const id = run.id ?? crypto.randomUUID();
  const runAt = run.runAt ?? Date.now();
  const record: QLTestRun = { ...run, id, runAt };
  const padTs = String(runAt).padStart(16, "0");
  await setStored("qlab-test-run", orgId, [padTs, id], record);
  return record;
}

export async function getTestRuns(
  orgId: OrgId,
  filter?: { configId?: string; questionId?: string; limit?: number },
): Promise<QLTestRun[]> {
  const limit = filter?.limit ?? 200;
  const rows = await listStoredWithKeys<QLTestRun>("qlab-test-run", orgId);
  // Sort by padTs key part descending (newest first)
  rows.sort((a, b) => String(b.key[0]).localeCompare(String(a.key[0])));
  const out: QLTestRun[] = [];
  for (const { value: r } of rows) {
    if (filter?.configId && r.configId !== filter.configId) continue;
    if (filter?.questionId && r.questionId !== filter.questionId) continue;
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

// ── Assignments ──────────────────────────────────────────────────────────────

export async function getInternalAssignments(orgId: OrgId): Promise<Record<string, string>> {
  return (await getStored<Record<string, string>>("qlab-internal-assignments", orgId)) ?? {};
}

export async function setInternalAssignment(orgId: OrgId, destinationId: string, configName: string | null): Promise<void> {
  const current = await getInternalAssignments(orgId);
  if (configName) current[destinationId] = configName;
  else delete current[destinationId];
  await setStored("qlab-internal-assignments", orgId, [], current);
}

export async function getPartnerAssignments(orgId: OrgId): Promise<Record<string, string>> {
  return (await getStored<Record<string, string>>("qlab-partner-assignments", orgId)) ?? {};
}

export async function setPartnerAssignment(orgId: OrgId, officeName: string, configName: string | null): Promise<void> {
  const current = await getPartnerAssignments(orgId);
  if (configName) current[officeName] = configName;
  else delete current[officeName];
  await setStored("qlab-partner-assignments", orgId, [], current);
}

// ── Serve Config (for pipeline steps) ────────────────────────────────────────

const QLQUESTION_DEFAULTS = { temperature: 0.8, numDocs: 4, egregious: false, weight: 5 };

export async function serveConfig(orgId: OrgId, configNameOrId: string) {
  let config = await getConfig(orgId, configNameOrId);
  if (!config) {
    const all = await listConfigs(orgId);
    config = all.find((c) => c.name === configNameOrId) ?? null;
  }
  if (!config) return [];
  const questions = await getQuestionsForConfig(orgId, config.id);
  const ordered = [...questions].sort((a, b) =>
    (a.order ?? 0) - (b.order ?? 0) || a.createdAt - b.createdAt,
  );
  return ordered.map((q) => ({
    header: q.name,
    unpopulated: q.text,
    populated: q.text,
    autoYesExp: q.autoYesExp ?? "",
    temperature: q.temperature ?? QLQUESTION_DEFAULTS.temperature,
    numDocs: q.numDocs ?? QLQUESTION_DEFAULTS.numDocs,
    egregious: q.egregious ?? QLQUESTION_DEFAULTS.egregious,
    weight: q.weight ?? QLQUESTION_DEFAULTS.weight,
  }));
}
