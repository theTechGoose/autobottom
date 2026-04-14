/** Question Lab controller — wired to real question repository. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body, Query } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { ReturnedType } from "jsr:@danet/swagger@2/decorators";
import { OkResponse, OkMessageResponse, MessageResponse, QLConfigListResponse, QLConfigResponse, QLQuestionResponse, QLQuestionNamesResponse, BulkUpdateResponse, QLAssignmentsResponse, SoundPackListResponse, GamificationSettingsResponse, StoreItemListResponse, PurchaseResponse, BadgeListResponse, UnreadCountResponse, ConversationListResponse, UserListResponse, MessageSentResponse, EventsResponse, WeeklyDataResponse } from "@core/dto/responses.ts";
import { GenericBodyRequest } from "@core/dto/requests.ts";
import * as repo from "@question-lab/domain/data/question-repository/mod.ts";

import { defaultOrgId } from "@core/domain/business/auth/org-resolver.ts";
const ORG = defaultOrgId;

@SwaggerDescription("Question Lab — audit question configuration, editing, testing")
@Controller("api")
export class QuestionLabController {

  @Get("qlab/configs") @ReturnedType(QLConfigListResponse)
  async listConfigs() { return { configs: await repo.listConfigs(ORG()) }; }

  @Post("qlab/configs") @ReturnedType(QLConfigResponse)
  async createConfig(@Body() body: { name: string; type?: string }) {
    return repo.createConfig(ORG(), body.name, (body.type as "internal" | "partner") ?? "internal");
  }

  @Post("qlab/configs/update") @ReturnedType(QLConfigResponse)
  async updateConfig(@Body() body: any) {
    const { id, ...patch } = body;
    return (await repo.updateConfig(ORG(), id, patch)) ?? { error: "not found" };
  }

  @Post("qlab/configs/delete") @ReturnedType(OkResponse)
  async deleteConfig(@Body() body: { id: string }) { await repo.deleteConfig(ORG(), body.id); return { ok: true }; }

  @Post("qlab/configs/clone") @ReturnedType(QLConfigResponse)
  async cloneConfig(@Body() body: { id: string }) {
    const src = await repo.getConfig(ORG(), body.id);
    if (!src) return { error: "not found" };
    const clone = await repo.createConfig(ORG(), `${src.name} (copy)`, src.type);
    const questions = await repo.getQuestionsForConfig(ORG(), body.id);
    for (const q of questions) await repo.createQuestion(ORG(), clone.id, q.name, q.text);
    return clone;
  }

  @Post("qlab/configs/import") @ReturnedType(OkMessageResponse)
  async importConfig(@Body() body: any) { return { ok: true, message: "Not yet implemented" }; }

  @Get("qlab/question") @ReturnedType(QLQuestionResponse)
  async getQuestion(@Query("id") id: string) { return (await repo.getQuestion(ORG(), id)) ?? { error: "not found" }; }

  @Post("qlab/questions") @ReturnedType(QLQuestionResponse)
  async createQuestion(@Body() body: { configId: string; name: string; text: string }) {
    return repo.createQuestion(ORG(), body.configId, body.name, body.text);
  }

  @Post("qlab/questions/update") @ReturnedType(QLQuestionResponse)
  async updateQuestion(@Body() body: any) {
    const { id, ...patch } = body;
    return (await repo.updateQuestion(ORG(), id, patch)) ?? { error: "not found" };
  }

  @Post("qlab/questions/delete") @ReturnedType(OkResponse)
  async deleteQuestion(@Body() body: { id: string }) { await repo.deleteQuestion(ORG(), body.id); return { ok: true }; }

  @Post("qlab/questions/restore") @ReturnedType(QLQuestionResponse)
  async restoreVersion(@Body() body: { id: string; versionIndex: number }) {
    return (await repo.restoreVersion(ORG(), body.id, body.versionIndex)) ?? { error: "not found" };
  }

  @Get("qlab/question-names") @ReturnedType(QLQuestionNamesResponse)
  async getQuestionNames() { return { names: await repo.getAllQuestionNames(ORG()) }; }

  @Post("qlab/questions/bulk-egregious") @ReturnedType(BulkUpdateResponse)
  async bulkSetEgregious(@Body() body: { name: string; egregious: boolean }) {
    const count = await repo.bulkSetEgregious(ORG(), body.name, body.egregious);
    return { ok: true, updated: count };
  }

  @Post("qlab/tests") @ReturnedType(OkResponse)
  async createTest(@Body() body: { questionId: string; input: string; expectedAnswer: string }) {
    return repo.createTest(ORG(), body.questionId, body.input, body.expectedAnswer);
  }

  @Post("qlab/tests/update") @ReturnedType(OkMessageResponse)
  async updateTest(@Body() body: any) { return { ok: true, message: "Not yet implemented" }; }

  @Post("qlab/tests/delete") @ReturnedType(OkResponse)
  async deleteTest(@Body() body: { id: string }) { await repo.deleteTest(ORG(), body.id); return { ok: true }; }

  @Post("qlab/simulate") @ReturnedType(OkMessageResponse)
  async simulate(@Body() body: any) { return { result: null, message: "Not yet implemented" }; }

  @Get("qlab/snippet") @ReturnedType(MessageResponse)
  async getSnippet(@Query("findingId") findingId: string) { return { snippet: "", message: "Not yet implemented" }; }

  @Post("qlab/test-audit") @ReturnedType(OkMessageResponse)
  async runTestAudit(@Body() body: any) { return { ok: true, message: "Not yet implemented" }; }

  @Get("qlab/test-runs") @ReturnedType(OkResponse)
  async getTestRuns(@Query("configId") configId: string) { return { runs: [] }; }

  @Post("qlab/test-emails") @ReturnedType(OkMessageResponse)
  async updateTestEmails(@Body() body: any) { return { ok: true, message: "Not yet implemented" }; }

  @Get("qlab-assignments") @ReturnedType(QLAssignmentsResponse)
  async getAssignments() {
    const [internal, partner] = await Promise.all([repo.getInternalAssignments(ORG()), repo.getPartnerAssignments(ORG())]);
    return { internal, partner };
  }

  @Post("qlab-assignments") @ReturnedType(OkResponse)
  async setAssignment(@Body() body: { type: string; key: string; value: string | null }) {
    if (body.type === "internal") await repo.setInternalAssignment(ORG(), body.key, body.value);
    else await repo.setPartnerAssignment(ORG(), body.key, body.value);
    return { ok: true };
  }

  @Get("qlab/serve") @ReturnedType(MessageResponse)
  async serveConfig(@Query("name") name: string) { return { config: null, message: "Not yet implemented" }; }
}
