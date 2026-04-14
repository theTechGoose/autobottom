/** Question Lab controller — wired to real question repository. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body, Query } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import * as repo from "@question-lab/domain/data/question-repository/mod.ts";

import { defaultOrgId } from "@core/domain/business/auth/org-resolver.ts";
const ORG = defaultOrgId;

@SwaggerDescription("Question Lab — audit question configuration, editing, testing")
@Controller("api")
export class QuestionLabController {

  @Get("qlab/configs")
  async listConfigs() { return { configs: await repo.listConfigs(ORG()) }; }

  @Post("qlab/configs")
  async createConfig(@Body() body: { name: string; type?: string }) {
    return repo.createConfig(ORG(), body.name, (body.type as "internal" | "partner") ?? "internal");
  }

  @Post("qlab/configs/update")
  async updateConfig(@Body() body: Record<string, any>) {
    const { id, ...patch } = body;
    return (await repo.updateConfig(ORG(), id, patch)) ?? { error: "not found" };
  }

  @Post("qlab/configs/delete")
  async deleteConfig(@Body() body: { id: string }) { await repo.deleteConfig(ORG(), body.id); return { ok: true }; }

  @Post("qlab/configs/clone")
  async cloneConfig(@Body() body: { id: string }) {
    const src = await repo.getConfig(ORG(), body.id);
    if (!src) return { error: "not found" };
    const clone = await repo.createConfig(ORG(), `${src.name} (copy)`, src.type);
    const questions = await repo.getQuestionsForConfig(ORG(), body.id);
    for (const q of questions) await repo.createQuestion(ORG(), clone.id, q.name, q.text);
    return clone;
  }

  @Post("qlab/configs/import")
  async importConfig(@Body() body: Record<string, any>) { return { ok: true, message: "import pending full port" }; }

  @Get("qlab/question")
  async getQuestion(@Query("id") id: string) { return (await repo.getQuestion(ORG(), id)) ?? { error: "not found" }; }

  @Post("qlab/questions")
  async createQuestion(@Body() body: { configId: string; name: string; text: string }) {
    return repo.createQuestion(ORG(), body.configId, body.name, body.text);
  }

  @Post("qlab/questions/update")
  async updateQuestion(@Body() body: Record<string, any>) {
    const { id, ...patch } = body;
    return (await repo.updateQuestion(ORG(), id, patch)) ?? { error: "not found" };
  }

  @Post("qlab/questions/delete")
  async deleteQuestion(@Body() body: { id: string }) { await repo.deleteQuestion(ORG(), body.id); return { ok: true }; }

  @Post("qlab/questions/restore")
  async restoreVersion(@Body() body: { id: string; versionIndex: number }) {
    return (await repo.restoreVersion(ORG(), body.id, body.versionIndex)) ?? { error: "not found" };
  }

  @Get("qlab/question-names")
  async getQuestionNames() { return { names: await repo.getAllQuestionNames(ORG()) }; }

  @Post("qlab/questions/bulk-egregious")
  async bulkSetEgregious(@Body() body: { name: string; egregious: boolean }) {
    const count = await repo.bulkSetEgregious(ORG(), body.name, body.egregious);
    return { ok: true, updated: count };
  }

  @Post("qlab/tests")
  async createTest(@Body() body: { questionId: string; input: string; expectedAnswer: string }) {
    return repo.createTest(ORG(), body.questionId, body.input, body.expectedAnswer);
  }

  @Post("qlab/tests/update")
  async updateTest(@Body() body: Record<string, any>) { return { ok: true, message: "test update pending port" }; }

  @Post("qlab/tests/delete")
  async deleteTest(@Body() body: { id: string }) { await repo.deleteTest(ORG(), body.id); return { ok: true }; }

  @Post("qlab/simulate")
  async simulate(@Body() body: Record<string, any>) { return { result: null, message: "simulate pending LLM wiring" }; }

  @Get("qlab/snippet")
  async getSnippet(@Query("findingId") findingId: string) { return { snippet: "", message: "snippet pending port" }; }

  @Post("qlab/test-audit")
  async runTestAudit(@Body() body: Record<string, any>) { return { ok: true, message: "test audit pending pipeline wiring" }; }

  @Get("qlab/test-runs")
  async getTestRuns(@Query("configId") configId: string) { return { runs: [] }; }

  @Post("qlab/test-emails")
  async updateTestEmails(@Body() body: Record<string, any>) { return { ok: true, message: "pending port" }; }

  @Get("qlab-assignments")
  async getAssignments() {
    const [internal, partner] = await Promise.all([repo.getInternalAssignments(ORG()), repo.getPartnerAssignments(ORG())]);
    return { internal, partner };
  }

  @Post("qlab-assignments")
  async setAssignment(@Body() body: { type: string; key: string; value: string | null }) {
    if (body.type === "internal") await repo.setInternalAssignment(ORG(), body.key, body.value);
    else await repo.setPartnerAssignment(ORG(), body.key, body.value);
    return { ok: true };
  }

  @Get("qlab/serve")
  async serveConfig(@Query("name") name: string) { return { config: null, message: "serve pending port" }; }
}
