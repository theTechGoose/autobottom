import "reflect-metadata";
import { Injectable } from "@danet/core";

import {
  listConfigs, getConfig, createConfig, updateConfig, deleteConfig,
  getQuestion, getQuestionsForConfig, createQuestion, updateQuestion, deleteQuestion, restoreVersion,
  getTest, getTestsForQuestion, createTest, updateTest, deleteTest, updateTestResult,
  serveConfig,
} from "./impl.ts";

import type { OrgId } from "../../../../core/data/kv/org.ts";

/**
 * @Injectable wrapper around the Question Lab coordinator functions.
 * Delegates all calls to the pure functions in impl.ts.
 */
@Injectable()
export class QuestionLabCoordinator {
  listConfigs(orgId: OrgId) { return listConfigs(orgId); }
  getConfig(orgId: OrgId, id: string) { return getConfig(orgId, id); }
  createConfig(orgId: OrgId, name: string) { return createConfig(orgId, name); }
  updateConfig(orgId: OrgId, id: string, name: string) { return updateConfig(orgId, id, name); }
  deleteConfig(orgId: OrgId, id: string) { return deleteConfig(orgId, id); }

  getQuestion(orgId: OrgId, id: string) { return getQuestion(orgId, id); }
  getQuestionsForConfig(orgId: OrgId, configId: string) { return getQuestionsForConfig(orgId, configId); }
  createQuestion(orgId: OrgId, configId: string, name: string, text: string) { return createQuestion(orgId, configId, name, text); }
  updateQuestion(orgId: OrgId, id: string, updates: { name?: string; text?: string; autoYesExp?: string }) { return updateQuestion(orgId, id, updates); }
  deleteQuestion(orgId: OrgId, id: string) { return deleteQuestion(orgId, id); }
  restoreVersion(orgId: OrgId, id: string, versionIndex: number) { return restoreVersion(orgId, id, versionIndex); }

  getTest(orgId: OrgId, id: string) { return getTest(orgId, id); }
  getTestsForQuestion(orgId: OrgId, questionId: string) { return getTestsForQuestion(orgId, questionId); }
  createTest(orgId: OrgId, questionId: string, snippet: string, expected: "yes" | "no") { return createTest(orgId, questionId, snippet, expected); }
  updateTest(orgId: OrgId, id: string, updates: { snippet?: string; expected?: "yes" | "no" }) { return updateTest(orgId, id, updates); }
  deleteTest(orgId: OrgId, id: string) { return deleteTest(orgId, id); }
  updateTestResult(orgId: OrgId, id: string, result: "pass" | "fail", answer: string, thinking: string, defense: string) { return updateTestResult(orgId, id, result, answer, thinking, defense); }

  serveConfig(orgId: OrgId, configNameOrId: string) { return serveConfig(orgId, configNameOrId); }
}
