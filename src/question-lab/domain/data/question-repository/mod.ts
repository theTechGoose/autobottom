/** Question Lab repository — config, question, test, assignment CRUD.
 *  Ported from question-lab/kv.ts. */

import { getKv, orgKey } from "@core/domain/data/deno-kv/mod.ts";
import type { OrgId } from "@core/domain/data/deno-kv/mod.ts";

// ── Types ────────────────────────────────────────────────────────────────────

export interface QLConfig {
  id: string; name: string; type: "internal" | "partner";
  createdAt: number; updatedAt: number; testEmailRecipients?: string[];
}

export interface QLQuestion {
  id: string; configId: string; name: string; text: string;
  autoYes?: string; egregious?: boolean; weight?: number;
  temperature?: number; numDocs?: number;
  createdAt: number; updatedAt: number;
  versions?: Array<{ text: string; updatedAt: number }>;
}

export interface QLTest {
  id: string; questionId: string; input: string; expectedAnswer: string;
  lastResult?: string; lastRunAt?: number; createdAt: number;
}

// ── Config CRUD ──────────────────────────────────────────────────────────────

export async function listConfigs(orgId: OrgId): Promise<QLConfig[]> {
  const db = await getKv();
  const r: QLConfig[] = [];
  for await (const e of db.list<QLConfig>({ prefix: orgKey(orgId, "qlab-config") })) r.push(e.value);
  return r;
}

export async function getConfig(orgId: OrgId, id: string): Promise<QLConfig | null> {
  return (await (await getKv()).get<QLConfig>(orgKey(orgId, "qlab-config", id))).value;
}

export async function createConfig(orgId: OrgId, name: string, type: "internal" | "partner" = "internal"): Promise<QLConfig> {
  const db = await getKv();
  const id = crypto.randomUUID();
  const now = Date.now();
  const config: QLConfig = { id, name, type, createdAt: now, updatedAt: now };
  await db.set(orgKey(orgId, "qlab-config", id), config);
  return config;
}

export async function updateConfig(orgId: OrgId, id: string, patch: Partial<QLConfig>): Promise<QLConfig | null> {
  const db = await getKv();
  const existing = await getConfig(orgId, id);
  if (!existing) return null;
  const updated = { ...existing, ...patch, updatedAt: Date.now() };
  await db.set(orgKey(orgId, "qlab-config", id), updated);
  return updated;
}

export async function deleteConfig(orgId: OrgId, id: string): Promise<void> {
  const db = await getKv();
  await db.delete(orgKey(orgId, "qlab-config", id));
  // Also delete all questions for this config
  for await (const e of db.list({ prefix: orgKey(orgId, "qlab-question") })) {
    const q = e.value as any;
    if (q?.configId === id) await db.delete(e.key);
  }
}

export async function listConfigNames(orgId: OrgId): Promise<Array<{ id: string; name: string }>> {
  const configs = await listConfigs(orgId);
  return configs.map((c) => ({ id: c.id, name: c.name }));
}

// ── Question CRUD ────────────────────────────────────────────────────────────

export async function getQuestionsForConfig(orgId: OrgId, configId: string): Promise<QLQuestion[]> {
  const db = await getKv();
  const r: QLQuestion[] = [];
  for await (const e of db.list<QLQuestion>({ prefix: orgKey(orgId, "qlab-question") })) {
    if (e.value.configId === configId) r.push(e.value);
  }
  return r;
}

export async function getQuestion(orgId: OrgId, id: string): Promise<QLQuestion | null> {
  return (await (await getKv()).get<QLQuestion>(orgKey(orgId, "qlab-question", id))).value;
}

export async function createQuestion(orgId: OrgId, configId: string, name: string, text: string): Promise<QLQuestion> {
  const db = await getKv();
  const id = crypto.randomUUID();
  const now = Date.now();
  const q: QLQuestion = { id, configId, name, text, createdAt: now, updatedAt: now, versions: [] };
  await db.set(orgKey(orgId, "qlab-question", id), q);
  return q;
}

export async function updateQuestion(orgId: OrgId, id: string, patch: Partial<QLQuestion>): Promise<QLQuestion | null> {
  const db = await getKv();
  const existing = await getQuestion(orgId, id);
  if (!existing) return null;
  // Save current version to history
  const versions = existing.versions ?? [];
  versions.push({ text: existing.text, updatedAt: existing.updatedAt });
  const updated = { ...existing, ...patch, updatedAt: Date.now(), versions };
  await db.set(orgKey(orgId, "qlab-question", id), updated);
  return updated;
}

export async function deleteQuestion(orgId: OrgId, id: string): Promise<void> {
  await (await getKv()).delete(orgKey(orgId, "qlab-question", id));
}

export async function restoreVersion(orgId: OrgId, id: string, versionIndex: number): Promise<QLQuestion | null> {
  const q = await getQuestion(orgId, id);
  if (!q || !q.versions?.[versionIndex]) return null;
  return updateQuestion(orgId, id, { text: q.versions[versionIndex].text });
}

export async function getAllQuestionNames(orgId: OrgId): Promise<Array<{ name: string; count: number; egregious: boolean }>> {
  const db = await getKv();
  const nameMap = new Map<string, { count: number; egregious: boolean }>();
  for await (const e of db.list<QLQuestion>({ prefix: orgKey(orgId, "qlab-question") })) {
    const q = e.value;
    const existing = nameMap.get(q.name);
    if (existing) { existing.count++; }
    else { nameMap.set(q.name, { count: 1, egregious: !!q.egregious }); }
  }
  return Array.from(nameMap.entries()).map(([name, data]) => ({ name, ...data }));
}

export async function bulkSetEgregious(orgId: OrgId, questionName: string, egregious: boolean): Promise<number> {
  const db = await getKv();
  let updated = 0;
  for await (const e of db.list<QLQuestion>({ prefix: orgKey(orgId, "qlab-question") })) {
    if (e.value.name === questionName && e.value.egregious !== egregious) {
      await db.set(e.key, { ...e.value, egregious, updatedAt: Date.now() });
      updated++;
    }
  }
  return updated;
}

// ── Test CRUD ────────────────────────────────────────────────────────────────

export async function getTestsForQuestion(orgId: OrgId, questionId: string): Promise<QLTest[]> {
  const db = await getKv();
  const r: QLTest[] = [];
  for await (const e of db.list<QLTest>({ prefix: orgKey(orgId, "qlab-test") })) {
    if (e.value.questionId === questionId) r.push(e.value);
  }
  return r;
}

export async function createTest(orgId: OrgId, questionId: string, input: string, expectedAnswer: string): Promise<QLTest> {
  const db = await getKv();
  const id = crypto.randomUUID();
  const t: QLTest = { id, questionId, input, expectedAnswer, createdAt: Date.now() };
  await db.set(orgKey(orgId, "qlab-test", id), t);
  return t;
}

export async function deleteTest(orgId: OrgId, id: string): Promise<void> {
  await (await getKv()).delete(orgKey(orgId, "qlab-test", id));
}

// ── Assignments ──────────────────────────────────────────────────────────────

export async function getInternalAssignments(orgId: OrgId): Promise<Record<string, string>> {
  return (await (await getKv()).get<Record<string, string>>(orgKey(orgId, "qlab-internal-assignments"))).value ?? {};
}

export async function setInternalAssignment(orgId: OrgId, destinationId: string, configName: string | null): Promise<void> {
  const db = await getKv();
  const current = await getInternalAssignments(orgId);
  if (configName) current[destinationId] = configName;
  else delete current[destinationId];
  await db.set(orgKey(orgId, "qlab-internal-assignments"), current);
}

export async function getPartnerAssignments(orgId: OrgId): Promise<Record<string, string>> {
  return (await (await getKv()).get<Record<string, string>>(orgKey(orgId, "qlab-partner-assignments"))).value ?? {};
}

export async function setPartnerAssignment(orgId: OrgId, officeName: string, configName: string | null): Promise<void> {
  const db = await getKv();
  const current = await getPartnerAssignments(orgId);
  if (configName) current[officeName] = configName;
  else delete current[officeName];
  await db.set(orgKey(orgId, "qlab-partner-assignments"), current);
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
  return questions.map((q) => ({
    header: q.name,
    unpopulated: q.text,
    populated: q.text,
    autoYesExp: "",
    temperature: q.temperature ?? QLQUESTION_DEFAULTS.temperature,
    numDocs: q.numDocs ?? QLQUESTION_DEFAULTS.numDocs,
    egregious: q.egregious ?? QLQUESTION_DEFAULTS.egregious,
    weight: q.weight ?? QLQUESTION_DEFAULTS.weight,
  }));
}
